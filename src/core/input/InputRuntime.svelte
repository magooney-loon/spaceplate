<script lang="ts">
	// Draws nothing. Gives the slot system the two things it can only get from
	// inside the Canvas: its FRAME (the stamp that makes `justPressed` observable),
	// and the gamepad.
	//
	// ── Why it has its own stage, ahead of simulation ────────────────────────────
	// Edges are stamped with the frame that will observe them (`frameId + 1`). For a
	// physics task to see the same edge the render stage sees, the counter has to
	// advance BEFORE the simulation stage — the app's order is `resize → simulation →
	// synchronization → mainStage → renderStage` (core/utils/PhysicsWorld.svelte), so
	// a main-stage advance would show an edge to the render stage one frame before
	// physics saw it. Hence a dedicated stage pinned `before: simulationStage`, which
	// makes this component's mount point load-bearing: it goes INSIDE <PhysicsWorld>,
	// where that stage exists.
	//
	// The task must run every animation frame, rendered or not — an edge stamped
	// while on-demand rendering is idle still has to expire. A plain stage task does;
	// `{ after: autoRenderTask }` would not.
	import { onDestroy } from 'svelte';
	import { useStage, useTask, useThrelte } from '@threlte/core/webgpu';
	import { useRapier } from '@threlte/rapier';
	import { advanceInputFrame, inputState, setInputChangeHandler } from '$extensions/input';
	import GamepadInput from './GamepadInput.svelte';

	const { simulationStage } = useRapier();
	const { invalidate } = useThrelte();
	const inputStage = useStage('input', { before: simulationStage });

	useTask('input.frame', advanceInputFrame, { stage: inputStage, autoInvalidate: false });

	// On-demand rendering: a stick pushed in an otherwise still scene has to ask for
	// the frame that will show the result. Registered rather than imported so the
	// input extension stays free of Threlte context.
	setInputChangeHandler(invalidate);
	onDestroy(() => setInputChangeHandler(null));

	// The connected-pad list is the System tab's, and window events are the only
	// hotplug signal that works without polling. useGamepad tracks its OWN pad's
	// connection separately — this is the roster, not the reading.
	function scanPads() {
		if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
		inputState.runtime.connectedGamepads = [...navigator.getGamepads()]
			.filter((p): p is Gamepad => !!p?.connected)
			.map((p) => ({ index: p.index, id: p.id }));
	}
	scanPads();
</script>

<svelte:window ongamepadconnected={scanPads} ongamepaddisconnected={scanPads} />

<!-- useGamepad takes its options once, so a pad change is a fresh instance. -->
{#key inputState.gamepad.index}
	<GamepadInput index={inputState.gamepad.index} />
{/key}
