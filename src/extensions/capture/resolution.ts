// THE RENDERER-SIZE OVERRIDE every capture installs for its duration, so the frame is
// genuinely DRAWN at the selected preset instead of being scaled up from a window-sized
// one. The updateStyle trick, why the camera aspect is set by hand, why Threlte can still
// take the canvas back, and why a projection change costs a prime frame: capture/CLAUDE.md
// ("Resolution: always a preset, never as-is").

import { PerspectiveCamera, Vector2 } from 'three/webgpu';
import type { Camera } from 'three/webgpu';

/**
 * Just the slice of the renderer this module touches — a structural view rather than a
 * `WebGPURenderer`, so it fits whichever renderer `useThrelte()` was typed for (same style
 * as `SchedulerClock` in core/utils/engineClock.ts).
 */
type SizedRenderer = {
	getSize(target: Vector2): Vector2;
	getDrawingBufferSize(target: Vector2): Vector2;
	getPixelRatio(): number;
	setPixelRatio(value: number): void;
	setSize(width: number, height: number, updateStyle?: boolean): void;
};

export type CaptureSize = { width: number; height: number };

/** One rendered-and-discarded frame after any projection change. See `install()`. */
const PRIME_FRAMES = 1;

export interface ResolutionOverride {
	/**
	 * Force the preset, and hand back this holder's release.
	 *
	 * REFERENCE COUNTED, and that is the point: a still armed during a take simply joins
	 * that take's override, and the size is restored only when the LAST holder releases —
	 * so neither capture can pull the canvas out from under the other. The release is
	 * idempotent, so a holder that releases twice cannot drop someone else's claim.
	 */
	acquire(): () => void;
	/** True while the renderer is ours. */
	readonly active: boolean;
	/** Re-claim the size if Threlte's resize task or its dpr effect took it back. */
	hold(): void;
	/** A frame still has to be rendered and thrown away before anything reads the canvas. */
	readonly priming: boolean;
	/** Burn one prime frame. Exactly ONE caller, once per frame — see capture/CLAUDE.md. */
	consumePrime(): void;
	/** Drop the override however many holders remain. Unmount only. */
	dispose(): void;
}

export const createResolutionOverride = (options: {
	renderer: SizedRenderer;
	/** Read fresh every time: Studio can swap the default camera for its editor one. */
	camera: () => Camera | undefined;
	invalidate: () => void;
	/** The selected preset, read at install time so a mid-session change is picked up. */
	target: () => CaptureSize;
}): ResolutionOverride => {
	const { renderer, camera, invalidate, target } = options;

	const savedSize = new Vector2();
	const drawingBuffer = new Vector2();
	/** The size currently forced on the renderer, or null when the canvas is Threlte's again. */
	let override: CaptureSize | null = null;
	let holders = 0;
	let savedPixelRatio = 1;
	let savedAspect = 0;
	let primeFrames = 0;

	const perspective = (): PerspectiveCamera | null => {
		const current = camera();
		return current instanceof PerspectiveCamera ? current : null;
	};

	const install = () => {
		const size = target();

		// The restore point is read HERE rather than remembered from mount, so a window
		// that was resized before the capture still restores to where it actually is.
		renderer.getSize(savedSize);
		savedPixelRatio = renderer.getPixelRatio();
		override = size;

		// Pixel ratio first: setPixelRatio() re-runs setSize() with the previous
		// dimensions, so the other order would immediately undo the size below.
		renderer.setPixelRatio(1);
		// updateStyle: false — the canvas's CSS size is left exactly as Threlte set it, so
		// only the backing store changes and page layout never moves. The viewport looks
		// stretched whenever the preset's aspect differs from the window's; the encoded
		// frame is the correct one.
		renderer.setSize(size.width, size.height, false);

		// Set by hand, because nothing in Threlte derives the aspect from the drawing
		// buffer — both the resize task and the `T` camera plugin compute it from the CSS
		// size, which is deliberately not being changed.
		const cam = perspective();
		if (cam) {
			savedAspect = cam.aspect;
			cam.aspect = size.width / size.height;
			cam.updateProjectionMatrix();
		}

		// THE PRIME FRAME. The projection and the drawing buffer just moved under three's
		// VelocityNode, which copies current → previous projection once per RENDERED
		// frame — so the next frame drawn reports a full-screen bogus velocity and
		// motionBlur smears it. That frame is exactly the one a still is grabbed on and
		// the one a take encodes as frame 0. Burn it. Also covers `hold()` re-applying
		// mid-capture, which CLEARS the canvas.
		primeFrames = PRIME_FRAMES;
		invalidate();
	};

	const uninstall = () => {
		if (!override) return;
		override = null;
		renderer.setPixelRatio(savedPixelRatio);
		renderer.setSize(savedSize.width, savedSize.height, false);
		const cam = perspective();
		if (cam && savedAspect > 0) {
			cam.aspect = savedAspect;
			cam.updateProjectionMatrix();
		}
		savedAspect = 0;
		invalidate();
	};

	return {
		acquire() {
			if (holders++ === 0) install();
			let released = false;
			return () => {
				if (released) return;
				released = true;
				if (--holders === 0) uninstall();
			};
		},

		get active() {
			return override !== null;
		},

		hold() {
			const size = override;
			if (!size) return;
			// Compared on the DRAWING BUFFER, since a pixel-ratio-only change would not
			// show up in the logical size.
			renderer.getDrawingBufferSize(drawingBuffer);
			if (drawingBuffer.width === size.width && drawingBuffer.height === size.height) return;
			// Re-applies rather than restoring the old numbers: where the window is NOW is
			// where a capture should restore to when it ends.
			override = null;
			install();
		},

		get priming() {
			return primeFrames > 0;
		},

		consumePrime() {
			if (primeFrames > 0) primeFrames--;
		},

		dispose() {
			holders = 0;
			uninstall();
		}
	};
};
