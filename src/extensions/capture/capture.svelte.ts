// Capture state + the driver slot.
//
// The state lives here (always reactive, works without Studio, per the extension rules in
// extensions/CLAUDE.md). The one thing it CANNOT own is the driver: the renderer, the
// render task and the MediaRecorder all need to be inside <Canvas>, so `Capture.svelte`
// implements CaptureDriver and registers it here — the same register/unregister shape
// already used by scenes/DemoScene/mirrorFloor.ts.

import { logEngine } from '$extensions/logger';
import type { CaptureActions, CaptureDriver, CaptureState } from './types';

export type {
	CaptureActions,
	CaptureContainer,
	CaptureDriver,
	CaptureImageFormat,
	CaptureState,
	CaptureVideoMode
} from './types';

export const captureState = $state<CaptureState>({
	imageFormat: 'png',
	imageQuality: 0.92,
	videoMode: 'realtime',
	container: 'webm',
	fps: 30,
	bitrateMbps: 16,
	maxDurationSec: 60,
	isRecording: false,
	elapsedSec: 0,
	status: 'Idle'
});

// --- the offline handshake ----------------------------------------------------
//
// An offline take needs whatever drives the camera to advance on the SAME frame counter
// the encoder timestamps with, and to stall when the encoder is behind. That is a
// per-frame conversation between two tasks in different extensions, so it is a plain
// object and deliberately NOT `$state`: both sides touch it every frame, and a reactive
// write there would wake the Studio panel at frame rate for no reason. Same reasoning as
// the sky descriptor (core/skybox/CLAUDE.md §14.1) — one writer per field, everyone reads
// from their own task.
//
// Order within a frame: the pose driver runs `{ before: autoRenderTask }`, decides whether
// to advance, and LATCHES that decision in `posed`; the render happens; `Capture.svelte`
// runs `{ after: autoRenderTask }` and encodes iff the latch is set.
//
// THE LATCH IS THE WHOLE POINT, and getting it wrong is what made early offline takes
// twitchy. `saturated` is asynchronous — the encoder's promise can resolve at any moment,
// including *between* the pose driver's task and the capture task within a single frame. An
// earlier version had both sides read `saturated` directly, so a resolution landing in that
// window meant the pose driver held its pose while the capture task went ahead and encoded
// anyway: the same pose encoded twice. With motion blur on (it is enabled by default) the
// first copy carries a full frame of velocity and the duplicate carries none, so the output
// alternates blurred and sharp frames. Whether it happened at all came down to promise
// timing, which is why it was intermittent and worst at the start of a take, when the
// encoder is cold.
//
// One decision, made once per frame, by one side. Capture never second-guesses it.

export const captureRuntime = {
	/** True only while an offline take is in flight. Realtime takes leave this alone. */
	offline: false,
	/**
	 * A pose driver owns the clock for this take (flypath's 🎬). When false the take is
	 * undriven — a bare offline Record — and capture paces itself off the queue instead.
	 */
	driven: false,
	/**
	 * THE LATCH. Set by the pose driver on frames it actually advanced and posed; consumed
	 * (and cleared) by the capture task after the render. A frame the driver held is a frame
	 * that must not be encoded, whatever the encoder's state has become in the meantime.
	 */
	posed: false,
	/**
	 * The encode queue is at its depth limit — the pose driver must hold this frame. NOT a
	 * simple "encoder busy": frames are queued several deep on purpose, because holding is
	 * itself mildly destructive (the sky keeps animating on the wall clock, and the
	 * afterimage feedback buffer keeps accumulating, on a frame the take will not use).
	 * Holds should be rare, and at this depth they are.
	 */
	saturated: false,
	/** Scene seconds one encoded frame represents. The pose driver advances by exactly this. */
	frameStep: 1 / 30
};

// --- driver slot -------------------------------------------------------------

let driver: CaptureDriver | null = null;

export const registerCaptureDriver = (value: CaptureDriver): void => {
	driver = value;
};

export const unregisterCaptureDriver = (): void => {
	driver = null;
};

// --- actions -----------------------------------------------------------------

const requireDriver = (what: string): CaptureDriver | null => {
	if (!driver) {
		logEngine.warn(`Capture: ${what} ignored — no driver mounted (is <Capture /> in App.svelte?)`);
		captureState.status = 'No driver mounted';
	}
	return driver;
};

export const captureActions: CaptureActions = {
	setImageFormat(format) {
		captureState.imageFormat = format;
	},
	setImageQuality(quality) {
		captureState.imageQuality = quality;
	},
	setVideoMode(mode) {
		if (captureState.isRecording) return;
		captureState.videoMode = mode;
	},
	setContainer(container) {
		if (captureState.isRecording) return;
		captureState.container = container;
	},
	setFps(fps) {
		captureState.fps = fps;
	},
	setBitrateMbps(bitrate) {
		captureState.bitrateMbps = bitrate;
	},
	setMaxDurationSec(seconds) {
		captureState.maxDurationSec = seconds;
	},
	screenshot() {
		requireDriver('screenshot')?.screenshot();
	},
	toggleRecording() {
		const active = requireDriver('recording');
		if (!active) return;
		if (captureState.isRecording) active.stopRecording();
		else active.startRecording();
	},
	startRecording() {
		if (captureState.isRecording) return;
		requireDriver('startRecording')?.startRecording();
	},
	stopRecording() {
		if (!captureState.isRecording) return;
		requireDriver('stopRecording')?.stopRecording();
	}
};
