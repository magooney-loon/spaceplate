<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T, useThrelte } from '@threlte/core/webgpu';
	import { Collider, Attractor, useRapier } from '@threlte/rapier';
	import * as THREE from 'three/webgpu';
	import { reflector } from 'three/tsl';
	import { physicsState } from '$extensions/physics';
	import PhysicsController from '$extensions/physics/PhysicsController.svelte';
	import { logPhysics } from '$extensions/logger';
	import DemoPhysicsBodies from './DemoPhysicsBodies.svelte';
	import SpawnedBodies from './SpawnedBodies.svelte';
	import { LENS_LAYER } from '$core/skybox/layers/skyLayer';
	import { registerMirrorFloor, unregisterMirrorFloor } from './mirrorFloor';
	import { DEMO_QUALITY } from './demoQuality';
	import { settingsState } from '$extensions/settings';

	const { scene, invalidate } = useThrelte();

	// Mirror floor. bounces stays at its DEFAULT (true) ON PURPOSE: that makes the
	// reflector re-render per render-pass, so every camera that draws the floor gets
	// its own reflection RT — with bounces: false the single per-frame refresh
	// anchored to whichever camera drew first and slid with the editor camera.
	// Reflection rides the emissive slot (keeps the sky system's lighting/shadows on
	// the gray base), clamped because the RT holds RAW HDR dome radiance (render-target
	// passes skip tone mapping). resolutionScale starts here and is retuned by the
	// quality preset below.
	const reflection = reflector({ resolutionScale: 0.5 });
	reflection.target.rotateX(-Math.PI / 2);
	reflection.target.userData = { selectable: false, hideInTree: true };
	scene.add(reflection.target);

	// THE REFLECTOR'S VIRTUAL CAMERA IS A CLONE, SO IT INHERITS THE LAYER MASK:
	// `ReflectorNode.getVirtualCamera()` clones the active camera, which (unlike the
	// freshly-constructed cube cameras) carries every layer bit it has enabled — measured
	// `mask=3`, so the floor was reflecting LENS_LAYER's screen-space rain/frost quads as
	// blown-out bloom garbage. Stripped here rather than in the lens layers because the
	// inheritance is a property of THIS reflector; PRECIPITATION_LAYER stays inherited on
	// purpose, so rain/snow keep showing in the floor's reflection.
	const baseGetVirtualCamera = reflection.reflector.getVirtualCamera.bind(reflection.reflector);
	reflection.reflector.getVirtualCamera = (camera: THREE.Camera) => {
		const virtual = baseGetVirtualCamera(camera);
		virtual.layers.disable(LENS_LAYER);
		return virtual;
	};

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
	});
</script>

<PhysicsController />

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

<SpawnedBodies mountId={sceneMountId} />

{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
	{#await import('$extensions/gltf-viewer/GltfViewerScene.svelte') then { default: GltfViewerScene }}
		<GltfViewerScene />
	{/await}
{/if}
