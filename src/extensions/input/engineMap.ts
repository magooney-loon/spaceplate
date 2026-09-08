// The ONE map the engine ships. Everything else is a game's business.
//
// Both slots are `system: true` — declared here so there is a single source of
// truth for what Escape does, but hidden from the rebind UI: they are the shortcuts
// that reach the settings overlay, and a player who unbinds them locks themselves
// out of the screen that would let them bind them back.

import { defineInputMap, key, pad, activateInputMap } from './input.svelte';

export const engineControls = defineInputMap({
	id: 'engine',
	label: 'Engine',
	slots: {
		openSettings: {
			label: 'Settings',
			group: 'Engine',
			system: true,
			defaults: [key('Escape'), pad('select')]
		},
		/**
		 * Ctrl+H. A CHORD, which the slot system deliberately cannot express — it is a
		 * dev/screenshot shortcut, not gameplay, so it stays hardcoded in
		 * `Keymapper.svelte` and this slot exists only to name it in one place.
		 */
		toggleUi: { label: 'Toggle UI', group: 'Engine', system: true, defaults: [] }
	}
});

// Active for the life of the app — never released.
activateInputMap(engineControls);
