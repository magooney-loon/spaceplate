<script lang="ts">
	import { useRapier } from '@threlte/rapier';
	import { physicsState } from './physics.svelte';

	const { world } = useRapier();

	$effect(() => {
		world.gravity = { x: 0, y: physicsState.gravity, z: 0 };
	});
</script>
