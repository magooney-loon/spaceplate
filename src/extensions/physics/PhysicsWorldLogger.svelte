<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { World as RapierWorld } from '@dimforge/rapier3d-compat';
	import { useRapier } from '@threlte/rapier';
	import { logPhysics } from '$extensions/logger/logger.svelte';
	import { physicsState } from './physics.svelte';

	const { world } = useRapier();
	const mountId = crypto.randomUUID().slice(0, 8);

	const snapshotWorld = (rapierWorld: RapierWorld) => {
		let rigidBodies = 0;
		let colliders = 0;

		rapierWorld.forEachRigidBody(() => {
			rigidBodies += 1;
		});

		rapierWorld.forEachCollider(() => {
			colliders += 1;
		});

		return {
			rigidBodies,
			colliders,
			gravity: { ...rapierWorld.gravity },
			framerate: physicsState.framerate
		};
	};

	onMount(() => {
		logPhysics.info(`World mount [${mountId}]`, snapshotWorld(world));
	});

	onDestroy(() => {
		logPhysics.info(`World destroy [${mountId}]`, snapshotWorld(world));
	});
</script>
