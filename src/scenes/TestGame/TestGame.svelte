<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useGltf, useDraco, useKtx2, useMeshopt } from '@threlte/extras';
	import { Collider, RigidBody, usePhysicsTask } from '@threlte/rapier';
	import {
		CoefficientCombineRule,
		type RigidBody as RapierRigidBody,
		type Rotation,
		type Vector
	} from '@dimforge/rapier3d-compat';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import { BASE_URL } from '$extensions/settings';
	import { sceneState } from '$extensions/scene';
	import { logGltf } from '$extensions/logger';
	import CarHeadlights from './CarHeadlights.svelte';
	import CarWheels from './CarWheels.svelte';
	import ChaseCamera from './ChaseCamera.svelte';
	import {
		CAR_INPUT_KEYS,
		CAR_TOGGLE_KEYS,
		applyCarToggle,
		carHandling,
		carInput,
		carRestart,
		resetCarInput
	} from './carInput.svelte';
	import { G, GR86, UNITS_PER_METER } from './gr86';
	import { HANDLING_TUNES, latMu } from './handling';
	import { createDrivetrain } from './drivetrain';
	import { buildCityColliders } from './cityColliders';
	import { carSim, publishCarHud, resetCarTelemetry } from './carTelemetry.svelte';

	// Test Game 3D scene — driving prototype.
	// Controls: arrows drive, Space handbrake, Q/E shift down/up, L lights, H main beam
	// — deliberately keys Studio doesn't bind (w a s z t r c v m), so dev-mode shortcuts
	// don't fight the car. Input is this scene's own svelte:window keymap
	// (carInput.svelte.ts), not the shared keymapper — that needs a per-scene rework first.

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

	// Static collision for the city — built once when the GLB lands. Hand-rolled
	// instead of <AutoColliders> because the trimesh flags (FIX_INTERNAL_EDGES,
	// which stops ghost bumps at internal triangle seams on the flat roads) can
	// only be passed through explicit args. See cityColliders.ts.
	const cityColliders = $derived($city?.scene ? buildCityColliders($city.scene) : []);

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

	// Switches (headlights) latch on the keydown EDGE, so auto-repeat has to be dropped
	// or holding L strobes the car. Ctrl is left alone — Ctrl+H is the engine's UI toggle.
	function onKeydown(e: KeyboardEvent): void {
		const toggle = CAR_TOGGLE_KEYS[e.code];
		if (toggle && !e.repeat && !e.ctrlKey && !e.metaKey && !isTypingTarget(e.target)) {
			e.preventDefault();
			applyCarToggle(toggle);
			return;
		}
		setKey(e, true);
	}

	const onKeyup = (e: KeyboardEvent) => setKey(e, false);

	// ── Driving ──────────────────────────────────────────────────────────────────
	//
	// Still ONE dynamic box for the chassis (no per-wheel suspension), but the
	// longitudinal half is now a real drivetrain: torque curve → clutch → 6-speed
	// box → traction limit at the rear axle (drivetrain.ts, all SI, GR86 numbers in
	// gr86.ts). Grip stays a lateral-velocity damp per step, and the drivetrain hands
	// back how much of it is left — the handbrake takes it all, wheelspin takes a
	// chunk (power oversteer). Roll is disabled on the body (enabledRotations) so the
	// car cannot tip sideways; pitch survives for slopes.
	//
	// UNITS: the sim thinks in metres, the world is 2.5 units to the metre. Forces
	// and velocities convert at this boundary and nowhere else — see gr86.ts.
	//
	// Steering is DIRECT yaw-rate control, not torque, and the base target is the smaller
	// of two real limits rather than a speed ramp: what the front wheels GEOMETRICALLY
	// point at (v·tan δ / wheelbase, an Ackermann bicycle) and what the tyres can HOLD
	// (μ·g / v). Below ~25 km/h the geometry binds and you get a tight turning radius;
	// above it grip binds and the same key press is a lane change. Nothing turns on the
	// spot: yaw falls out of speed. The two are wired to the same μ as the sideways
	// bleed below — see `latMu`, which is the knob for cornering at speed.
	//
	// On top of that base, `powerYawBoost` scales the yaw AUTHORITY when the rear is
	// loose and `driftAlign` pulls the nose back toward the direction of travel
	// (handling.ts). They are 1 and 0 in the Grip tune, which collapses everything back
	// to the base — a pure function of the steering angle, where the car can only ever
	// rotate as fast as the front wheels point and centring the wheel stops the
	// rotation dead. That model cannot express a drift however the grip numbers are set.
	//
	// Every tuneable number lives in HANDLING_TUNES and is read FRESH each step: the
	// player can flip Grip ↔ Drift mid-corner and nothing here may cache it.
	const YAW_MIN_SPEED = 1.5; // m/s floor under the grip cap, so it can't divide by ~0
	// 1/s — how fast leftover sideways velocity settles once it is back inside what the
	// tyres can pull. A RATE, not a per-step fraction: the latter silently retunes the
	// car whenever the physics framerate moves, and the world runs a fixed 200 Hz. The
	// grip LIMIT below is what makes a slide a slide; this is only the last little bit.
	const GRIP_RATE = 138;
	// m/s — the slip angle fades in across `1 → 1 + this`. Forwards only, above walking
	// pace: under it the angle is numerical noise, and in reverse it reads inverted. A
	// ramp rather than an `if`, because a step here is a kick in the steering.
	const DRIFT_GATE_SPEED = 1;
	const DRIFT_GATE_RAMP = 2;

	let carBody = $state.raw<RapierRigidBody>();
	/** What ChaseCamera follows — an empty parented to the chassis body, see below. */
	let chaseAnchor = $state.raw<THREE.Object3D>();

	const drivetrain = createDrivetrain();

	// Default pose for the Restart button — captured from the body itself on its
	// first physics step (in the task below), so the authored spawn constants live
	// only in the markup and this can never drift from them.
	const spawnPos = { x: 0, y: 0, z: 0 };
	const spawnRot = { x: 0, y: 0, z: 0, w: 1 };
	let spawnCaptured = false;

	// Tasks never allocate (core/utils/CLAUDE.md) — every per-step scratch lives here,
	// and the rapier getter methods fill their target instead of returning fresh objects.
	const _q = new THREE.Quaternion();
	const _forward = new THREE.Vector3();
	const _right = new THREE.Vector3();
	const _vel = new THREE.Vector3();
	const _rot = { x: 0, y: 0, z: 0, w: 1 } as Rotation;
	const _lin = { x: 0, y: 0, z: 0 } as Vector;
	const _ang = { x: 0, y: 0, z: 0 } as Vector;

	const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
	/** Fraction of a `rate`-per-second exponential decay consumed in `dt`. */
	const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

	usePhysicsTask((delta) => {
		const body = carBody;
		if (!body) return;
		// Keep-alive: never drive the car from another scene's frames.
		if (sceneState.currentScene !== 'testGame') return;

		// First driven step = the spawn pose. Restart teleports the body back here.
		if (!spawnCaptured) {
			spawnCaptured = true;
			const t = body.translation();
			spawnPos.x = t.x;
			spawnPos.y = t.y;
			spawnPos.z = t.z;
			const r = body.rotation();
			spawnRot.x = r.x;
			spawnRot.y = r.y;
			spawnRot.z = r.z;
			spawnRot.w = r.w;
		}

		// The selected setup, re-read every step — switching tunes is a live change.
		const tune = HANDLING_TUNES[carHandling.mode];
		const latGrip = latMu(tune);

		const steerKey = (carInput.left ? 1 : 0) - (carInput.right ? 1 : 0);
		const handbrake = carInput.handbrake;

		body.linvel(_lin);
		_vel.set(_lin.x, _lin.y, _lin.z);

		const rot = body.rotation(_rot);
		_q.set(rot.x, rot.y, rot.z, rot.w);
		_forward.set(0, 0, -1).applyQuaternion(_q); // model nose is -Z
		_right.set(1, 0, 0).applyQuaternion(_q);

		const vForward = _vel.dot(_forward);
		const vLateral = _vel.dot(_right);
		const speedMs = vForward / UNITS_PER_METER;
		const absSpeed = Math.abs(speedMs);

		// Steering rack. Runs even parked — a stopped car still turns its wheels, and
		// CarWheels renders exactly this value, so the visual lock is the one the
		// physics used. Lock bleeds off with speed so the keyboard stops being a
		// switch between "straight" and "spin" on the motorway.
		const lockFraction =
			1 - (1 - tune.steerHighSpeedFactor) * clamp(absSpeed / tune.steerFalloffSpeed, 0, 1);
		carSim.steer += (steerKey * lockFraction - carSim.steer) * damp(tune.steerResponse, delta);
		// Published in RADIANS, because full lock is now a per-tune number and CarWheels
		// must render the angle the physics used, not one it re-derived from a constant.
		carSim.steerAngle = carSim.steer * tune.maxSteerAngle;

		// Parked and untouched → hands off, so the body can sleep. resetForces(false)
		// first: rapier forces persist until cleared, and waking the body to clear them
		// would defeat the point. Q/E count as input even though they move nothing —
		// the gearbox is the drivetrain's, and it only advances inside `step()`.
		const idle =
			steerKey === 0 &&
			!handbrake &&
			!carInput.up &&
			!carInput.down &&
			!carInput.shiftUp &&
			!carInput.shiftDown;
		if (idle && _vel.lengthSq() < 0.25) {
			body.resetForces(false);
			drivetrain.idle(delta);
			carSim.speedMs = 0;
			carSim.rpm = drivetrain.state.rpm;
			carSim.gear = drivetrain.state.gear;
			carSim.slip = 0;
			carSim.drift = 0;
			carSim.throttle = 0;
			carSim.brake = 0;
			carSim.handbrake = false;
			carSim.limiting = false;
			publishCarHud(delta);
			return;
		}

		const out = drivetrain.step(
			delta,
			speedMs,
			{
				forward: carInput.up,
				backward: carInput.down,
				handbrake,
				shiftUp: carInput.shiftUp,
				shiftDown: carInput.shiftDown
			},
			tune
		);

		// Longitudinal — one force along the nose. Newtons → world (a_world = a_si·UPM).
		const longitudinal = (out.driveForce + out.resistForce) * UNITS_PER_METER;
		body.resetForces(true);
		body.addForce(
			{
				x: _forward.x * longitudinal,
				y: _forward.y * longitudinal,
				z: _forward.z * longitudinal
			},
			true
		);

		// ── Yaw ──────────────────────────────────────────────────────────────
		// Slip angle at the CG: the angle between where the nose points and where the
		// car is actually going. A drift IS a large, HELD value here. Gated to
		// forwards-and-above-walking-pace — under that it is numerical noise, and in
		// reverse it reads inverted.
		//
		// NOTHING below depends on the SIGN of this angle except `driftAlign`, and that
		// is the whole stability argument. An earlier version added an oversteer moment
		// pointed along sign(beta): its gradient at beta → 0 was ~5× the aligning
		// term's, so every bump fed back into more rotation than anything could remove
		// and the car could not be held in a straight line. Yaw AUTHORITY is safe
		// because it multiplies the steering — no steering, no yaw, straight is straight.
		const driftGate = clamp((speedMs - DRIFT_GATE_SPEED) / DRIFT_GATE_RAMP, 0, 1);
		const beta =
			driftGate > 0 ? Math.atan2(vLateral, Math.max(Math.abs(vForward), 1e-3)) * driftGate : 0;
		carSim.drift = beta;

		// How loose the rear is right now, 0…1. Whichever source is loosest wins; they
		// do NOT stack, or brake-and-power would simply pin the boost at maximum.
		//   handbrake  — all of it.
		//   brake      — trail-braking oversteer, the deliberate way in.
		//   powerLoad  — the friction circle: grip spent driving the car along is not
		//                available to hold it sideways. THE drift control, and the
		//                reason the throttle works in gears that never spin the rears.
		//   slip       — actual wheelspin. Only 1st and 2nd can ever out-pull the tyre,
		//                but with Drift's traction control OFF they take it all the way
		//                to 1, and at 1 the aligning term below is gone with it.
		//   looseBase  — a floor, deliberately SMALL: the car has to be planted until
		//                something provokes it, or the whole tune reads floaty.
		// Faded back out as the slide reaches `maxDriftAngle` — that fade is what makes
		// the drift SETTLE at an angle rather than carry on into a spin, because the
		// aligning term below grows while this one shrinks.
		const loose = handbrake
			? 1
			: Math.max(
					tune.looseBase,
					drivetrain.state.slip,
					tune.brakeLoose * drivetrain.state.brake,
					tune.throttleLoose * out.powerLoad
				);
		const reach = clamp(Math.abs(beta) / tune.maxDriftAngle, 0, 1);
		const flick = handbrake ? tune.handbrakeYawBoost : 1;
		const boost = flick * (1 + (tune.powerYawBoost - 1) * loose * (1 - reach));

		// The planted car: the lesser of the geometric and the grip-limited rate, both
		// scaled by the boost. Signed by `speedMs`, so reversing steers backwards like a
		// real car, and zero at rest. The boost has to scale BOTH — lifting the cap
		// alone does nothing below ~25 km/h, where the geometric term is the binding
		// one, i.e. at exactly the speeds anyone yanks a handbrake. The cap runs on the
		// full lateral μ, not the reduced one below: the fronts are never the axle that
		// lets go, and it is the fronts that set how fast a car can rotate.
		const yawDemand = ((speedMs * Math.tan(carSim.steerAngle)) / GR86.wheelbase) * boost;
		const yawCap = (latGrip * boost * G) / Math.max(absSpeed, YAW_MIN_SPEED);
		// …minus the rear tyres pulling the nose back toward the direction of travel —
		// SCALED BY HOW MUCH REAR GRIP IS LEFT TO DO IT WITH. A spinning tyre aligns
		// nothing, so the aligning moment has to fade exactly as the rear lets go.
		// As a constant it did the opposite: the harder you loosened the rear, the
		// harder the car fought you, and full lock plus full throttle at walking pace
		// produced a 130 m circle instead of a donut. With the scaling that same input
		// settles into a 7-14 m circle at ~33°/s.
		//
		// Zero in Grip. Elsewhere it is the auto-catch: it ends a slide when you lift
		// (looseness drops back to `looseBase`, so this roughly doubles), it is what
		// opposite lock is helping, and it is what makes the straight line
		// self-correcting instead of merely uneventful.
		const align = tune.driftAlign * (1 - loose);
		const targetYaw = clamp(yawDemand, -yawCap, yawCap) - align * beta;

		const ang = body.angvel(_ang);
		ang.y += (targetYaw - ang.y) * damp(tune.yawResponse, delta);
		body.setAngvel(ang, true);

		// Grip — bleed the sideways velocity, but never faster than the tyres could
		// actually pull it back. That LIMIT is the whole cornering model: the bleed used
		// to be a bare exponential, which is an infinitely strong constraint (at
		// GRIP_RATE it removes ~70 g), so even the drift end still snapped the car
		// straight inside a tenth of a second and the handbrake read as a turn-tighter
		// button rather than a slide. μ is what a slide IS — full grip when planted,
		// `handbrakeMuLat` with the rears locked, interpolated across the drivetrain's
		// `gripFactor` so wheelspin steps the back out too.
		//
		// The two agree by construction: holding the yaw cap costs exactly v·ω = μ·g of
		// sideways bleed per second, so a planted car never runs out and never slides.
		// Vertical motion (gravity, slopes) passes through untouched.
		const muLat =
			tune.handbrakeMuLat + (latGrip - tune.handbrakeMuLat) * clamp(out.gripFactor, 0, 1);
		const settle = vLateral * damp(GRIP_RATE, delta);
		const bleedLimit = muLat * G * UNITS_PER_METER * delta; // m/s² → world units/s this step
		_vel.addScaledVector(_right, -clamp(settle, -bleedLimit, bleedLimit));
		body.setLinvel({ x: _vel.x, y: _vel.y, z: _vel.z }, true);

		// Instruments — plain object at 200 Hz, $state mirror at 30 (carTelemetry).
		carSim.speedMs = speedMs;
		carSim.rpm = drivetrain.state.rpm;
		carSim.gear = drivetrain.state.gear;
		carSim.slip = drivetrain.state.slip;
		carSim.throttle = drivetrain.state.throttle;
		carSim.brake = drivetrain.state.brake;
		carSim.handbrake = handbrake;
		carSim.limiting = drivetrain.state.limiting;
		publishCarHud(delta);
	});

	// Restart button: pose and motion back to the captured spawn, nothing else —
	// gear/lights/instruments are left alone and self-correct from the body next
	// step. No scene gate here on purpose: gating would re-run this on every scene
	// re-entry after the first restart.
	$effect(() => {
		if (carRestart.token === 0) return;
		const body = carBody;
		if (!body) return;
		body.setTranslation(spawnPos, true);
		body.setRotation(spawnRot, true);
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		body.resetForces(true);
	});

	// Leaving the scene parks the instruments — the HUD unmounts with them, but the
	// mirror is module state and would otherwise still read 180 km/h on the way back in.
	$effect(() => {
		if (sceneState.currentScene !== 'testGame') return;
		return () => {
			drivetrain.reset();
			resetCarTelemetry();
		};
	});
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onblur={resetCarInput} />

