<script lang="ts">
	import { untrack } from 'svelte';
	import { mouseLookState, mouseLookActions } from '$core/mouseLook.svelte';
	import { overlayState } from '$extensions/settings';
	import { inputQueries } from '$extensions/input';

	/**
	 * Mouse-look rig — mount inside a scene to enable pointer-locked mouse look.
	 * Aim sensitivity demo: `secondaryAction` (RMB / Q) engages aimSensitivity.
	 */

	function isUiTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return !!target.closest('button, input, select, textarea, a, label, kbd');
	}

	function onMouseMove(e: MouseEvent) {
		mouseLookState.aiming = inputQueries.isPressed('player1', 'secondaryAction');
		mouseLookActions.handleMouseMove(e);
	}

	function onPointerLockChange() {
		mouseLookActions.syncLockState();
	}

	function onPointerLockError() {
		mouseLookActions.onLockError();
	}

	// Fallback: engage lock on first non-UI click / keydown if auto-lock was blocked
	function onInteraction(e: Event) {
		if (e.type === 'click' && isUiTarget(e.target)) return;
		if (e instanceof KeyboardEvent && e.code === 'Escape') return;
		mouseLookActions.requestLock();
	}

	function onContextMenu(e: MouseEvent) {
		if (mouseLookState.isLocked) e.preventDefault();
	}

	$effect(() => {
		// Studio mode (VITE_GAME_ENGINE=true) needs a free cursor for its editor UI —
		// the rig becomes a complete no-op: no listeners, no lock requests.
		if (import.meta.env.VITE_GAME_ENGINE === 'true') return;

		mouseLookState.enabled = true;
		mouseLookActions.reset();

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('pointerlockchange', onPointerLockChange);
		document.addEventListener('pointerlockerror', onPointerLockError);
		document.addEventListener('click', onInteraction);
		document.addEventListener('keydown', onInteraction);
		document.addEventListener('contextmenu', onContextMenu);

		// Auto-request once on mount — succeeds when entering via a recent user
		// gesture (e.g. the Start Demo click); otherwise the interaction fallback engages.
		untrack(() => mouseLookActions.requestLock());

		return () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('pointerlockchange', onPointerLockChange);
			document.removeEventListener('pointerlockerror', onPointerLockError);
			document.removeEventListener('click', onInteraction);
			document.removeEventListener('keydown', onInteraction);
			document.removeEventListener('contextmenu', onContextMenu);
			mouseLookActions.exitLock();
			mouseLookState.enabled = false;
		};
	});

	// Release pointer lock whenever the settings overlay opens
	$effect(() => {
		if (overlayState.settingsOpen) mouseLookActions.exitLock();
	});
</script>
