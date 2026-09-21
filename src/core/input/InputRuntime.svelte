<script lang="ts">
	// Gives the slot system its frame (the stamp that makes `justPressed` observable).
	// Must advance before simulation, or the render stage would see an edge one frame
	// before physics did — hence its own stage pinned `before: simulationStage`.
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
