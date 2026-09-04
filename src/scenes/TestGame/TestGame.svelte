<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useGltf, useDraco, useKtx2, useMeshopt } from '@threlte/extras';
	import { AutoColliders, Collider, RigidBody, usePhysicsTask } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody, Rotation, Vector } from '@dimforge/rapier3d-compat';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import { BASE_URL } from '$extensions/settings';
	import { sceneState } from '$extensions/scene';
	import { logGltf } from '$extensions/logger';
	import CarHeadlights from './CarHeadlights.svelte';
	import CarWheels from './CarWheels.svelte';
	import { CAR_INPUT_KEYS, carInput, resetCarInput } from './carInput.svelte';

	// Test Game 3D scene — driving prototype.
	// Controls: arrows drive, Space handbrake, Q/E shift down/up — deliberately keys
	// Studio doesn't bind (w a s z t r c v m), so dev-mode shortcuts don't fight the
	// car. Input is this scene's own svelte:window keymap (carInput.svelte.ts), not
	// the shared keymapper — that needs a per-scene rework first.

	// Both models are draco + KTX2 compressed, so the decoders must be handed to useGltf
	// (same setup as the gltf-viewer extension: DRACO/KTX2 fetch their decoder binaries
	// on demand from a CDN pinned to the installed three version; Meshopt ships in three).
	const threeCdn = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}`;
	const dracoLoader = useDraco(`${threeCdn}/examples/jsm/libs/draco/gltf/`);
	const meshoptDecoder = useMeshopt();
	const ktx2Loader = useKtx2(`${threeCdn}/examples/jsm/libs/basis/`);

	const decoders = { dracoLoader, meshoptDecoder, ktx2Loader };

	const city = useGltf(`${BASE_URL}models/testgame/track.glb`, decoders);
	const car = useGltf(`${BASE_URL}models/testgame/2023_toyota_gr86_compressed.glb`, decoders);

	$effect(() => {
		if ($city?.scene) logGltf.info('TestGame track loaded');
		if ($car?.scene) logGltf.info('TestGame car loaded');
	});

	// Shadows — both cast and receive. SkyLight auto-fits its shadow frustum to the
	// visible casters, so scene-sized geometry just lands on a bigger quantised radius
	// band; nothing to configure here.
	$effect(() => {
		for (const root of [$city?.scene, $car?.scene]) {
			if (!root) continue;
			root.traverse((obj) => {
				const mesh = obj as Mesh;
				if (mesh.isMesh) {
					mesh.castShadow = true;
					mesh.receiveShadow = true;
				}
			});
		}
	});

	// ── Input (this scene's own keymap) ──────────────────────────────────────────

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return !!target.closest('input, textarea, select, [contenteditable="true"]');
	}

	// Studio's tweakpane panes are real <input>s — never swallow keys there.
	function setKey(e: KeyboardEvent, value: boolean): void {
		if (isTypingTarget(e.target)) return;
		const action = CAR_INPUT_KEYS[e.code];
		if (!action) return;
		e.preventDefault();
		carInput[action] = value;
	}

	const onKeydown = (e: KeyboardEvent) => setKey(e, true);
	const onKeyup = (e: KeyboardEvent) => setKey(e, false);

	// ── Driving (arcade model, all magnitudes in world units — tune by feel) ─────
	//
	// One dynamic box for the chassis (no per-wheel simulation): engine force along
	// body-local -Z (the model's nose), yaw via torque impulse scaled by speed, and
	// grip implemented as lateral-velocity damping per step — Space loosens the grip
	// (drift) instead of locking the wheels. Roll is disabled on the body
	// (enabledRotations) so the car cannot tip sideways; pitch survives for slopes.

	const CHASSIS_MASS = 900;
	const ENGINE_FORCE = 12500; // ≈ 14 units/s² at mass 900
	const REVERSE_FACTOR = 0.5;
	const MAX_SPEED = 60; // units/s forward or reverse
	// Steering is DIRECT yaw-rate control, not torque: authority ramps from zero at
	// MIN_STEER_SPEED (no turning in place) to full at STEER_SPEED_REF, and the yaw
	// rate itself is lerped toward target at STEER_RESPONSE — torque impulses here
	// previously produced ~0.9 rad/s PER STEP at full authority (comical spin).
	const MAX_YAW_RATE = 0.9; // rad/s ≈ 52°/s
	const MIN_STEER_SPEED = 0.5;
	const STEER_SPEED_REF = 10; // full authority at this forward speed
	const STEER_RESPONSE = 10;
	const KEEP_LATERAL_GRIP = 0.1; // fraction of lateral velocity kept per step (grippy)
	const KEEP_LATERAL_HANDBRAKE = 0.85; // loose — this is the drift
	const HANDBRAKE_BRAKE = 0.04; // forward speed bled per step while Space is held

	let carBody = $state.raw<RapierRigidBody>();

	// Tasks never allocate (core/utils/CLAUDE.md) — every per-step scratch lives here,
	// and the rapier getter methods fill their target instead of returning fresh objects.
	const _q = new THREE.Quaternion();
	const _forward = new THREE.Vector3();
	const _right = new THREE.Vector3();
	const _vel = new THREE.Vector3();
	const _rot = { x: 0, y: 0, z: 0, w: 1 } as Rotation;
	const _lin = { x: 0, y: 0, z: 0 } as Vector;
	const _ang = { x: 0, y: 0, z: 0 } as Vector;

	usePhysicsTask((delta) => {
		const body = carBody;
		if (!body) return;
		// Keep-alive: never drive the car from another scene's frames.
		if (sceneState.currentScene !== 'testGame') return;

		const throttle = (carInput.up ? 1 : 0) - (carInput.down ? 1 : 0);
		const steer = (carInput.left ? 1 : 0) - (carInput.right ? 1 : 0);
		const handbrake = carInput.handbrake;

		body.linvel(_lin);
		_vel.set(_lin.x, _lin.y, _lin.z);

		// Idle and barely moving → hands off, so the body can sleep.
		if (throttle === 0 && steer === 0 && !handbrake && _vel.lengthSq() < 0.25) return;

		const rot = body.rotation(_rot);
		_q.set(rot.x, rot.y, rot.z, rot.w);
		_forward.set(0, 0, -1).applyQuaternion(_q); // model nose is -Z
		_right.set(1, 0, 0).applyQuaternion(_q);

		const vForward = _vel.dot(_forward);
		const vLateral = _vel.dot(_right);

		// Engine — reset+add each step (rapier forces persist until reset).
		body.resetForces(true);
		if (throttle !== 0 && Math.abs(vForward) < MAX_SPEED) {
			const magnitude = throttle > 0 ? ENGINE_FORCE : ENGINE_FORCE * REVERSE_FACTOR;
			body.addForce(
				{ x: _forward.x * magnitude * throttle, y: _forward.y * magnitude * throttle, z: _forward.z * magnitude * throttle },
				true
			);
		}

		// Steering — direct yaw-rate control: no torque to integrate, no place-spinning.
		// Authority ramps with speed (none below MIN_STEER_SPEED, full at STEER_SPEED_REF)
		// and flips sign in reverse, like backing a real car.
		let targetYaw = 0;
		if (steer !== 0 && Math.abs(vForward) > MIN_STEER_SPEED) {
			const authority =
				Math.min(1, (Math.abs(vForward) - MIN_STEER_SPEED) / (STEER_SPEED_REF - MIN_STEER_SPEED)) *
				Math.sign(vForward);
			targetYaw = MAX_YAW_RATE * steer * authority;
		}
		const ang = body.angvel(_ang);
		ang.y += (targetYaw - ang.y) * Math.min(1, STEER_RESPONSE * delta);
		body.setAngvel(ang, true);

		// Grip — bleed the lateral velocity (drift on handbrake), bleed some forward
		// speed while braking. Vertical motion (gravity, slopes) passes through.
		const keepLateral = handbrake ? KEEP_LATERAL_HANDBRAKE : KEEP_LATERAL_GRIP;
		_vel.addScaledVector(_right, -vLateral * (1 - keepLateral));
		if (handbrake) _vel.addScaledVector(_forward, -vForward * HANDBRAKE_BRAKE);
		body.setLinvel({ x: _vel.x, y: _vel.y, z: _vel.z }, true);
	});
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onblur={resetCarInput} />

{#if $city}
	<T.Group name="City" scale={1} position={[ 101.4641, 8.7, -102.459 ]} rotation={[ 0, -1.0472, 0 ]}>
		<!-- Trimesh per mesh (the GLB is ~22 named building/prop/road meshes): exact
		     collision for a drivable city, fixed bodies by AutoColliders' default. -->
		<AutoColliders shape="trimesh">
			<T is={$city.scene} />
		</AutoColliders>
	</T.Group>
{/if}

<!-- Player car. The outer group is the hand-tuned spawn pose (RigidBody reads its
     world transform at creation); scale 2.5 lives on the children so the BODY speaks
     world units while the collider args below stay in model meters. -->
{#if $car}
	<T.Group name="GR86" rotation={[ -0.0079, -1.1613, -0.0197 ]} position={[ 1.4599, 8.661, -3.4031 ]}>
		<RigidBody
			bind:rigidBody={carBody}
			type="dynamic"
			linearDamping={0.2}
			angularDamping={1.5}
			enabledRotations={[true, true, false]}
			ccd={true}
		>
			<T.Group scale={2.5}>
				<T is={$car.scene} />
				<!-- Steerable/rolling wheels — shader-driven, see CarWheels.svelte.
				     visualScale must match this group's scale: the roll rate divides
				     world speed by the world-space wheel radius. -->
				<CarWheels scene={$car.scene} body={carBody} visualScale={2.5} />
				<!-- Car-local units on purpose (nose is -Z — see CarHeadlights.svelte). -->
				<CarHeadlights />
			</T.Group>

			<!-- Chassis: ONE box instead of per-mesh hulls (the model is dozens of
			     meshes — seats, glass, engine — each a silly collider). Args are
			     half-extents in model meters, scaled by the parent group to match the
			     visual; offset to the car's centre height (model Y spans 0..1.31). -->
			<T.Group position={[0, 1.5, 0]} scale={2.5}>
				<Collider shape="cuboid" args={[0.95, 0.55, 2.1]} mass={CHASSIS_MASS} friction={0.6} />
			</T.Group>
		</RigidBody>
	</T.Group>
{/if}
