// TestGame's own keyboard state — deliberately NOT the shared keymapper
// ($extensions/input): that system needs a rework for per-scene action maps, and
// the chosen keys (arrows / Space / Q / E / Shift) exist precisely because
// Studio's dev-mode shortcuts don't bind them (Studio binds bare w a s z t r c v m
// — Shift is a modifier, so its bare-letter binds never see it; see
// CarHeadlights.svelte's sibling notes / TestGame.svelte).
//
// The state is $state (not plain) so a future HUD can show gear/input reactively;
// the driving task itself just polls it per physics step.

import { HANDLING_MODES, type HandlingMode } from './handling';

export const carInput = $state({
	up: false,
	down: false,
	left: false,
	right: false,
	handbrake: false,
	shiftUp: false,
	shiftDown: false,
	/** Either Shift key — held. A pedal, not a switch: nitrous only flows while
	 * one is down AND the throttle is open in a forward gear (TestGame.svelte owns
	 * that gating and the bottle itself). */
	nitrous: false
});

export type CarInputAction = keyof typeof carInput;

/**
 * e.code → action. Everything not in here is ignored (and never preventDefaulted).
 * Nitrous is BOTH Shift keys — one pedal, either side — which is why key edges go
 * through `setCarInputKey` below: releasing one Shift must not drop the pedal
 * while the other is still held.
 */
export const CAR_INPUT_KEYS: Record<string, CarInputAction> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
	Space: 'handbrake',
	KeyE: 'shiftUp',
	KeyQ: 'shiftDown',
	ShiftLeft: 'nitrous',
	ShiftRight: 'nitrous'
};

/** The reverse of the map above — which e.codes feed each action. Built once so
 * key edges don't allocate. */
const ACTION_CODES = {} as Record<CarInputAction, string[]>;
for (const [code, action] of Object.entries(CAR_INPUT_KEYS)) {
	(ACTION_CODES[action] ??= []).push(code);
}

/** Physically held codes. Cleared by `resetCarInput` — a Shift released while the
 * window is blurred would otherwise keep the pedal stuck down after refocus. */
const heldCodes = new Set<string>();

/**
 * Apply one key EDGE (keydown/keyup) by e.code. The scene's handlers own the DOM
 * concerns (typing-target checks, preventDefault) and call this for the state
 * change: the action stays down while ANY of its codes is held.
 */
export const setCarInputKey = (code: string, down: boolean): void => {
	const action = CAR_INPUT_KEYS[code];
	if (!action) return;
	if (down) heldCodes.add(code);
	else heldCodes.delete(code);
	carInput[action] = ACTION_CODES[action].some((c) => heldCodes.has(c));
};

export const resetCarInput = (): void => {
	for (const key of Object.keys(carInput) as CarInputAction[]) {
		carInput[key] = false;
	}
	heldCodes.clear();
};

// --- Switches -----------------------------------------------------------------
//
// Held keys above, LATCHED ones here: a headlight is a switch, not a pedal, so it
// flips once per keydown and `resetCarInput` (blur, scene exit) must not touch it —
// coming back to the scene with the lights you left on is the point.

/** Read by CarHeadlights.svelte, which owns what low vs high beam actually means. */
export const carLights = $state({
	/** Master switch. Off is fully dark — no pool, no beams, no lit lens. */
	on: true,
	/** High beam: no cutoff, aimed level, longer and brighter throw. */
	high: false
});

/**
 * Ignition — M on, N off. A latched switch like the lights: it survives
 * `resetCarInput` and the Restart button. The ENGINE AUDIO follows it (carAudio
 * gates the bed/pops/nitrous and voices turnon/turnoff); the driving model does
 * not (yet) — arcade v1, the car keeps driving silently, which reads as an EV
 * mode more than a dead engine. Note: M collides with Studio's dev-mode bind
 * (w a s z t r c v m) — accepted for now, Studio is dev-only.
 */
export const carIgnition = $state({ on: true });

/**
 * The selected setup — Grip (the validated road car) or Drift (a loose rear axle
 * and real oversteer). See handling.ts for what actually changes. A switch, not a
 * pedal: it survives `resetCarInput` and the Restart button, and the scene reads
 * `HANDLING_TUNES[mode]` fresh every physics step, so flipping it mid-corner is
 * legal and instant.
 */
export const carHandling = $state({ mode: 'grip' as HandlingMode });

export const setHandlingMode = (mode: HandlingMode): void => {
	carHandling.mode = mode;
};

export const cycleHandlingMode = (): void => {
	const next = (HANDLING_MODES.indexOf(carHandling.mode) + 1) % HANDLING_MODES.length;
	carHandling.mode = HANDLING_MODES[next];
};

export type CarToggleAction = 'lights' | 'highBeam' | 'handling' | 'ignOn' | 'ignOff';

/**
 * e.code → switch. L, K and G are free of both Studio's dev binds (w a s z t r c v m)
 * and the engine's own Ctrl+H (UI toggle); M is IN Studio's set — see carIgnition's
 * note; N is free.
 */
export const CAR_TOGGLE_KEYS: Record<string, CarToggleAction> = {
	KeyL: 'lights',
	KeyK: 'highBeam',
	KeyG: 'handling',
	KeyM: 'ignOn',
	KeyN: 'ignOff'
};

/** Edge-triggered: call once per keydown, never on auto-repeat. */
export const applyCarToggle = (action: CarToggleAction): void => {
	if (action === 'lights') {
		carLights.on = !carLights.on;
		return;
	}
	if (action === 'handling') {
		cycleHandlingMode();
		return;
	}
	if (action === 'ignOn') {
		carIgnition.on = true;
		return;
	}
	if (action === 'ignOff') {
		carIgnition.on = false;
		return;
	}
	// Flicking to main beam turns the lamps on — a dead key with the lights off is
	// just a bug report waiting to happen. Dipping again leaves them on, as in a car.
	carLights.high = !carLights.high;
	if (carLights.high) carLights.on = true;
};

// --- Restart ------------------------------------------------------------------
//
// The HUD's Restart button can't reach the scene's locals (HUD and scene are
// siblings — SceneHud.svelte / Scene.svelte mount them separately), so it bumps
// a token here and TestGame.svelte's $effect puts the car back at its spawn pose.
// A token, not a flag, so it works twice in a row. Not a key in `carInput`: it is
// an edge event, not a held pedal, and `resetCarInput` must not clear it.

export const carRestart = $state({ token: 0 });

export const requestCarRestart = (): void => {
	carRestart.token++;
};
