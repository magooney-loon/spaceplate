// THE CAR'S INPUT MAP — this scene's half of the engine's slot system
// (src/extensions/input/CLAUDE.md). It replaces the scene-local `svelte:window`
// keymap that used to live in carSwitches.svelte.ts: the engine owns the keys, the
// rebinding, the persistence and the settings rows now, and this file says only
// what the car's inputs are CALLED and what they default to.
//
// Plain .ts on purpose — a map definition is data. The handle is a module
// singleton, so `sim/controller.ts` and `TestGame.svelte` import it directly the
// way they imported `carInput` before; nothing is drilled through props.
//
// ── Key choice ───────────────────────────────────────────────────────────────
// Unchanged from the hand-rolled keymap, and for the same reason: Studio's
// dev-mode toolbar binds bare `w a s z t r c v m`, so the car deliberately uses
// arrows / Space / Q / E / Shift and L K G B for the switches (Shift is a
// modifier — Studio's bare-letter binds never see it). M IS in Studio's set and
// stays there as an accepted collision; it is now FLAGGED in Settings ▸ Controls
// (amber chip) rather than only being written down.
//
// ── What is NOT here ─────────────────────────────────────────────────────────
// The latched switches themselves. `lights`, `ignition`, `handling` and `view`
// are plain button slots as far as the engine is concerned — it presses them, and
// carSwitches.svelte.ts decides what latching one MEANS. A headlight being a switch
// and a handbrake being a pedal is game semantics, and putting it in the engine is
// how the old FPS action enum happened.

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
	'ignition',
	'view',
	'units'
] as const;

export type CarToggleSlot = (typeof CAR_TOGGLE_SLOTS)[number];
