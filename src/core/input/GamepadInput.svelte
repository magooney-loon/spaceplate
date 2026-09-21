<script lang="ts">
	// Wraps `useGamepad` (@threlte/extras), read once per frame into the registry's
	// device state. See input/CLAUDE.md.
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

	// Deadzone applied HERE (not useGamepad's `axisDeadzone`, a hard per-pad cut): per-stick,
	// magnitude rescaled from (deadzone…1] onto (0…1] so a slow stick stays usable.
	// `untrack` — reading `index` once is the contract; the parent's `{#key}` remounts on change.
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

	// `after: gamepad.task` — right behind the poll that fills it, in useGamepad's main
	// stage; the input frame stage runs earlier (before simulation) and would read stale data.
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
