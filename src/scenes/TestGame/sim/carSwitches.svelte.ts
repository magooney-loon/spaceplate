// THE CAR'S LATCHED STATE — the half of the car's input that is a SWITCH
// rather than a pedal, plus the HUD → scene restart signal. The engine owns
// the keys/pedals (`sim/carControls.ts`); this file decides what LATCHING one
// of its switch slots MEANS — see CLAUDE.md's Controls section. Everything
// below flips on the press edge (`carControls.on(slot, 'press', …)`) and
// deliberately survives scene exit and Restart.

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

/**
 * Traction control — one toggle, default OFF, and really the DRIVER-AIDS
 * switch: off also means no auto-blip on the manual box's shifts (the
 * drivetrain gates the rev-match on this latch). Read fresh every physics
 * step through the drivetrain's `tc` input (the same pattern as the gearbox's
 * `auto`), so flipping it mid-corner is legal and instant. On, the ECU
 * catches the driven wheels at the spec's `tcSlipSpeed`; off, nothing trims
 * the surplus torque — wheelspin is the driver's to manage.
 */
export const carTc = $state({ on: false });

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
 * What a press of each toggle SLOT means — the game semantics the engine
 * deliberately has none of.
 *
 * A TOTAL map over `CarToggleSlot`, not a chain of `if`s: the chain ended in a
 * bare fallthrough to the high beam, so adding a slot to `CAR_TOGGLE_SLOTS` and
 * forgetting to handle it here silently bound it to the headlights. Keyed by the
 * slot type, a missing entry is a compile error instead.
 */
const TOGGLES: Record<CarToggleSlot, () => void> = {
	lights: () => {
		carLights.on = !carLights.on;
	},
	// Flicking to main beam turns the lamps on — a dead key with the lights off is
	// just a bug report waiting to happen. Dipping again leaves them on, as in a car.
	highBeam: () => {
		carLights.high = !carLights.high;
		if (carLights.high) carLights.on = true;
	},
	tc: () => {
		carTc.on = !carTc.on;
	},
	gearbox: cycleGearboxMode,
	// Either way the engine is not `ready`: switching ON starts the crank-and-fire
	// sequence (sim/controller.ts runs it and clears the flag), switching OFF just
	// stops being ready.
	ignition: () => {
		carIgnition.on = !carIgnition.on;
		carIgnition.ready = false;
	},
	view: cycleCarView,
	units: () => {
		carUnits.imperial = !carUnits.imperial;
	}
};

/**
 * TestGame.svelte wires this up with
 * `carControls.on(slot, 'press', () => applyCarToggle(slot))`, which fires exactly
 * once per real press: there is no auto-repeat to filter out here any more, because
 * an `on()` edge is not a keydown.
 */
export const applyCarToggle = (action: CarToggleSlot): void => {
	TOGGLES[action]();
};

// --- Restart ------------------------------------------------------------------
//
// The HUD's Restart button can't reach the scene's locals (HUD and scene are
// siblings — SceneHud.svelte / Scene.svelte mount them separately), so it bumps
// a token here and PlayerCar.svelte's $effect puts the car back at its spawn pose.
// A token, not a flag, so it works twice in a row. Not a slot: it is a BUTTON in the
// HUD, not something the player binds a key to.

export const carRestart = $state({ token: 0 });

export const requestCarRestart = (): void => {
	carRestart.token++;
};
