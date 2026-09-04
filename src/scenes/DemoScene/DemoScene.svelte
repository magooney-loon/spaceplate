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

	// THE REFLECTOR'S VIRTUAL CAMERA IS A CLONE, SO IT INHERITS THE LAYER MASK.
	// `ReflectorNode.getVirtualCamera()` is `camera.clone()`, and `Object3D.copy` copies
	// `layers.mask` (three 0.185, Object3D.js:1615) — so unlike the cube cameras, which
	// are constructed fresh with the default layer-0 mask, this one arrives with every
	// bit the active camera has enabled. Measured `mask=3` at runtime: bit 1 is
	// LENS_LAYER, so the floor was reflecting the screen-space rain/frost lens quads —
	// the "re-sampled, wrong-viewport garbage that reads as blown-out bloom" that
	// skyLayer.ts's LENS_LAYER comment exists to prevent, plus a second fullscreen
	// `viewportMipTexture` read per frame for the privilege.
	//
	// Stripping it here rather than in the lens layers is deliberate: the inheritance is
	// a property of THIS reflector, and PRECIPITATION_LAYER (bit 2) is inherited on
	// purpose — that is what keeps rain and snow in the floor's reflection while the cube
	// captures skip them.
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

<!-- Spawned physics bodies — one InstancedMesh per shape, see SpawnedBodies.svelte -->
<SpawnedBodies mountId={sceneMountId} />

{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
	{#await import('$extensions/gltf-viewer/GltfViewerScene.svelte') then { default: GltfViewerScene }}
		<GltfViewerScene />
	{/await}
{/if}
