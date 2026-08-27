import { settingsState, overlayState } from '$extensions/settings/settings.svelte';
import { logInput } from '$extensions/logger/logger.svelte';

/**
 * Radians per pixel of mouse movement at sensitivity 1.0.
 * Multiplied by the user's mouse/aim sensitivity setting.
 */
export const BASE_SENS = 0.004;

/**
 * Max plausible single-event delta in px. Some browsers emit one huge
 * movementX/Y burst when pointer lock engages — clamp to keep the view
 * from snapping.
 */
const MAX_EVENT_DELTA = 300;

/** Pitch clamp (radians) — slightly under straight up/down. */
const PITCH_LIMIT = Math.PI / 2.2;

/** Cooldown before re-requesting pointer lock after a failed request (browser throttling). */
const POINTER_LOCK_RETRY_COOLDOWN_MS = 800;

export type MouseLookState = {
	yaw: number;
	pitch: number;
	enabled: boolean;
	isLocked: boolean;
	aiming: boolean;
};

export const mouseLookState = $state<MouseLookState>({
	yaw: 0,
	pitch: 0,
	enabled: false,
	isLocked: false,
	aiming: false
});

let requestInFlight = false;
let retryAfter = 0;

const clampDelta = (v: number): number => Math.max(-MAX_EVENT_DELTA, Math.min(MAX_EVENT_DELTA, v));

const currentSens = (): number =>
	BASE_SENS *
	(mouseLookState.aiming
		? settingsState.general.aimSensitivity
		: settingsState.general.mouseSensitivity);

export const mouseLookActions = {
	/**
	 * Apply a raw mousemove event. Deltas are only consumed while pointer-locked —
	 * unlocked movementX/Y units differ between browsers/DPI modes, locked ones
	 * are consistent (CSS pixels).
	 */
	handleMouseMove(e: MouseEvent) {
		if (!mouseLookState.enabled || !document.pointerLockElement) return;
		const dx = clampDelta(e.movementX);
		const dy = clampDelta(e.movementY);
		const sens = currentSens();
		mouseLookState.yaw -= dx * sens;
		mouseLookState.pitch = Math.max(
			-PITCH_LIMIT,
			Math.min(PITCH_LIMIT, mouseLookState.pitch - dy * sens)
		);
	},

	/**
	 * Request pointer lock on document.body (NOT the canvas — avoids WebGL
	 * driver interaction). Handles promise-based and legacy implementations,
	 * and throttles retries after errors.
	 */
	requestLock() {
		if (!mouseLookState.enabled) return;
		if (import.meta.env.VITE_GAME_ENGINE === 'true') return; // Studio needs a free cursor
		if (overlayState.settingsOpen) return;
		if (document.pointerLockElement || requestInFlight) return;
		if (Date.now() < retryAfter) return;

		requestInFlight = true;
		try {
			const req = document.body.requestPointerLock() as Promise<void> | undefined;
			if (req && typeof req.catch === 'function') {
				req
					.catch(() => {
						retryAfter = Date.now() + POINTER_LOCK_RETRY_COOLDOWN_MS;
					})
					.finally(() => {
						requestInFlight = false;
					});
			} else {
				// Legacy browsers return undefined — success is observed via pointerlockchange
				requestInFlight = false;
			}
		} catch {
			retryAfter = Date.now() + POINTER_LOCK_RETRY_COOLDOWN_MS;
			requestInFlight = false;
		}
	},

	exitLock() {
		try {
			document.exitPointerLock();
		} catch {
			/* ignore browser edge-case errors */
		}
	},

	syncLockState() {
		mouseLookState.isLocked = !!document.pointerLockElement;
		if (mouseLookState.isLocked) requestInFlight = false;
	},

	onLockError() {
		requestInFlight = false;
		retryAfter = Date.now() + POINTER_LOCK_RETRY_COOLDOWN_MS;
		logInput.warn('Pointer lock request failed — retry available after cooldown');
	},

	reset() {
		mouseLookState.yaw = 0;
		mouseLookState.pitch = 0;
	}
};
