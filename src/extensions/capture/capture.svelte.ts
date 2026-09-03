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
	CaptureResolution,
	CaptureState,
	CaptureVideoMode
} from './types';

export { CAPTURE_RESOLUTIONS, captureResolutionSize } from './types';

export const captureState = $state<CaptureState>({
	imageFormat: 'png',
	imageQuality: 0.92,
	resolution: 'viewport',
	videoMode: 'realtime',
	container: 'webm',
	fps: 30,
	bitrateMbps: 16,
	maxDurationSec: 60,
	isRecording: false,
	isFinalizing: false,
	elapsedSec: 0,
	status: 'Idle'
});

// --- the offline handshake ----------------------------------------------------
//
// An offline take needs everything that animates to advance on the SAME frame counter the
// encoder timestamps with, and to stall when the encoder is behind. The advancing is not
// arranged here — an offline take takes over the ENGINE CLOCK (core/utils/engineClock.ts),
// which substitutes a fixed step for the frame's real delta upstream of every task in the
// app, so the camera, the sky, the TSL layers and physics all move by one encoded frame per
// encoded frame without knowing anything about capture.
//
// What is left here is the frame's verdict, shared between the clock source (which decides,
// before anything runs) and the capture task (which encodes, after the render). It is a
// plain object and deliberately NOT `$state`: both are touched every frame, and a reactive
// write there would wake the Studio panel at frame rate for no reason. Same reasoning as
// the sky descriptor (the descriptor contract, core/skybox/CLAUDE.md) — one writer per
// field, everyone reads from their own task.
//
// THE LATCH IS THE WHOLE POINT, and getting it wrong is what made early offline takes
// twitchy. `saturated` is asynchronous — the encoder's promise can resolve at any moment,
// including *between* the clock's decision and the capture task within a single frame. An
// earlier version had both sides read `saturated` directly, so a resolution landing in that
// window meant the scene held still while the capture task went ahead and encoded anyway:
// the same pose encoded twice. With motion blur on (it is enabled by default) the first copy
// carries a full frame of velocity and the duplicate carries none, so the output alternates
// blurred and sharp frames. Whether it happened at all came down to promise timing, which is
// why it was intermittent and worst at the start of a take, when the encoder is cold.
//
// One decision, made once per frame, by one side. Capture never second-guesses it.

export const captureRuntime = {
	/** True only while an offline take is in flight. Realtime takes leave this alone. */
	offline: false,
	/**
	 * THE LATCH. Set by the clock source (`Capture.svelte`'s `offlineStep`) on frames it let
	 * scene time advance on; consumed (and cleared) by the capture task after the render. A
	 * frame the clock held is a frame that must not be encoded, whatever the encoder's state
	 * has become in the meantime.
	 */
	posed: false,
	/**
	 * The encode queue is at its depth limit — the clock must hold this frame. NOT a simple
	 * "encoder busy": frames are queued several deep on purpose, because a hold costs the
	 * take a frame of wall-clock time for nothing. Holds should be rare, and at this depth
	 * they are.
	 */
	saturated: false,
	/** Scene seconds one encoded frame represents. The engine clock advances by exactly this. */
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
	isBusy() {
		return captureState.isRecording || captureState.isFinalizing;
	},
	setImageFormat(format) {
		captureState.imageFormat = format;
	},
	setImageQuality(quality) {
		captureState.imageQuality = quality;
	},
	// Refused mid-take like the other structural settings: the recording canvas is sized
	// once at the start, and the renderer override is released by whoever installed it.
	setResolution(resolution) {
		if (this.isBusy()) return;
		captureState.resolution = resolution;
	},
	setVideoMode(mode) {
		if (this.isBusy()) return;
		captureState.videoMode = mode;
	},
	setContainer(container) {
		if (this.isBusy()) return;
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
		// Refused, not queued: the previous take's file is still being written, and its
		// download has not fired yet. Starting another one now would resize the shared
		// recording canvas out from under it.
		else if (!captureState.isFinalizing) active.startRecording();
	},
	startRecording() {
		if (this.isBusy()) return;
		requireDriver('startRecording')?.startRecording();
	},
	stopRecording() {
		if (!captureState.isRecording) return;
		requireDriver('stopRecording')?.stopRecording();
	}
};
