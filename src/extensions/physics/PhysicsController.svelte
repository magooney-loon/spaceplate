<script lang="ts">
	import { useRapier } from '@threlte/rapier';
	import { physicsState } from './physics.svelte';

	const { world } = useRapier();

	$effect(() => {
		world.gravity = { x: physicsState.gravityX, y: physicsState.gravityY, z: physicsState.gravityZ };
	});
</script>
