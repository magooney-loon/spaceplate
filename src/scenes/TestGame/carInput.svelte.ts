// TestGame's own keyboard state — deliberately NOT the shared keymapper
// ($extensions/input): that system needs a rework for per-scene action maps, and the
// chosen keys (arrows / Space / Q / E) exist precisely because Studio's dev-mode
// shortcuts don't bind them (Studio binds bare w a s z t r c v m — see
// CarHeadlights.svelte's sibling notes / TestGame.svelte).
//
// The state is $state (not plain) so a future HUD can show gear/input reactively;
// the driving task itself just polls it per physics step.

export const carInput = $state({
	up: false,
	down: false,
	left: false,
	right: false,
	handbrake: false,
	shiftUp: false,
	shiftDown: false
});

export type CarInputAction = keyof typeof carInput;

/** e.code → action. Everything not in here is ignored (and never preventDefaulted). */
export const CAR_INPUT_KEYS: Record<string, CarInputAction> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
	Space: 'handbrake',
	KeyE: 'shiftUp',
	KeyQ: 'shiftDown'
};

export const resetCarInput = (): void => {
	for (const key of Object.keys(carInput) as CarInputAction[]) {
		carInput[key] = false;
	}
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

export type CarToggleAction = 'lights' | 'highBeam';

/** e.code → switch. L and H are free of both Studio's binds and Ctrl+H (UI toggle). */
export const CAR_TOGGLE_KEYS: Record<string, CarToggleAction> = {
	KeyL: 'lights',
	KeyH: 'highBeam'
};

/** Edge-triggered: call once per keydown, never on auto-repeat. */
export const applyCarToggle = (action: CarToggleAction): void => {
	if (action === 'lights') {
		carLights.on = !carLights.on;
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
