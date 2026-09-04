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
