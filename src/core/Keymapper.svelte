<script lang="ts">
	import { inputState, inputActions } from '$extensions/input/input.svelte';
	import type { InputAction, MouseButton } from '$extensions/input/types';
	import { generalActions } from '$extensions/settings/settings.svelte';

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl+H — global engine shortcut, not routed through keymapper
		if (e.ctrlKey && e.key === 'h') {
			e.preventDefault();
			generalActions.toggleUiVisible();
			return;
		}
		if (e.repeat) return;
		inputState.runtime.keyboardPressed[e.code] = true;
		inputState.runtime.lastInputSource = 'keyboard';
		if (inputState.capture.active && inputState.capture.bindingType === 'action') {
			if (e.code === 'Escape') {
				inputActions.cancelCapture();
			} else if (inputState.capture.playerId && inputState.capture.action) {
				inputActions.bindKeyboard(
					inputState.capture.playerId,
					inputState.capture.action as InputAction,
					e.code
				);
			}
		}
	}

	function handleKeyup(e: KeyboardEvent) {
		inputState.runtime.keyboardPressed[e.code] = false;
	}

	function handleMousedown(e: MouseEvent) {
		const btn: MouseButton | null =
			e.button === 0 ? 'left' : e.button === 2 ? 'right' : e.button === 1 ? 'middle' : null;
		if (!btn) return;
		inputState.runtime.mousePressed[btn] = true;
		inputState.runtime.lastInputSource = 'mouse';
		if (
			inputState.capture.active &&
			inputState.capture.bindingType === 'action' &&
			inputState.capture.playerId &&
			inputState.capture.action
		) {
			inputActions.bindMouse(
				inputState.capture.playerId,
				inputState.capture.action as InputAction,
				btn
			);
		}
	}

	function handleMouseup(e: MouseEvent) {
		const btn: MouseButton | null =
			e.button === 0 ? 'left' : e.button === 2 ? 'right' : e.button === 1 ? 'middle' : null;
		if (!btn) return;
		inputState.runtime.mousePressed[btn] = false;
	}

	function handleBlur() {
		inputState.runtime.keyboardPressed = {};
		inputState.runtime.mousePressed = { left: false, right: false, middle: false };
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onkeyup={handleKeyup}
	onmousedown={handleMousedown}
	onmouseup={handleMouseup}
	onblur={handleBlur}
/>
