// THE CAR'S LATCHED STATE — the half of the car's input that is a SWITCH rather
// than a pedal, plus the HUD → scene restart signal.
//
// The pedals used to live here too, behind a hand-rolled `svelte:window` keymap.
// They are the engine's now: `sim/carControls.ts` declares the slots and
// `$extensions/input` owns the keys, the rebinding, the persistence, the held-code
// bookkeeping (both Shift keys as one pedal) and the blur release. What is LEFT here
// is what the engine deliberately has no opinion about — that a headlight is a
// switch, that flicking to main beam turns the lamps on, that the ignition runs a
// startup sequence. The engine presses `lights`; this file decides what that means.
//
// Everything below LATCHES: it flips on the press edge (TestGame.svelte subscribes
// with `carControls.on(slot, 'press', …)`, which fires exactly once per real press —
// no auto-repeat to filter), and it deliberately survives scene exit and Restart.
// Coming back to the car with the lights you left on is the point.

import { HANDLING_MODES, type HandlingMode } from './handling';
import type { CarToggleSlot } from './carControls';

// --- Lights -------------------------------------------------------------------

/** Read by CarHeadlights.svelte, which owns what low vs high beam actually means. */
export const carLights = $state({
	/** Master switch. Off is fully dark — no pool, no beams, no lit lens. */
	on: true,
	/** High beam: no cutoff, aimed level, longer and brighter throw. */
	high: false
});

/**
 * Ignition — one toggle (the `ignition` slot). A latched switch like the lights: it
 * survives the Restart button. The ENGINE AUDIO follows it (carAudio
 * gates the bed/pops/nitrous and voices turnon/turnoff); the driving model is
 * also gated — throttle, brake and shifting do nothing until `ready` is true.
 *
 * Sequence: toggle on → `on = true`, `ready = false` (turnon sound plays, RPM revs to
 * ~2k then settles). When the turnon sound ends, `ready = true` and the idle
 * bed fades in — only then can the player drive. Toggle off → everything cuts instantly
 * (`on = false`, `ready = false`, bed silences under the turnoff shot).
 *
 * Note: its default key M collides with Studio's dev-mode binds (w a s z t r c v m) —
 * accepted, Studio is dev-only, and Settings ▸ Controls now flags the chip amber so
 * it can be rebound by anyone it bites.
 */
export const carIgnition = $state({ on: true, ready: true });

/**
 * The selected setup — Grip (the validated road car) or Drift (a loose rear axle
 * and real oversteer). See handling.ts for what actually changes. A switch, not a
 * pedal: it survives the Restart button, and the controller reads the current car's
 * `tunes[mode]` fresh every physics step, so flipping it mid-corner is legal and
 * instant.
 */
export const carHandling = $state({ mode: 'grip' as HandlingMode });

export const setHandlingMode = (mode: HandlingMode): void => {
	carHandling.mode = mode;
};

export const cycleHandlingMode = (): void => {
	const next = (HANDLING_MODES.indexOf(carHandling.mode) + 1) % HANDLING_MODES.length;
	carHandling.mode = HANDLING_MODES[next];
};

// --- View -----------------------------------------------------------------------
//
// What the camera looks AT: the full car model, the debug rig (wheels / axles /
// suspension — the kinematics the driving model actually computes, see
// debug/DebugRig.svelte), or both overlaid. A latched switch like the lights —
// the view you chose is the view you come back to.

export const VIEW_MODES = ['model', 'rig', 'both'] as const;
export type CarViewMode = (typeof VIEW_MODES)[number];

export const carView = $state({ mode: 'model' as CarViewMode });

/**
 * What the cluster's LCD speed window reads in. A DISPLAY switch — the telemetry
 * publishes both `kmh` and `mph` either way (carTelemetry), so this picks which of
 * the two the big readout shows and never touches a number the car computes. Latched
 * like the rest: the units you drove in are the units you come back to.
 */
export const carUnits = $state({ imperial: false });

export const cycleCarView = (): void => {
	const next = (VIEW_MODES.indexOf(carView.mode) + 1) % VIEW_MODES.length;
	carView.mode = VIEW_MODES[next];
};

/**
 * What a press of one of the toggle SLOTS means — the game semantics the engine
 * deliberately has none of. TestGame.svelte wires it up with
 * `carControls.on(slot, 'press', () => applyCarToggle(slot))`, which fires exactly
 * once per real press: there is no auto-repeat to filter out here any more, because
 * an `on()` edge is not a keydown.
 */
export const applyCarToggle = (action: CarToggleSlot): void => {
	if (action === 'lights') {
		carLights.on = !carLights.on;
		return;
	}
	if (action === 'handling') {
		cycleHandlingMode();
		return;
	}
	if (action === 'ignition') {
		if (carIgnition.on) {
			carIgnition.on = false;
			carIgnition.ready = false;
		} else {
			carIgnition.on = true;
			carIgnition.ready = false;
		}
		return;
	}
	if (action === 'view') {
		cycleCarView();
		return;
	}
	if (action === 'units') {
		carUnits.imperial = !carUnits.imperial;
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
// A token, not a flag, so it works twice in a row. Not a slot: it is a BUTTON in the
// HUD, not something the player binds a key to.

export const carRestart = $state({ token: 0 });

export const requestCarRestart = (): void => {
	carRestart.token++;
};
