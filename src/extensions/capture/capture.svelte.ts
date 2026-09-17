// Capture state + the driver slot. The driver (renderer, render task, encoder) must live
// inside <Canvas>, so `Capture.svelte` implements CaptureDriver and registers it here —
// see capture/CLAUDE.md for the state shape and how a take is timed.

import { logEngine } from '$extensions/logger';
import type { CaptureActions, CaptureDriver, CaptureState } from './types';

export type {
	CaptureActions,
	CaptureContainer,
	CaptureDriver,
	CaptureImageFormat,
	CaptureResolution,
	CaptureState
} from './types';

export { CAPTURE_RESOLUTIONS, captureResolutionSize } from './types';

export const captureState = $state<CaptureState>({
	imageFormat: 'png',
	imageQuality: 0.92,
	resolution: '1080p',
	container: 'webm',
	fps: 30,
	bitrateMbps: 16,
	maxDurationSec: 60,
	isRecording: false,
	isFinalizing: false,
	elapsedSec: 0,
	status: 'Idle'
});

// --- the take handshake -------------------------------------------------------
// A take takes over the engine clock (core/utils/engineClock.ts); this object is the
// per-frame verdict shared between the clock source and the capture task. Plain, not
// $state — both sides touch it every frame. Full story: capture/CLAUDE.md.

export const captureRuntime = {
	/**
	 * Set by the clock source on frames it let scene time advance; cleared by the capture
	 * task after render. A held frame must never be encoded.
	 */
	posed: false,
	/**
	 * Encode queue at its depth limit — the clock must hold this frame. Not "encoder busy":
	 * frames queue several deep on purpose since a hold costs a frame for nothing.
	 */
	saturated: false,
	/** Scene seconds one encoded frame represents; the engine clock advances by exactly this. */
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
	setContainer(container) {
		if (this.isBusy()) return;
		captureState.container = container;
	},
	// Refused mid-take too, and not because it would break anything: the encoder captured
	// both at creation and `frameStep` was latched at start, so a change here during a take
	// is silently INERT. Refusing keeps the panel honest about that.
	setFps(fps) {
		if (this.isBusy()) return;
		captureState.fps = fps;
	},
	setBitrateMbps(bitrate) {
		if (this.isBusy()) return;
		captureState.bitrateMbps = bitrate;
	},
	// NOT refused mid-take — the cap is re-read every frame, so lowering it stops the
	// running take early, which is a useful thing to be able to do.
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
