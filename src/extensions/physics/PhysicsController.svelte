<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { useRapier } from '@threlte/rapier';
	import { logPhysics } from '$extensions/logger/logger.svelte';
	import { physicsState } from './physics.svelte';

	const { world, rigidBodyObjects, colliderObjects } = useRapier();

	const snapshotWorld = () => {
		let rigidBodies = 0;
		let colliders = 0;

		world.forEachRigidBody(() => {
			rigidBodies += 1;
		});

		world.forEachCollider(() => {
			colliders += 1;
		});

		return {
			rigidBodies,
			colliders,
			rigidBodyObjects: rigidBodyObjects.size,
			colliderObjects: colliderObjects.size,
			gravity: { ...world.gravity },
			framerate: physicsState.framerate
		};
	};

	onMount(() => {
		logPhysics.info('PhysicsController mount', snapshotWorld());
	});

	onDestroy(() => {
		logPhysics.info('PhysicsController destroy', snapshotWorld());
	});

	$effect(() => {
		world.gravity = {
			x: physicsState.gravityX,
			y: physicsState.gravityY,
			z: physicsState.gravityZ
		};
		logPhysics.info('World gravity updated', { ...world.gravity });
	});
</script>
