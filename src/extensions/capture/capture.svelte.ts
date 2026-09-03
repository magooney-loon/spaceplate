// Capture state + the two wiring slots the feature needs.
//
// The state lives here (always reactive, works without Studio, per the extension rules in
// extensions/CLAUDE.md). The two things it CANNOT own are filled in by components:
//
//   - the driver — the renderer, the render task and the MediaRecorder all need to be
//     inside <Canvas>, so `Capture.svelte` implements CaptureDriver and registers it.
//   - the studio objects — `useStudio()` only resolves inside <Studio>, and Capture.svelte
//     is deliberately mounted OUTSIDE it (see its header for why), so
//     `CaptureExtension.svelte` publishes the registry's object set through here.
//
// Both are the register/unregister shape already used by scenes/DemoScene/mirrorFloor.ts.

import type { Object3D } from 'three/webgpu';
import { logEngine } from '$extensions/logger';
import type { CaptureActions, CaptureDriver, CaptureState } from './types';

export type { CaptureActions, CaptureDriver, CaptureImageFormat, CaptureState } from './types';

export const captureState = $state<CaptureState>({
	imageFormat: 'png',
	imageQuality: 0.92,
	fps: 30,
	bitrateMbps: 16,
	maxDurationSec: 60,
	hideStudioObjects: true,
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

// --- studio objects slot -----------------------------------------------------

let studioObjects: (() => Iterable<Object3D>) | null = null;

/**
 * Publishes Studio's `studio-objects-registry` set. That registry holds every 3D object
 * Studio itself puts in the scene — the grid, axes/light/group helpers, transform
 * controls and the selection-outline quad — because Studio needs to exclude them from
 * raycasting. Hiding exactly that set is what makes a capture clean.
 */
export const registerStudioObjects = (get: () => Iterable<Object3D>): void => {
	studioObjects = get;
};

export const unregisterStudioObjects = (): void => {
	studioObjects = null;
};

/** Snapshot, not the live set — the caller mutates `visible` while iterating it. */
export const getStudioObjects = (): Object3D[] => (studioObjects ? [...studioObjects()] : []);

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
	setHideStudioObjects(hide) {
		captureState.hideStudioObjects = hide;
	},
	screenshot() {
		requireDriver('screenshot')?.screenshot();
	},
	toggleRecording() {
		const active = requireDriver('recording');
		if (!active) return;
		if (captureState.isRecording) active.stopRecording();
		else active.startRecording();
	}
};
