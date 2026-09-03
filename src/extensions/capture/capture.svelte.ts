// Capture state + the driver slot.
//
// The state lives here (always reactive, works without Studio, per the extension rules in
// extensions/CLAUDE.md). The one thing it CANNOT own is the driver: the renderer, the
// render task and the MediaRecorder all need to be inside <Canvas>, so `Capture.svelte`
// implements CaptureDriver and registers it here — the same register/unregister shape
// already used by scenes/DemoScene/mirrorFloor.ts.

import { logEngine } from '$extensions/logger';
import type { CaptureActions, CaptureDriver, CaptureState } from './types';

export type { CaptureActions, CaptureDriver, CaptureImageFormat, CaptureState } from './types';

export const captureState = $state<CaptureState>({
	imageFormat: 'png',
	imageQuality: 0.92,
	fps: 30,
	bitrateMbps: 16,
	maxDurationSec: 60,
	isRecording: false,
	elapsedSec: 0,
	status: 'Idle'
});

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
