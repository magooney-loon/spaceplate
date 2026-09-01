<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T, useThrelte } from '@threlte/core/webgpu';
	import { interactivity } from '@threlte/extras';
	import { RigidBody, Collider, Debug, Attractor, useRapier } from '@threlte/rapier';
	import * as THREE from 'three/webgpu';
	import { reflector } from 'three/tsl';
	import { physicsState } from '$extensions/physics';
	import PhysicsController from '$extensions/physics/PhysicsController.svelte';
	import { logPhysics } from '$extensions/logger';
	import DemoPhysicsBodies from './DemoPhysicsBodies.svelte';

	interactivity();

	const { scene } = useThrelte();

	// Mirror floor (plain gray + reflection). The reflector's target is
	// transform-only (rotated flat, it defines the mirror plane at y = 0 under the
	// floor plate). bounces is left at its DEFAULT (true) ON PURPOSE: that sets the
	// reflector's update type to per-render-pass, so every camera that renders the
	// floor (Studio's PiP game-cam and selection pre-renders, the editor camera,
	// the mirror sphere's cube faces) re-renders the reflection RT for itself. With
	// bounces: false it refreshed once per frame for whichever camera drew first,
	// and under the Studio editor camera the reflection slid with the camera
	// instead of staying anchored to the scene. The reflection rides the emissive
	// slot so the gray base keeps the sky system's lighting and shadows; clamped
	// because the reflector RT holds RAW HDR dome radiance (render-target passes
	// skip tone mapping) and the sunset sky peaks well past 1.
	const reflection = reflector({ resolutionScale: 0.5 });
	reflection.target.rotateX(-Math.PI / 2);
	reflection.target.userData = { selectable: false, hideInTree: true };
	scene.add(reflection.target);

	const floorMaterial = new THREE.MeshStandardNodeMaterial();
	floorMaterial.color.set('gray');
	floorMaterial.emissiveNode = reflection.rgb.clamp(0, 1).mul(0.25);

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
		reflection.target.removeFromParent();
		floorMaterial.dispose();
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

<T.Group userData={{ selectable: false, hideInTree: true }}>
	<Collider shape="cuboid" args={[10, 0, 10]} />
	<T.Mesh
		position={[0, 0, 0]}
		receiveShadow
		material={floorMaterial}
		userData={{ selectable: false, hideInTree: true }}
	>
		<T.BoxGeometry args={[20, 0.001, 20]} />
	</T.Mesh>
</T.Group>

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
