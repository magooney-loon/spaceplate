<script lang="ts">
	// Draws nothing. Gives the slot system its FRAME (the stamp that makes
	// `justPressed` observable) and the gamepad. Edges are stamped `frameId + 1`, so
	// this stage must advance BEFORE simulation — a main-stage advance would show an
	// edge to the render stage one frame before physics saw it — hence a dedicated
	// stage pinned `before: simulationStage`, mounted INSIDE <PhysicsWorld>.
	import { onDestroy } from 'svelte';
	import { useStage, useTask, useThrelte } from '@threlte/core/webgpu';
	import { useRapier } from '@threlte/rapier';
	import { advanceInputFrame, inputState, setInputChangeHandler } from '$extensions/input';
	import GamepadInput from './GamepadInput.svelte';

	const { simulationStage } = useRapier();
	const { invalidate } = useThrelte();
	const inputStage = useStage('input', { before: simulationStage });

	useTask('input.frame', advanceInputFrame, { stage: inputStage, autoInvalidate: false });

	// Registered (not imported) so the input extension stays free of Threlte context.
	setInputChangeHandler(invalidate);
	onDestroy(() => setInputChangeHandler(null));

	// The System tab's connected-pad roster (not the reading — useGamepad tracks its
	// own pad's connection separately). Window events are the only hotplug signal
	// that works without polling.
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
