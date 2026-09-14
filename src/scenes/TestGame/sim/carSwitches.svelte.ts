// THE CAR'S LATCHED STATE — the half of the car's input that is a SWITCH
// rather than a pedal, plus the HUD → scene restart signal. The engine owns
// the keys/pedals (`sim/carControls.ts`); this file decides what LATCHING one
// of its switch slots MEANS — see CLAUDE.md's Controls section. Everything
// below flips on the press edge (`carControls.on(slot, 'press', …)`) and
// deliberately survives scene exit and Restart.

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
 * Ignition — one toggle. `ready` gates the driving model (throttle/brake/
 * shift) and the engine audio's bed/pops/nitrous — see CLAUDE.md's Controls
 * section for the startup sequence.
 */
export const carIgnition = $state({ on: true, ready: true });

/** The selected setup — Grip or Drift (see handling.ts). Read fresh every
 *  physics step, so flipping mid-corner is legal and instant. */
export const carHandling = $state({ mode: 'grip' as HandlingMode });

export const setHandlingMode = (mode: HandlingMode): void => {
	carHandling.mode = mode;
};

export const cycleHandlingMode = (): void => {
	const next = (HANDLING_MODES.indexOf(carHandling.mode) + 1) % HANDLING_MODES.length;
	carHandling.mode = HANDLING_MODES[next];
};

/** MANUAL or AUTOMATIC — read fresh every physics step through the
 *  controller's `auto` input; see `sim/drivetrain.ts`'s `autoShift`. */
export const GEARBOX_MODES = ['manual', 'auto'] as const;
export type GearboxMode = (typeof GEARBOX_MODES)[number];

export const carGearbox = $state({ mode: 'manual' as GearboxMode });

export const cycleGearboxMode = (): void => {
	carGearbox.mode = carGearbox.mode === 'manual' ? 'auto' : 'manual';
};

// --- View -----------------------------------------------------------------------
// model / rig (debug/DebugRig.svelte) / both — a latched switch like the lights.

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
	if (action === 'gearbox') {
		cycleGearboxMode();
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