{#if $city}
	<T.Group name="City" scale={1.5} position={[101.4641, 8.7, -102.459]} rotation={[0, -1.0472, 0]}>
		<!-- The track GLB: Ground/Asphalt planes, Metal barriers, trees, decals — one
		     trimesh per mesh, transforms baked (cityColliders.ts). Bare <Collider>s
		     attach to an implicit fixed body, exactly like AutoColliders did. -->
		<T is={$city.scene} />
		{#each cityColliders as c (c.id)}
			<Collider shape="trimesh" args={c.args} />
		{/each}
	</T.Group>
{/if}

<!-- Player car. The outer group is the hand-tuned spawn pose (RigidBody reads its
     world transform at creation); scale 2.5 lives on the children so the BODY speaks
     world units while the collider args below stay in model meters. -->
{#if $car}
	<T.Group name="GR86" rotation={[-0.0079, -2.5, -0.0197]} position={[1.4599, 8.661, -3.4031]}>
		<!-- linearDamping is 0 on purpose: aero drag and rolling resistance are in the
		     drivetrain now, and a blanket damping term on top of them is the same loss
		     counted twice (it was also what capped the old top speed). gravityScale is
		     UNITS_PER_METER because the shared <World> pulls at 9.8 units/s², which in
		     this 2.5-units-to-the-metre city is 3.9 m/s² — moon gravity, and a car that
		     floats over every kerb. Scene-local: the global value belongs to DemoScene too. -->
		<RigidBody
			bind:rigidBody={carBody}
			type="dynamic"
			linearDamping={0}
			angularDamping={1.5}
			gravityScale={UNITS_PER_METER}
			enabledRotations={[true, true, false]}
			ccd={true}
		>
			<T.Group scale={2.5}>
				<T is={$car.scene} />
				<!-- Steerable/rolling wheels — shader-driven, see CarWheels.svelte.
				     visualScale must match this group's scale: the roll rate divides
				     world speed by the world-space wheel radius. -->
				<CarWheels scene={$car.scene} visualScale={2.5} />
				<!-- Car-local units on purpose (nose is -Z — see CarHeadlights.svelte). -->
				<CarHeadlights />
			</T.Group>

			<!-- Chassis: ONE rounded box instead of per-mesh hulls (the model is dozens
			     of meshes — seats, glass, engine — each a silly collider). Args are in
			     model meters, scaled by the parent group (×2.5) to match the visual.
			     Measured from the GLB: the car spans y 0.01 (tire bottoms) .. 1.31 (roof);
			     the group offset puts this box at y 0.06..1.16 — the belly IS the ground
			     contact (a touch above the tire plane, so the resting tires sink ~5 cm,
			     imperceptible from the chase cam), top under the roof.
			     ROUNDED (r = 0.18 m): a plain cuboid's square edges catch on triangle
			     seams, kerbs and barrier lips — each edge contact is a wall-faced stop.
			     The rounding is DILATING in rapier (total half-extent = h + r), so each
				 half-extent has r subtracted to preserve the outer size.
			     FRICTIONLESS (Min rule → min(0, μ_road) = 0) on purpose: the chassis is
			     one box, so contact friction is STATIC friction against the COM drive
			     force — at real gravity (gravityScale 2.5) the cap is μ·m·g ≈ 0.65 ·
			     31 600 ≈ 20 500 world units, above the drivetrain's entire range
			     (launch ≈ 3 800, traction limit ≈ 15 600), and every Newton of throttle
			     was cancelled — the car could not move at all. Grip belongs to the
			     drivetrain (rear-axle traction clip, rolling resistance, brakes) and
			     the lateral velocity damp; contacts keep their normal impulses only
			     (ground, kerbs, walls). Verified against rapier in isolation.
			     (Wheel-contact balls at the measured pivots were tried on top of this
			     and reverted — see git history before revisiting.) -->
			<T.Group position={[0, 1.23, 0]} scale={2.5}>
				<Collider
					shape="roundCuboid"
					args={[0.95 - 0.18, 0.55 - 0.18, 2.1 - 0.18, 0.18]}
					mass={GR86.mass}
					friction={0}
					frictionCombineRule={CoefficientCombineRule.Min}
				/>
			</T.Group>

			<!-- What the chase camera looks at. An empty inside the RigidBody rather than
			     the visual group: this level is UNSCALED, so the offset is world units and
			     stays put if the ×2.5 ever changes; and its world transform is the body's
			     own pose, which is what the camera should track (the visual group carries
			     the model's offsets). ~1.6 up = the car's middle, not its floor. -->
			<T.Object3D name="ChaseAnchor" position={[0, 1.6, 0]} bind:ref={chaseAnchor} />
		</RigidBody>
	</T.Group>

	<!-- Borrows the app camera while this scene is current and hands it back on the way
	     out — see ChaseCamera.svelte. Outside the car's group: it is a rig, not cargo. -->
	<ChaseCamera target={chaseAnchor} />
{/if}
