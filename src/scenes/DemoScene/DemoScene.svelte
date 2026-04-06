<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T } from '@threlte/core';
	import { interactivity } from '@threlte/extras';
	import { RigidBody, Collider, Debug, Attractor, useRapier } from '@threlte/rapier';
	import { physicsState } from '$extensions/physics/physics.svelte';
	import PhysicsController from '$extensions/physics/PhysicsController.svelte';
	import { logPhysics } from '$extensions/logger/logger.svelte';
	import DemoPhysicsBodies from './DemoPhysicsBodies.svelte';
	import DemoFloor from './DemoFloor.svelte';
	import DemoDistanceMarkers from './DemoDistanceMarkers.svelte';

	interactivity();

	const sceneMountId = crypto.randomUUID().slice(0, 8);
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
			spawnedBodies: physicsState.bodies.length
		};
	};

	onMount(() => {
		logPhysics.info(`DemoScene mount [${sceneMountId}]`, snapshotWorld());
	});

	onDestroy(() => {
		logPhysics.info(`DemoScene destroy [${sceneMountId}]`, snapshotWorld());
	});
</script>

<PhysicsController />

{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
	{#if physicsState.debug}
		<Debug />
	{/if}
{/if}

{#if physicsState.attractorEnabled}
	<Attractor
		position={[physicsState.attractorX, physicsState.attractorY, physicsState.attractorZ]}
		strength={physicsState.attractorStrength}
		range={physicsState.attractorRange}
		gravityType={physicsState.attractorGravityType}
	/>
{/if}

<DemoFloor />
<DemoDistanceMarkers />
<DemoPhysicsBodies />

<!-- Spawned physics bodies -->
{#each physicsState.bodies as body (body.id)}
	<T.Group position={body.position} userData={{ selectable: false, hideInTree: true }}>
		<RigidBody
			type="dynamic"
			ccd={body.ccd}
			canSleep={body.canSleep}
			linearDamping={body.linearDamping}
			angularDamping={body.angularDamping}
			gravityScale={body.gravityScale}
			userData={{ selectable: false, hideInTree: true }}
			oncreate={(rigidBody) => {
				logPhysics.info(`Spawned body create [${sceneMountId}]`, {
					id: body.id,
					type: body.type,
					initialPosition: body.position,
					handle: rigidBody.handle
				});
			}}
			onsleep={() => {
				logPhysics.info(`Spawned body sleep [${sceneMountId}]`, { id: body.id });
			}}
			onwake={() => {
				logPhysics.info(`Spawned body wake [${sceneMountId}]`, { id: body.id });
			}}
		>
			{#if body.type === 'ball'}
				<Collider
					shape="ball"
					args={[0.4]}
					restitution={body.restitution}
					friction={body.friction}
				/>
				<T.Mesh castShadow>
					<T.SphereGeometry args={[0.4, 16, 16]} />
					<T.MeshStandardMaterial color={body.color} flatShading />
				</T.Mesh>
			{:else}
				<Collider
					shape="cuboid"
					args={[0.4, 0.4, 0.4]}
					restitution={body.restitution}
					friction={body.friction}
				/>
				<T.Mesh castShadow>
					<T.BoxGeometry args={[0.8, 0.8, 0.8]} />
					<T.MeshStandardMaterial color={body.color} flatShading />
				</T.Mesh>
			{/if}
		</RigidBody>
	</T.Group>
{/each}

{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
	{#await import('$extensions/gltf-viewer/GltfViewerScene.svelte') then { default: GltfViewerScene }}
		<GltfViewerScene />
	{/await}
{/if}
