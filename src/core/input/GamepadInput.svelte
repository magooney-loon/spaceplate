<script lang="ts">
	// The gamepad half of the slot system: `useGamepad` from @threlte/extras, read
	// once per frame into the registry's device state.
	//
	// WRAPPED, NOT REIMPLEMENTED. useGamepad already owns standard-mapping button
	// names, the vendor:product table for non-standard pads, hotplug, analog trigger
	// values and its own `autoInvalidate: false` polling task — and its button names
	// (`clusterBottom`, `leftTrigger`, …) are the ones this project's binding types
	// were copied from in the first place. What it does not do is bindings,
	// persistence or a settings UI, which is exactly the part that lives here.
	//
	// KEYED ON THE PAD INDEX by the parent: useGamepad takes its options once, so
	// selecting a different pad means a fresh instance.
	import { untrack } from 'svelte';
	import { useTask } from '@threlte/core/webgpu';
	import { useGamepad } from '@threlte/extras';
	import { applyGamepadFrame, inputState } from '$extensions/input';
	import type { GamepadButton, GamepadStick, Vec2 } from '$extensions/input';

	interface Props {
		/** `null` = whichever pad connects first. */
		index: number | null;
	}
	let { index }: Props = $props();

	const BUTTONS: GamepadButton[] = [
		'clusterBottom',
		'clusterRight',
		'clusterLeft',
		'clusterTop',
		'leftBumper',
		'rightBumper',
		'leftTrigger',
		'rightTrigger',
		'select',
		'start',
		'center',
		'leftStickButton',
		'rightStickButton',
		'directionalTop',
		'directionalBottom',
		'directionalLeft',
		'directionalRight'
	];

	// Deadzone is applied HERE, not by useGamepad: its `axisDeadzone` is one number
	// for the whole pad and a hard cut, while the settings expose a per-stick value
	// and a slow stick should stay usable. So: 0 there, radial + RESCALED here —
	// magnitude is remapped from (deadzone…1] onto (0…1], which keeps small
	// deflections available instead of snapping to zero and then jumping.
	// `untrack` because reading `index` once IS the contract: useGamepad takes its
	// options at construction, and the parent's `{#key}` remounts us when it changes.
	const gamepad = useGamepad({ index: untrack(() => index) ?? undefined, axisDeadzone: 0 });

	const buttons = new Map<GamepadButton, number>();
	const sticks: Record<GamepadStick, Vec2> = {
		leftStick: { x: 0, y: 0 },
		rightStick: { x: 0, y: 0 }
	};

	function readStick(name: GamepadStick, deadzone: number): void {
		const src = gamepad.stick(name);
		const out = sticks[name];
		const mag = Math.hypot(src.x, src.y);
		if (mag <= deadzone || mag === 0) {
			out.x = 0;
			out.y = 0;
			return;
		}
		const scale = Math.min((mag - deadzone) / (1 - deadzone), 1) / mag;
		out.x = src.x * scale;
		out.y = src.y * scale;
	}

	function clear(): void {
		buttons.clear();
		sticks.leftStick.x = sticks.leftStick.y = 0;
		sticks.rightStick.x = sticks.rightStick.y = 0;
	}

	let wasLive = false;

	// Registered `after: gamepad.task` — which puts it in useGamepad's own (main)
	// stage, right behind the poll that fills it. The input frame stage runs earlier,
	// before simulation, so a poll placed there would read the PREVIOUS frame's
	// snapshot; this reads the current one.
	useTask(
		'input.gamepad',
		() => {
			const live = inputState.gamepad.enabled && gamepad.connected.current;
			if (!live) {
				// One last zeroed frame on unplug, so a held trigger doesn't stay held.
				if (wasLive) {
					clear();
					applyGamepadFrame(buttons, sticks);
					wasLive = false;
				}
				return;
			}
			wasLive = true;
			for (const name of BUTTONS) buttons.set(name, gamepad.button(name).value);
			readStick('leftStick', inputState.gamepad.deadzoneLeftStick);
			readStick('rightStick', inputState.gamepad.deadzoneRightStick);
			applyGamepadFrame(buttons, sticks);
		},
		{ after: gamepad.task, autoInvalidate: false }
	);
</script>
