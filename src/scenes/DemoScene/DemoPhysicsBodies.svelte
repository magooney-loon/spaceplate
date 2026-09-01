<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T, useThrelte } from '@threlte/core/webgpu';
	import { PositionalAudio } from '@threlte/extras';
	import { RigidBody, Collider, usePhysicsTask, useRapier } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat';
	import * as THREE from 'three';
	import { FlakesTexture } from 'three/addons/textures/FlakesTexture.js';
	import { logPhysics } from '$extensions/logger';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$extensions/settings';

	const { state: soundState } = useSound();
	const { world } = useRapier();
	const { invalidate } = useThrelte();
	const POS_URL = `${BASE_URL}sounds/positional.mp3`;
	const mountId = crypto.randomUUID().slice(0, 8);

	// Bouncing sphere — circles the spot at [0, 2.5, 0] where the old icosahedron
	// used to sit. Radius 5 keeps it well inside the 20x20 floor and clear of the
	// corner balls (orbit reach 5.5 vs their inner edge at ~9.1).
	let sphereRb = $state.raw<RapierRigidBody>();
	let time = 0;
	let heartbeat = 0;

	// Textures vendored from the three.js clearcoat example
	// (DOCS/three.js-dev/examples/textures -> public/textures/clearcoat). Loaded the
	// way Moon.svelte loads its map: TextureLoader returns synchronously and the
	// callback invalidates so on-demand rendering picks the arrival up.
	const loadTex = (file: string) =>
		new THREE.TextureLoader().load(`${BASE_URL}textures/clearcoat/${file}`, () => invalidate());

	// The four materials from webgpu_clearcoat.html, adapted to this scene: no HDR
	// cube here — scene.environment is the baked procedural sky (Sky.svelte), so the
	// reflections track the live day cycle at its 0.25 environment intensity.
	const flakes = new THREE.CanvasTexture(new FlakesTexture());
	flakes.wrapS = THREE.RepeatWrapping;
	flakes.wrapT = THREE.RepeatWrapping;
	flakes.repeat.set(10, 6);
	flakes.anisotropy = 16;

	const carbonMap = loadTex('Carbon.png');
	carbonMap.colorSpace = THREE.SRGBColorSpace;
	carbonMap.wrapS = THREE.RepeatWrapping;
	carbonMap.wrapT = THREE.RepeatWrapping;
	carbonMap.repeat.set(10, 10);

	const carbonNormal = loadTex('Carbon_Normal.png');
	carbonNormal.wrapS = THREE.RepeatWrapping;
	carbonNormal.wrapT = THREE.RepeatWrapping;
	carbonNormal.repeat.set(10, 10);

	const golfNormal = loadTex('golfball.jpg');
	const scratchedGold = loadTex('Scratched_gold_01_1K_Normal.png');
	const waterNormal = loadTex('Water_1_M_Normal.jpg');

	// Car paint
	const carPaint = new THREE.MeshPhysicalMaterial({
		clearcoat: 1.0,
		clearcoatRoughness: 0.1,
		metalness: 0.9,
		roughness: 0.5,
		color: 0x0000ff,
		normalMap: flakes,
		normalScale: new THREE.Vector2(0.15, 0.15)
	});
	// Carbon fibers
	const fibers = new THREE.MeshPhysicalMaterial({
		roughness: 0.5,
		clearcoat: 1.0,
		clearcoatRoughness: 0.1,
		map: carbonMap,
		normalMap: carbonNormal
	});
	// Golf ball
	const golf = new THREE.MeshPhysicalMaterial({
		metalness: 0.0,
		roughness: 0.1,
		clearcoat: 1.0,
		normalMap: golfNormal,
		clearcoatNormalMap: scratchedGold,
		// y scale negated to compensate for normal map handedness (as in the example)
		clearcoatNormalScale: new THREE.Vector2(2.0, -2.0)
	});
	// Clearcoat + normal map
	const clearcoatNormal = new THREE.MeshPhysicalMaterial({
		clearcoat: 1.0,
		metalness: 1.0,
		color: 0xff0000,
		normalMap: waterNormal,
		normalScale: new THREE.Vector2(0.15, 0.15),
		clearcoatNormalMap: scratchedGold,
		clearcoatNormalScale: new THREE.Vector2(2.0, -2.0)
	});

	const ballGeometry = new THREE.SphereGeometry(0.8, 64, 32);

	// Four balls on the floor's corners, inset so they sit fully on it
	const EDGE_BALLS: { position: [number, number, number]; material: THREE.MeshPhysicalMaterial }[] =
		[
			{ position: [-7, 0.8, -7], material: carPaint },
			{ position: [7, 0.8, -7], material: fibers },
			{ position: [-7, 0.8, 7], material: golf },
			{ position: [7, 0.8, 7], material: clearcoatNormal }
		];
	const ballMeshes: (THREE.Mesh | undefined)[] = [];
	let ballYaw = 0;

	const snapshotWorld = () => {
		let rigidBodies = 0;
		let colliders = 0;

		world.forEachRigidBody(() => {
			rigidBodies += 1;
		});

		world.forEachCollider(() => {
			colliders += 1;
		});

		return { rigidBodies, colliders };
	};

	const readTranslation = (body?: RapierRigidBody) => {
		if (!body) return null;
		try {
			if (!body.isValid()) return null;
			const t = body.translation();
			return { x: t.x, y: t.y, z: t.z };
		} catch {
			return null;
		}
	};

	onMount(() => {
		logPhysics.info(`DemoPhysicsBodies mount [${mountId}]`, snapshotWorld());
	});

	onDestroy(() => {
		logPhysics.info(`DemoPhysicsBodies destroy [${mountId}]`, {
			...snapshotWorld(),
			sphere: readTranslation(sphereRb)
		});

		// Manual THREE resources — T.* disposes its own, these are ours
		for (const ball of EDGE_BALLS) ball.material.dispose();
		ballGeometry.dispose();
		flakes.dispose();
		carbonMap.dispose();
		carbonNormal.dispose();
		golfNormal.dispose();
		scratchedGold.dispose();
		waterNormal.dispose();
	});

	usePhysicsTask((delta) => {
		// Corner balls: cosmetic yaw only — their sphere colliders are rotation-invariant,
		// so the fixed bodies never need to move. 0.3 rad/s ≈ the example's 0.005/frame.
		ballYaw += delta * 0.3;
		for (const mesh of ballMeshes) {
			if (mesh) mesh.rotation.y = ballYaw;
		}

		// Bouncing sphere orbit
		if (sphereRb) {
			time += delta;
			const x = Math.sin(time * 0.5) * 5;
			const z = Math.cos(time * 0.5) * 5;
			const y = Math.sin(time) * 1.5 + 2.5;
			const rotQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(time, 0, 0));
			sphereRb.setNextKinematicTranslation({ x, y, z });
			sphereRb.setNextKinematicRotation({ x: rotQ.x, y: rotQ.y, z: rotQ.z, w: rotQ.w });
		}

		heartbeat += delta;
		if (heartbeat >= 1) {
			heartbeat = 0;
			logPhysics.info(`DemoPhysicsBodies heartbeat [${mountId}]`, {
				time: Number(time.toFixed(3)),
				ballYaw: Number(ballYaw.toFixed(3)),
				sphere: readTranslation(sphereRb)
			});
		}
	});
