<script lang="ts">
	import { inputState, inputActions } from '$extensions/input';
	import type { InputAction, MouseButton } from '$extensions/input';
	import { generalActions, overlayState } from '$extensions/settings';
	import { sceneState } from '$extensions/scene';

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return !!target.closest('input, textarea, select, [contenteditable="true"]');
	}

	function isActionBoundToKey(action: InputAction, code: string): boolean {
		return (inputState.players.player1.actions[action] ?? []).some(
			(binding) => binding.device === 'keyboard' && binding.code === code
		);
	}

	function toggleSettingsOverlay() {
		if (sceneState.currentScene === 'mainMenu') {
			overlayState.settingsOpen = !overlayState.settingsOpen;
		} else {
			// In-game: the settings key only opens, never closes — use the Back button to close
			overlayState.settingsOpen = true;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl+H — global engine shortcut, not routed through keymapper
		if (e.ctrlKey && e.key === 'h') {
			e.preventDefault();
			generalActions.toggleUiVisible();
			return;
		}
		if (e.repeat) return;

		if (
			!inputState.capture.active &&
			!isTypingTarget(e.target) &&
			isActionBoundToKey('openSettings', e.code)
		) {
			e.preventDefault();
			toggleSettingsOverlay();
		}

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
		// Don't capture mouse clicks on UI elements (buttons, inputs, etc.)
		const target = e.target as HTMLElement;
		if (target.closest('button, input, select, textarea, a, label')) return;
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
