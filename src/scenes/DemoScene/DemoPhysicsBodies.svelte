<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { PositionalAudio } from '@threlte/extras';
	import { RigidBody, Collider, usePhysicsTask, useRapier } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat';
	// three/webgpu, not 'three' (src/CLAUDE.md): the two entrypoints are separate builds,
	// so the same class name from each is a DIFFERENT class object — the mixing hazard
	// behind DOCS/webgpu-notes.md §1. three/webgpu re-exports all of Three.Core, so this
	// is a drop-in. (Bundle size is unchanged; the duplicate classes were tree-shaken.)
	import * as THREE from 'three/webgpu';
	import { CubeCamera, CubeRenderTarget } from 'three/webgpu';
	import { FlakesTexture } from 'three/addons/textures/FlakesTexture.js';
	import { logPhysics } from '$extensions/logger';
	import { sceneState } from '$extensions/scene';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$extensions/settings';
	import { withoutReflection } from './mirrorFloor';

	const { state: soundState } = useSound();
	const { world } = useRapier();
	const { scene, renderer, invalidate, autoRenderTask } = useThrelte();
	const POS_URL = `${BASE_URL}sounds/positional.mp3`;
	const mountId = crypto.randomUUID().slice(0, 8);

	// Mirror sphere choreography: a closed loop at constant speed — one full lap
	// around each corner ball, then a Bézier chord through the floor's middle (where
	// spawned bodies collect) on the way to the next ball, so every sweep kicks them
	// across the floor. Verified against the geometry: 1.7 clearance from every ball
	// (1.3 combined radii), max axis reach 8.7 (floor edge 10), closest approach to the
	// center 2.9 (spawn zone |x|,|z| <= 4). ~96 units per lap, 24 s at SWEEP_SPEED.
	let sphereRb = $state.raw<RapierRigidBody>();
	let time = 0;
	let heartbeat = 0;
	let loopS = 0;

	const CORNERS: [number, number][] = [
		[-7, -7],
		[7, -7],
		[7, 7],
		[-7, 7]
	];
	const ORBIT_RADIUS = 1.7; // around each 0.8 ball — 1.3 combined radii + margin
	const SWEEP_SPEED = 4; // units/s — enough pace to punt spawned bodies

	// Quadratic Bézier with the control point baked to the floor center (0, 0)
	const bez = (t: number, p0: number, p1: number): number => (1 - t) * (1 - t) * p0 + t * t * p1;

	// Orbit anchor: the point of a ball's orbit circle nearest the floor center, so
	// the travel chord exits each lap aimed at the middle of the floor.
	const anchorOf = (c: [number, number]): [number, number] => {
		const len = Math.hypot(c[0], c[1]);
		return [c[0] * (1 - ORBIT_RADIUS / len), c[1] * (1 - ORBIT_RADIUS / len)];
	};

	// Sample the loop once with cumulative arc length, so `loopS` maps to a position
	// at constant speed — no per-segment speed jumps for the physics to absorb.
	const buildLoop = () => {
		const samples: { x: number; z: number; s: number }[] = [];
		let s = 0;
		for (let i = 0; i < CORNERS.length; i++) {
			const [bx, bz] = CORNERS[i];
			const [nx, nz] = CORNERS[(i + 1) % CORNERS.length];
			const [ax, az] = anchorOf([bx, bz]);
			const [nax, naz] = anchorOf([nx, nz]);
			const a0 = Math.atan2(az - bz, ax - bx);
			const push = (x: number, z: number) => {
				const prev = samples[samples.length - 1];
				if (prev) s += Math.hypot(x - prev.x, z - prev.z);
				samples.push({ x, z, s });
			};
			// Full lap around the ball, starting and ending at the anchor
			for (let k = 0; k <= 96; k++) {
				const a = a0 + (k / 96) * Math.PI * 2;
				push(bx + Math.cos(a) * ORBIT_RADIUS, bz + Math.sin(a) * ORBIT_RADIUS);
			}
			// Chord through the floor's middle toward the next ball's anchor
			for (let k = 1; k <= 96; k++) {
				const t = k / 96;
				push(bez(t, ax, nax), bez(t, az, naz));
			}
		}
		return { samples, length: s };
	};
	const LOOP = buildLoop();

	const posAt = (s: number): { x: number; z: number } => {
		const target = ((s % LOOP.length) + LOOP.length) % LOOP.length;
		let lo = 0;
		let hi = LOOP.samples.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (LOOP.samples[mid].s <= target) lo = mid;
			else hi = mid;
		}
		const a = LOOP.samples[lo];
		const b = LOOP.samples[hi];
		const f = (target - a.s) / Math.max(b.s - a.s, 1e-9);
		return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
	};

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

	// Live reflections for the corner balls — one SHARED cube capture instead of four:
	// a single CubeCamera parks at the floor's center at ball height (the old
	// icosahedron spot, safely inside the mirror sphere's orbit ring) and all four
	// materials sample the same map. Trade-off: parallax is center-of-floor rather
	// than per-ball — broad content (sky, sun disc, the mirror floor, the orbiting
	// sphere, spawned bodies) reads correctly; only precise neighbour geometry lands
	// slightly off, which 0.8-radius spheres don't show.
	//
	// The map goes through the same PMREM chain as scene.environment (CubeCamera
	// flags needsPMREMUpdate itself, PMREMNode re-filters on version change), so the
	// balls keep roughness-filtered reflections. envMapIntensity is mirrored from
	// scene.environmentIntensity each tick because an explicit material.envMap
	// switches the intensity source away from the scene value (MaterialProperties) —
	// 0.25 under the procedural sky, 1.0 in HDR/cube modes, matching the old look.
	// ~15 Hz at 96px: the balls are stationary, so only moving content (the mirror
	// sphere, spawned bodies, weather) needs to refresh, and 6 scene renders per
	// capture amortize cheaply.
	const BALL_CAPTURE_HZ = 15;
	const ballCapture = new CubeRenderTarget(96, { type: THREE.HalfFloatType });
	const ballCamera = new CubeCamera(0.1, 50, ballCapture as never);
	ballCamera.position.set(0, 0.8, 0);
	for (const material of [carPaint, fibers, golf, clearcoatNormal]) {
		material.envMap = ballCapture.texture;
	}
	// Half a period out of phase with the mirror capture below, so the two never fall on
	// the same frame — 30 and 15 Hz otherwise coincide every 1/15 s, putting twelve face
	// renders in one frame and a visible hitch with them.
	let ballClock = 1 / (BALL_CAPTURE_HZ * 2);
	useTask(
		(delta) => {
			// Keep-alive: this component stays mounted while other scenes are current —
			// its captures must not run then (six scene renders each).
			if (sceneState.currentScene !== 'demoScene') return;
			ballClock += delta;
			if (ballClock < 1 / BALL_CAPTURE_HZ) return;
			ballClock %= 1 / BALL_CAPTURE_HZ;
			for (const material of [carPaint, fibers, golf, clearcoatNormal]) {
				material.envMapIntensity = scene.environmentIntensity;
			}
			// Reflection off for the six faces — see mirrorFloor.ts.
			withoutReflection(() => ballCamera.update(renderer, scene));
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	// Orbiting mirror sphere — three's webgpu_materials_basic example (MeshBasicMaterial
	// + envMap), except the envMap is a LIVE cube capture: a small CubeCamera rides at
	// the sphere's position and re-renders six faces, so the reflection shows the floor
	// (itself a mirror — see DemoScene), the corner balls, spawned bodies and the sun
	// disc (which Sky.svelte's env bake hides). The capture runs AFTER the main render
	// on purpose: the floor's reflector updates its render target per
	// renderer.render() call for the active camera, so rendering the main view first
	// keeps the floor's reflection correct for the player's camera — the sphere then
	// samples a one-frame-old map, which a perpetually moving mirror never shows.
	// 128px/HalfFloat, sphere hidden during capture to avoid a fully self-occluded
	// frame. Same CubeCamera-in-a-task pattern as Sky.svelte's bake.
	//
	// PERF: each capture is six scene renders, so it is throttled to ~30 Hz — half the
	// cost, and a 4 u/s mirror shows no visible stepping at that refresh. The floor's
	// reflection is suspended for the duration (mirrorFloor.ts); it used to add a
	// half-canvas full-scene render to every one of those six faces.
	const MIRROR_CAPTURE_HZ = 30;
	const mirrorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
	const mirrorCapture = new CubeRenderTarget(128, { type: THREE.HalfFloatType });
	const mirrorCamera = new CubeCamera(0.1, 50, mirrorCapture as never);
	mirrorMaterial.envMap = mirrorCapture.texture;
	let mirrorMesh = $state.raw<THREE.Mesh>();
	const mirrorPos = new THREE.Vector3();
	let captureClock = 0;
	useTask(
		(delta) => {
			if (!mirrorMesh) return;
			// Keep-alive: skip the six-face capture while another scene is current.
			if (sceneState.currentScene !== 'demoScene') return;
			captureClock += delta;
			if (captureClock < 1 / MIRROR_CAPTURE_HZ) return;
			captureClock %= 1 / MIRROR_CAPTURE_HZ;
			mirrorMesh.visible = false;
			mirrorCamera.position.copy(mirrorMesh.getWorldPosition(mirrorPos));
			// Reflection off for the six faces — see mirrorFloor.ts.
			withoutReflection(() => mirrorCamera.update(renderer, scene));
			mirrorMesh.visible = true;
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	// Four balls on the floor's corners, inset so they sit fully on it
	const EDGE_BALLS: { position: [number, number, number]; material: THREE.MeshPhysicalMaterial }[] =
		[
			{ position: [-7, 0.8, -7], material: carPaint },
			{ position: [7, 0.8, -7], material: fibers },
			{ position: [-7, 0.8, 7], material: golf },
			{ position: [7, 0.8, 7], material: clearcoatNormal }
		];
	// $state.raw silences Svelte's binding_property_non_reactive warning on
	// bind:ref={ballMeshes[i]}. Raw is what we want regardless: the physics task
	// only ever reads the array, nothing subscribes to it.
	let ballMeshes = $state.raw<(THREE.Mesh | undefined)[]>([]);
	let ballYaw = 0;

	// Scratch objects for the per-frame task — allocating a Quaternion/Euler/two
	// literals every frame is pure GC churn.
	const _euler = new THREE.Euler();
	const _quat = new THREE.Quaternion();
	const _kinRotation = { x: 0, y: 0, z: 0, w: 1 };

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
		ballCapture.dispose();
		mirrorMaterial.dispose();
		mirrorCapture.dispose();
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

		// Mirror sphere: constant-speed run along the choreographed loop, still
		// bobbing y 1..4 and tumbling for the reflections.
		if (sphereRb) {
			time += delta;
			loopS = (loopS + delta * SWEEP_SPEED) % LOOP.length;
			const p = posAt(loopS);
			const y = Math.sin(time) * 1.5 + 2.5;
			_euler.set(time, 0, 0);
			_quat.setFromEuler(_euler);
			_kinRotation.x = _quat.x;
			_kinRotation.y = _quat.y;
			_kinRotation.z = _quat.z;
			_kinRotation.w = _quat.w;
			sphereRb.setNextKinematicTranslation({ x: p.x, y, z: p.z });
			sphereRb.setNextKinematicRotation(_kinRotation);
		}

		heartbeat += delta;
		if (heartbeat >= 1) {
			heartbeat = 0;
			logPhysics.info(`DemoPhysicsBodies heartbeat [${mountId}]`, {
				time: Number(time.toFixed(3)),
				loopS: Number(loopS.toFixed(1)),
				ballYaw: Number(ballYaw.toFixed(3)),
				sphere: readTranslation(sphereRb)
			});
		}
	});
</script>

<!-- Corner balls — fixed bodies, spawned bodies bounce off them -->
{#each EDGE_BALLS as ball, i (i)}
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
		<T.Mesh castShadow bind:ref={mirrorMesh} material={mirrorMaterial}>
			<T.SphereGeometry args={[0.5, 32, 32]} />

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
