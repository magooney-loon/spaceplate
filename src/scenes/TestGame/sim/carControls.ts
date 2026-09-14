// THE CAR'S INPUT MAP — this scene's half of the engine's slot system
// (src/extensions/input/CLAUDE.md): what the car's inputs are CALLED and
// what they default to. The engine owns the keys, rebinding and persistence;
// `carSwitches.svelte.ts` decides what latching a switch MEANS (data, not
// logic, lives here). Plain .ts, module singleton — see CLAUDE.md's Controls
// section for the key-choice rationale (Studio's bare-letter binds, M's
// flagged collision).

import { defineInputMap, key, pad, stick } from '$extensions/input';

export const carControls = defineInputMap({
	id: 'testgame.car',
	label: 'Car',
	slots: {
		throttle: {
			label: 'Throttle',
			group: 'Driving',
			defaults: [key('ArrowUp'), pad('rightTrigger')]
		},
		brake: {
			label: 'Brake',
			group: 'Driving',
			defaults: [key('ArrowDown'), pad('leftTrigger')]
		},
		/**
		 * SCREEN convention: − is left, + is right, which is what the settings chips
		 * read as. The driving model's own sign is the opposite (+ = left), and
		 * `controller.ts` negates it at exactly one line — see the comment there.
		 *
		 * One slot rather than two, so the stick binding is analog: with a pad this
		 * is proportional steering, with the arrows it is exactly ±1 or 0, which is
		 * what the keyboard produced before. The validated tune is untouched.
		 */
		steer: {
			type: 'axis',
			label: 'Steering',
			group: 'Driving',
			defaults: [key('ArrowLeft', -1), key('ArrowRight', 1), stick('leftStick', 'x')]
		},
		handbrake: {
			label: 'Handbrake',
			group: 'Driving',
			defaults: [key('Space'), pad('clusterBottom')]
		},
		/**
		 * Both Shift keys are ONE pedal — which is now just two bindings on one slot.
		 * The held-code bookkeeping that used to make that work (`ACTION_CODES`,
		 * `heldCodes`, `setCarInputKey`) is the engine's, and so is releasing it on
		 * blur.
		 */
		nitrous: {
			label: 'Nitrous',
			group: 'Driving',
			defaults: [key('ShiftLeft'), key('ShiftRight'), pad('clusterRight')]
		},

		shiftUp: {
			label: 'Shift Up',
			group: 'Gearbox',
			defaults: [key('KeyE'), pad('rightBumper')]
		},
		shiftDown: {
			label: 'Shift Down',
			group: 'Gearbox',
			defaults: [key('KeyQ'), pad('leftBumper')]
		},
		/**
		 * Manual ↔ automatic. H for the H-PATTERN gate you are giving up, and it is
		 * one of the few letters free of both Studio's bare-letter binds and the
		 * car's own: the engine's only H is the Ctrl+H chord, which Keymapper
		 * requires the modifier for. On a pad it is the right stick's click — every
		 * face and d-pad button is already a switch.
		 */
		gearbox: {
			label: 'Manual / Automatic',
			group: 'Gearbox',
			defaults: [key('KeyH'), pad('rightStickButton')]
		},

		lights: { label: 'Headlights', group: 'Car', defaults: [key('KeyL'), pad('directionalLeft')] },
		highBeam: { label: 'Main Beam', group: 'Car', defaults: [key('KeyK'), pad('directionalTop')] },
		handling: {
			label: 'Handling Setup',
			group: 'Car',
			defaults: [key('KeyG'), pad('directionalRight')]
		},
		/** M collides with Studio's bare-letter binds — accepted, and flagged in Settings. */
		ignition: { label: 'Ignition', group: 'Car', defaults: [key('KeyM'), pad('clusterTop')] },
		view: {
			label: 'View / Debug Rig',
			group: 'Car',
			defaults: [key('KeyB'), pad('directionalBottom')]
		},
		/** km/h ↔ mph on the cluster's LCD. U is free of Studio's bare-letter set. */
		units: { label: 'Speed Units', group: 'Car', defaults: [key('KeyU'), pad('clusterLeft')] }
	}
});

/** The slots that LATCH something — subscribed as press edges by TestGame.svelte. */
export const CAR_TOGGLE_SLOTS = [
	'lights',
	'highBeam',
	'handling',
	'gearbox',
	'ignition',
	'view',
	'units'
] as const;

export type CarToggleSlot = (typeof CAR_TOGGLE_SLOTS)[number];
