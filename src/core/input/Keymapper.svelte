<script lang="ts">
	// The app's ONE keyboard/mouse listener. Owns the DOM concerns — typing guards,
	// preventDefault, the rebind capture flow — and hands device state to the slot
	// registry ($extensions/input). See input/CLAUDE.md for why it's outside <Canvas>.
	import { onDestroy } from 'svelte';
	import {
		engineControls,
		inputActions,
		inputState,
		isCodeBound,
		key,
		mouse,
		setKeyDown,
		setMouseDown,
		releaseAllDevices
	} from '$extensions/input';
	import type { MouseButton } from '$extensions/input';
	import { generalActions, overlayState } from '$extensions/settings';
	import { sceneState } from '$extensions/scene';
	import { isTypingTarget, isUiTarget } from './domGuards';

	function toggleSettingsOverlay() {
		if (sceneState.currentScene === 'mainMenu') {
			overlayState.settingsOpen = !overlayState.settingsOpen;
		} else {
			// In-game: the settings key only opens, never closes — use the Back button to close
			overlayState.settingsOpen = true;
		}
	}

	onDestroy(engineControls.on('openSettings', 'press', toggleSettingsOverlay));

	const buttonOf = (e: MouseEvent): MouseButton | null =>
		e.button === 0 ? 'left' : e.button === 2 ? 'right' : e.button === 1 ? 'middle' : null;

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl+H — a CHORD, which slots deliberately cannot express. Hardcoded here,
		// named by the engine map's `toggleUi` slot.
		if (e.ctrlKey && e.key === 'h') {
			e.preventDefault();
			generalActions.toggleUiVisible();
			return;
		}

		// Capture: the next key IS the binding. Escape always cancels instead.
		if (inputState.capture.active) {
			e.preventDefault();
			const { mapId, slotId, dir } = inputState.capture;
			if (e.code === 'Escape' || !mapId || !slotId) inputActions.cancelCapture();
			else inputActions.bind(mapId, slotId, key(e.code, dir));
			return;
		}

		if (isTypingTarget(e.target)) return;
		// Modifier chords belong to the browser and to Ctrl+H, never to a slot.
		if (e.ctrlKey || e.metaKey) return;

		// Only keys that actually drive an ACTIVE slot are swallowed — arrows must not
		// scroll the page while driving, and an unbound key must stay the browser's.
		// BEFORE the auto-repeat bail: a held ArrowDown fires repeats, and skipping
		// those would scroll the page from the second event on.
		if (isCodeBound(e.code)) e.preventDefault();

		if (e.repeat) return;
		setKeyDown(e.code, true);
	}

	// Keyup is NEVER guarded. A key pressed in the game and released after focus
	// moved into a tweakpane field would otherwise stay held forever.
	function handleKeyup(e: KeyboardEvent) {
		setKeyDown(e.code, false);
	}

	function handleMousedown(e: MouseEvent) {
		const button = buttonOf(e);
		if (!button) return;

		if (inputState.capture.active) {
			// Clicking the settings UI itself is operating the UI, not binding a button.
			if (isUiTarget(e.target)) return;
			const { mapId, slotId, dir } = inputState.capture;
			if (mapId && slotId) inputActions.bind(mapId, slotId, mouse(button, dir));
			return;
		}

		setMouseDown(button, true);
	}

	function handleMouseup(e: MouseEvent) {
		const button = buttonOf(e);
		if (button) setMouseDown(button, false);
	}

	// Blur and tab-hide release everything: a key let go while the window was
	// unfocused never sends a keyup, and a stuck pedal is the result.
	const handleBlur = () => releaseAllDevices();
	const handleVisibility = () => {
		if (document.hidden) releaseAllDevices();
	};
</script>

<svelte:window
	onkeydown={handleKeydown}
	onkeyup={handleKeyup}
	onmousedown={handleMousedown}
	onmouseup={handleMouseup}
	onblur={handleBlur}
/>

<svelte:document onvisibilitychange={handleVisibility} />