</script>

<!-- Corner balls — fixed bodies, spawned bodies bounce off them -->
{#each EDGE_BALLS as ball, i}
	<T.Group position={ball.position} userData={{ selectable: false, hideInTree: true }}>
		<RigidBody
			type="fixed"
			oncreate={(rigidBody) => {
				logPhysics.info(`Edge ball ${i} create [${mountId}]`, { handle: rigidBody.handle });
			}}
		>
			<Collider shape="ball" args={[0.8]} />
			<T.Mesh
				bind:ref={ballMeshes[i]}
				geometry={ballGeometry}
				material={ball.material}
				castShadow
			/>
		</RigidBody>
	</T.Group>
{/each}

<!-- Orbiting bouncing sphere — kinematic, collides with dynamic bodies -->
<T.Group userData={{ selectable: false, hideInTree: true }}>
	<RigidBody
		type="kinematicPosition"
		bind:rigidBody={sphereRb}
		oncreate={(rigidBody) => {
			logPhysics.info(`Orbit sphere create [${mountId}]`, {
				handle: rigidBody.handle,
				translation: readTranslation(rigidBody)
			});
		}}
		onsleep={() => {
			logPhysics.info(`Orbit sphere sleep [${mountId}]`);
		}}
		onwake={() => {
			logPhysics.info(`Orbit sphere wake [${mountId}]`);
		}}
	>
		<Collider shape="ball" args={[0.5]} />
		<T.Mesh castShadow>
			<T.SphereGeometry args={[0.5, 32, 32]} />
			<T.MeshStandardMaterial color="#d94a4a" flatShading />

			<PositionalAudio
				src={POS_URL}
				volume={settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0}
				refDistance={soundState.refDistance}
				maxDistance={soundState.maxDistance}
				rolloffFactor={soundState.rolloffFactor}
				panningModel={soundState.panningModel}
				loop
				autoplay={settingsState.audio.sfxEnabled}
			/>
		</T.Mesh>
	</RigidBody>
</T.Group>
