<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T, useThrelte } from '@threlte/core/webgpu';
	import { RigidBody, Collider, Debug, Attractor, useRapier } from '@threlte/rapier';
	import * as THREE from 'three/webgpu';
	import { reflector } from 'three/tsl';
	import { physicsState } from '$extensions/physics';
	import PhysicsController from '$extensions/physics/PhysicsController.svelte';
	import { logPhysics } from '$extensions/logger';
	import DemoPhysicsBodies from './DemoPhysicsBodies.svelte';
	import { registerMirrorFloor, unregisterMirrorFloor } from './mirrorFloor';
	import { DEMO_QUALITY } from './demoQuality';
	import { settingsState } from '$extensions/settings';

	const { scene, invalidate } = useThrelte();

	// Mirror floor (plain gray + reflection). The reflector's target is
	// transform-only (rotated flat, it defines the mirror plane at y = 0 under the
	// floor plate). bounces is left at its DEFAULT (true) ON PURPOSE: that sets the
	// reflector's update type to per-render-pass, so every camera that renders the
	// floor (Studio's PiP game-cam and selection pre-renders, the editor camera,
	// the mirror sphere's cube faces) re-renders the reflection RT for itself — with
	// bounces: false the one per-frame refresh anchored it to whichever camera drew
	// first, and it slid with the editor camera. The reflection rides the emissive
	// slot so the gray base keeps the sky system's lighting and shadows; clamped
	// because the reflector RT holds RAW HDR dome radiance (render-target passes
	// skip tone mapping) and the sunset sky peaks well past 1. resolutionScale comes
	// from the quality preset (demoQuality.ts) and is applied below — full canvas
	// resolution on high is affordable because the cube captures swap the reflector
	// out (mirrorFloor.ts), so it renders once per frame. The value here is just the
	// starting one.
	const reflection = reflector({ resolutionScale: 0.5 });
	reflection.target.rotateX(-Math.PI / 2);
	reflection.target.userData = { selectable: false, hideInTree: true };
	scene.add(reflection.target);

	const floorMaterial = new THREE.MeshStandardNodeMaterial();
	floorMaterial.color.set('gray');
	floorMaterial.emissiveNode = reflection.rgb.clamp(0, 1).mul(0.25);

	// The same floor without the reflector node, swapped in for the duration of the cube
	// captures in DemoPhysicsBodies — see mirrorFloor.ts for what that saves (it is the
	// single biggest cost in this scene). Identical gray base, so the captures see the
	// floor lit and shadowed as usual, just not mirroring.
	const floorCaptureMaterial = new THREE.MeshStandardNodeMaterial();
	floorCaptureMaterial.color.set('gray');

	let floorMesh = $state.raw<THREE.Mesh>();
	$effect(() => {
		if (!floorMesh) return;
		registerMirrorFloor(floorMesh, floorMaterial, floorCaptureMaterial);
		return unregisterMirrorFloor;
	});

	// Quality preset — see demoQuality.ts for what each knob costs.
	const quality = $derived(DEMO_QUALITY[settingsState.graphics.quality]);

	// The reflector reads resolutionScale on its next update and resizes its target
	// there (ReflectorBaseNode._updateResolution), so this is all the switch needs.
	$effect(() => {
		reflection.reflector.resolutionScale = quality.reflectionScale;
		invalidate();
	});

	// One geometry per spawned-body shape instead of one per body: `<T.SphereGeometry>`
	// inside the {#each} below built (and uploaded) a fresh buffer for every spawn.
	// Materials stay per body — their colour is random per spawn.
	// The ball is rebuilt when the preset changes; the box has no segment count worth
	// scaling (12 triangles either way).
	const spawnBallGeometry = $derived(
		new THREE.SphereGeometry(0.4, quality.spawnBallSegments, quality.spawnBallSegments)
	);
	$effect(() => {
		const geometry = spawnBallGeometry;
		// Disposes the PREVIOUS geometry when the preset changes, and the last one on
		// unmount. Threlte never disposes a geometry passed as a prop (its disposal is
		// ref-counted over the objects it manages), so this is the only owner.
		return () => geometry.dispose();
	});
	const spawnBoxGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);

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
		floorCaptureMaterial.dispose();
		spawnBoxGeometry.dispose();
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
		bind:ref={floorMesh}
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
				<T.Mesh castShadow={quality.spawnShadows} geometry={spawnBallGeometry}>
					<T.MeshStandardMaterial color={body.color} flatShading />
				</T.Mesh>
			{:else}
				<Collider
					shape="cuboid"
					args={[0.4, 0.4, 0.4]}
					restitution={body.restitution}
					friction={body.friction}
				/>
				<T.Mesh castShadow={quality.spawnShadows} geometry={spawnBoxGeometry}>
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
