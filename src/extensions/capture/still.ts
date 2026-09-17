// THE STILL PATH. Armed by the action, GRABBED from inside the render task on a frame
// that actually rendered — outside the loop the canvas holds the last frame's FINAL
// composite, navigation Gizmo included, so only a grab from inside the task lands in the
// pre-Gizmo window. See "Screenshots are armed, not taken" in capture/CLAUDE.md.

import { logEngine } from '$extensions/logger';
import { captureState } from './capture.svelte';
import type { ResolutionOverride } from './resolution';

export interface StillGrabber {
	/** Arm a still. The frame after the prime frame is the one grabbed. */
	arm(): void;
	/** Grab if one is armed. Called from the task, after the pipeline drew the frame. */
	tick(): void;
	/** Release the override of a still armed but never grabbed. Unmount only. */
	dispose(): void;
}

export const createStillGrabber = (options: {
	/** The live renderer canvas, read fresh each grab. */
	source: () => HTMLCanvasElement;
	resolution: ResolutionOverride;
	download: (blob: Blob, extension: string) => void;
	invalidate: () => void;
}): StillGrabber => {
	const { source, resolution, download, invalidate } = options;

	// Alpha-capable on purpose: PNG and WebP carry transparency, JPEG flattens onto black.
	// The context is acquired ONCE, here, and never inside the blit — getContext options
	// only apply on the first call for a given canvas (capture/CLAUDE.md).
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');

	let pending = false;
	let release: (() => void) | null = null;

	const grab = () => {
		if (!context) {
			captureState.status = 'Screenshot failed: no 2D context';
			logEngine.error('Capture: could not acquire a 2D context for the still');
			return;
		}

		const live = source();
		// Writing width/height clears the pixels but keeps the context object, so the
		// context acquired above survives every resize.
		canvas.width = live.width;
		canvas.height = live.height;
		const { width, height } = canvas;

		const format = captureState.imageFormat;
		// THE BLIT: copies the live canvas (COPY_SRC, DOCS/webgpu-notes.md §5.2), which is
		// only a valid drawImage source while the frame is current — i.e. from in here.
		// The resize above already cleared it, so JPEG only needs the black underlay it
		// will be flattened onto.
		if (format === 'jpeg') {
			context.fillStyle = '#000';
			context.fillRect(0, 0, width, height);
		}
		context.drawImage(live, 0, 0, width, height);

		const type = `image/${format}`;
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					captureState.status = `Screenshot failed: ${format} not encodable`;
					logEngine.error('Capture: toBlob returned null for', type);
					return;
				}
				download(blob, format === 'jpeg' ? 'jpg' : format);
				const size = (blob.size / 1024 / 1024).toFixed(2);
				captureState.status = `Saved ${width}×${height} ${format} (${size} MB)`;
				logEngine.info(`Capture: still ${width}×${height} ${format}, ${size} MB`);
			},
			type,
			format === 'png' ? undefined : captureState.imageQuality
		);
	};

	return {
		arm() {
			if (pending) return;
			pending = true;
			// Acquired HERE, a frame ahead of the grab, so the TARGET frame is drawn at the
			// selected size. Reference counted, so a still armed mid-take just joins that
			// take's override and releasing below cannot end it (resolution.ts).
			release = resolution.acquire();
			captureState.status = 'Capturing…';
			invalidate();
		},

		tick() {
			if (!pending) return;
			pending = false;
			grab();
			// toBlob() reads our own canvas, already blitted, so the renderer can go back
			// to the viewport immediately — the encode no longer depends on it.
			release?.();
			release = null;
		},

		dispose() {
			pending = false;
			release?.();
			release = null;
		}
	};
};
