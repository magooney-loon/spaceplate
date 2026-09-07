// The driving controller — the physics task's brain, extracted from
// TestGame.svelte so the scene component is composition + markup and the
// driving model lives with its siblings (drivetrain.ts, handling.ts).
//
// Owns: the drivetrain instance, the nitrous gameplay (bottle, ramp), the
// startup sequence, the spawn capture / restart teleport, the yaw + lateral
// grip cornering model, and the carSim telemetry writes. The SCENE owns the
// Rapier body and calls `step(delta, body)` from a `usePhysicsTask`;
// `restart(body)` from the HUD token effect; `park()` on unmount.
//
// All comments below were written against TestGame.svelte's inline task and
// moved here verbatim in spirit — the driving-model rules are load-bearing
// documentation (see CLAUDE.md's driving-model section).

import type {
	RigidBody as RapierRigidBody,
	Rotation,
	Vector,
	World
} from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { CarSpec } from '../cars/types';
import { G, UNITS_PER_METER } from '../units';
import { latMu } from './handling';
import { createDrivetrain } from './drivetrain';
import { carSim, publishCarHud } from './carTelemetry.svelte';
import { carHandling, carIgnition, carInput } from './carInput.svelte';
import { clamp, damp } from './carMath';
import { stepSuspension } from './suspension';

// ── Driving ──────────────────────────────────────────────────────────────────
//
// Still ONE dynamic box for the chassis (no per-wheel suspension), but the
// longitudinal half is a real drivetrain: torque curve → clutch → gearbox →
// traction limit at the driven axle (drivetrain.ts, all SI, numbers in the
// car's spec). Grip stays a lateral-velocity damp per step, and the drivetrain
// hands back how much of it is left — the handbrake takes it all, wheelspin
// takes a chunk (power oversteer). Pitch AND roll are both disabled on the
// body (enabledRotations={[false, true, false]}) — only yaw is free; see the
// scene markup for the full world-axes argument.
//
// UNITS: the sim thinks in metres, the world is 2.5 units to the metre. Forces
// and velocities convert at this boundary and nowhere else — see units.ts.
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
// (the car's tunes). They are 1 and 0 in the Grip tune, which collapses everything
// back to the base — a pure function of the steering angle, where the car can only
// ever rotate as fast as the front wheels point and centring the wheel stops the
// rotation dead. That model cannot express a drift however the grip numbers are set.
//
// Every tuneable number lives in the car's `tunes` and is read FRESH each step: the
// player can flip Grip ↔ Drift mid-corner and nothing here may cache it.
const YAW_MIN_SPEED = 1.5; // m/s floor under the grip cap, so it can't divide by ~0
// 1/s — how fast leftover sideways velocity settles once it is back inside what the
// tyres can pull. A RATE, not a per-step fraction: the latter silently retunes the
// car whenever the physics framerate moves, and that number is a knob
// (`physicsState.framerate`, 60 by default). The
// grip LIMIT below is what makes a slide a slide; this is only the last little bit.
const GRIP_RATE = 138;
// m/s — the slip angle fades in across `1 → 1 + this`. Forwards only, above walking
// pace: under it the angle is numerical noise, and in reverse it reads inverted. A
// ramp rather than an `if`, because a step here is a kick in the steering.
const DRIFT_GATE_SPEED = 1;
const DRIFT_GATE_RAMP = 2;

// ── Nitrous (Shift) ──────────────────────────────────────────────────────────
// A wet kit on a throttle switch: Shift alone does nothing — it sprays only while
// the throttle is open in a forward gear, and only while the bottle has anything
// left. The controller owns everything gameplay-shaped here (bottle, ramp); the one
// hardware number — what spray does to torque — is `nitrousTorqueGain` in the
// car's spec, and the drivetrain applies it inside its own traction limit. So a
// shot in 1st is wheelspin, a shot in 3rd is thrust, and Drift + spray in 3rd is
// smoke.
/** s of full spray in a full bottle. */
const NITROUS_CAPACITY = 4;
/** bottle fraction per s, back while not spraying. ~14 s empty → full. */
const NITROUS_REGEN = 1 / 14;
/** 1/s — flow ramps in fast (the hit should bite) … */
const NITROUS_ATTACK = 8;
/** … and tails off a touch slower, which reads as a sputter rather than a switch. */
const NITROUS_RELEASE = 4;
/** Below this the bottle counts as dry and the switch opens. */
const NITROUS_DRY = 0.01;

export function createCarController(spec: CarSpec, world: World) {
	const drivetrain = createDrivetrain(spec);
	const hw = spec.hardware;

	/**
	 * Clear Rapier's force accumulator and immediately re-apply what holds the car
	 * up. THE CAR HAS NO GROUND COLLIDERS — `sim/suspension.ts` casts four rays
	 * and the summed spring force IS the contact — so `resetForces` and the
	 * suspension are one operation, and every early return below goes through
	 * here. Splitting them is how the parked car ends up on its undertray.
	 * `wake` is passed through: the idle branch must not wake a sleeping body
	 * just to hold up a car that is already resting.
	 */
	function resetForces(body: RapierRigidBody, wake: boolean): void {
		body.resetForces(wake);
		stepSuspension(body, world);
	}

	// Nitrous + startup state — the scene used to own these locals.
	let nitrousBottle = 1; // 0..1
	/** 0..1 — smoothed spray level. This is what reaches the drivetrain, the
	 * flames (blue mix + pilot jet) and the HUD, never the raw key. */
	let nitrousFlow = 0;
	/** Seconds since ignition-on edge. Drives the startup RPM ramp (idle → 2k → idle). */
	let startupTimer = 0;

	// Default pose for the Restart button — captured from the body itself on its
	// first physics step (in `step` below), so the authored spawn constants live
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

	function step(delta: number, body: RapierRigidBody): void {
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
		const tune = spec.tunes[carHandling.mode];
		const latGrip = latMu(tune);

		const steerKey = (carInput.left ? 1 : 0) - (carInput.right ? 1 : 0);
		const handbrake = carInput.handbrake;

		// Ignition gates throttle, brake and shifting — engine off, no drive. Handbrake
		// still works (safety), steering still works (rolling car must still steer).
		// During startup (on but !ready), the startup sequence block below returns early.
		const ignOn = carIgnition.on;
		const throttle = ignOn && carInput.up;
		const brake = ignOn && carInput.down;

		// Reset the startup timer when ignition cuts — a mid-startup N press aborts
		// the rev sequence instantly.
		if (!ignOn) startupTimer = 0;

		// The bottle. Runs BEFORE the idle early-return below so it regenerates while
		// parked too, and so `nitrousFlow` is already honest when the idle branch
		// publishes it. Note the throttle switch reads the gated ↑ key: parked with
		// Shift held but no throttle, nothing sprays (and the car may sleep).
		const spraying =
			ignOn &&
			carInput.nitrous &&
			carInput.up &&
			drivetrain.state.gear >= 1 &&
			nitrousBottle > NITROUS_DRY;
		nitrousFlow +=
			((spraying ? 1 : 0) - nitrousFlow) * damp(spraying ? NITROUS_ATTACK : NITROUS_RELEASE, delta);
		if (spraying) {
			nitrousBottle = Math.max(0, nitrousBottle - (nitrousFlow * delta) / NITROUS_CAPACITY);
		} else {
			nitrousBottle = Math.min(1, nitrousBottle + NITROUS_REGEN * delta);
		}

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

		// ── Startup sequence ────────────────────────────────────────────────
		// Ignition on but the turnon sound hasn't finished yet: the RPM ramps to
		// ~2000 (a realistic crank-and-fire) then settles back to idle. No drive
		// force, no shifting — the car stays put until `ready`.
		if (carIgnition.on && !carIgnition.ready) {
			resetForces(body, false);
			// Rev to 2000 over ~0.4 s, then decay back to idle over ~0.8 s.
			// Using a simple timer that counts up from 0; the turnon sound is ~1.2 s.
			startupTimer += delta;
			const revPeak = 2000;
			const peakTime = 0.4;
			const decayRate = 4; // exp decay rate for the settle
			let targetRpm: number;
			if (startupTimer < peakTime) {
				// Ramp up: idle → 2000
				const t = startupTimer / peakTime;
				targetRpm = hw.idleRpm + (revPeak - hw.idleRpm) * t;
			} else {
				// Settle: 2000 → idle
				const t = startupTimer - peakTime;
				targetRpm = hw.idleRpm + (revPeak - hw.idleRpm) * Math.exp(-decayRate * t);
			}
			carSim.rpm += (targetRpm - carSim.rpm) * damp(12, delta);
			carSim.speedMs = 0;
			carSim.gear = drivetrain.state.gear;
			carSim.slip = 0;
			carSim.drift = 0;
			carSim.latLoad = 0;
			carSim.launch = 0;
			carSim.throttle = 0;
			carSim.brake = 0;
			carSim.handbrake = false;
			carSim.limiting = false;
			carSim.nitrous = 0;
			carSim.nitrousTank = nitrousBottle;
			carSim.accelFwd = 0;
			carSim.accelLat = 0;
			publishCarHud(delta);
			return;
		}

		// Parked and untouched → hands off, so the body can sleep. resetForces(false)
		// first: rapier forces persist until cleared, and waking the body to clear them
		// would defeat the point. Q/E count as input even though they move nothing —
		// the gearbox is the drivetrain's, and it only advances inside `step()`.
		const idle =
			steerKey === 0 &&
			!handbrake &&
			!throttle &&
			!brake &&
			!carInput.shiftUp &&
			!carInput.shiftDown;
		if (idle && _vel.lengthSq() < 0.25) {
			resetForces(body, false);
			if (ignOn) {
				drivetrain.idle(delta);
				carSim.rpm = drivetrain.state.rpm;
			} else {
				// Engine off — sharp drop to 0, not idling.
				carSim.rpm += (0 - carSim.rpm) * damp(hw.freeDropRate * 1.5, delta);
			}
			carSim.speedMs = 0;
			carSim.gear = drivetrain.state.gear;
			carSim.slip = 0;
			carSim.drift = 0;
			carSim.latLoad = 0;
			carSim.launch = 0;
			carSim.throttle = 0;
			carSim.brake = 0;
			carSim.handbrake = false;
			carSim.limiting = false;
			carSim.nitrous = nitrousFlow;
			carSim.nitrousTank = nitrousBottle;
			// Parked: the suspension has nothing to lean on, so it rests.
			carSim.accelFwd = 0;
			carSim.accelLat = 0;
			publishCarHud(delta);
			return;
		}

		const out = drivetrain.step(
			delta,
			speedMs,
			{
				forward: throttle,
				backward: brake,
				handbrake,
				shiftUp: ignOn && carInput.shiftUp,
				shiftDown: ignOn && carInput.shiftDown,
				nitrous: nitrousFlow
			},
			tune
		);

		// Longitudinal — one force along the nose. Newtons → world (a_world = a_si·UPM).
		const longitudinal = (out.driveForce + out.resistForce) * UNITS_PER_METER;
		resetForces(body, true);
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
		const yawDemand = ((speedMs * Math.tan(carSim.steerAngle)) / hw.wheelbase) * boost;
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
		// The share of the lateral budget this corner demands — demanded bleed over
		// the cap. Pins at 1 exactly at max banking (v·ω = μ·g at the yaw cap), sits
		// well under it in a normal corner. The squeal reads it (carAudio): Grip's
		// planted limit cornering has no drift angle and no wheelspin for any other
		// source to see.
		const latLoad = clamp(Math.abs(settle) / bleedLimit, 0, 1);
		const bleed = clamp(settle, -bleedLimit, bleedLimit);
		_vel.addScaledVector(_right, -bleed);
		body.setLinvel({ x: _vel.x, y: _vel.y, z: _vel.z }, true);

		// ── What the suspension leans on ────────────────────────────────────
		// Both accelerations are the MODEL'S OWN, not a finite difference of the
		// body's pose: this is the exact longitudinal force handed to Rapier over
		// the mass, and the exact sideways delta-v the grip model just applied,
		// over the step. Free, noiseless and one frame EARLIER than differencing
		// the result would be. `-bleed` because the bleed is applied along
		// `-_right` and the reaction the body feels points the other way — so
		// this is positive in a left-hand corner, matching body +X.
		carSim.accelFwd = (out.driveForce + out.resistForce) / hw.mass;
		carSim.accelLat = -bleed / delta / UNITS_PER_METER;

		// Instruments — plain object at the physics rate, $state mirror at 30 (carTelemetry).
		carSim.speedMs = speedMs;
		carSim.rpm = drivetrain.state.rpm;
		// Engine off while moving — decay RPM to 0 (sharp but not instant).
		if (!ignOn) {
			carSim.rpm *= 1 - damp(hw.freeDropRate * 1.5, delta);
		}
		carSim.gear = drivetrain.state.gear;
		carSim.slip = drivetrain.state.slip;
		carSim.latLoad = latLoad;
		carSim.launch = drivetrain.state.launch;
		// REV-MATCH LAUNCH: the drivetrain flags the frame the clutch dropped
		// clean; hold the cluster's flash ~1.5 s (matches the keyframe in
		// CarCluster, which runs its own 1.5 s and ends on the unmount). The tier
		// rides along — the flash names the band the catch landed in.
		if (drivetrain.state.launched) {
			carSim.perfectLaunch = 1.5;
			carSim.launchTier = drivetrain.state.launchTier;
		}
		carSim.perfectLaunch = Math.max(0, carSim.perfectLaunch - delta);
		carSim.throttle = drivetrain.state.throttle;
		carSim.brake = drivetrain.state.brake;
		carSim.handbrake = handbrake;
		carSim.limiting = drivetrain.state.limiting;
		carSim.nitrous = nitrousFlow;
		carSim.nitrousTank = nitrousBottle;
		publishCarHud(delta);
	}

	/**
	 * Restart: pose and motion back to the captured spawn, nothing else —
	 * gear/lights/instruments are left alone and self-correct from the body next
	 * step. The `spawnCaptured` guard drops a stale token from an earlier mount:
	 * the body is a fresh one at the authored pose then, and spawnPos is still
	 * {0,0,0} until `step` captures it.
	 */
	function restart(body: RapierRigidBody): void {
		if (!spawnCaptured) return;
		body.setTranslation(spawnPos, true);
		body.setRotation(spawnRot, true);
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		body.resetForces(true);
	}

	/** Unmount: park the instruments' module state and this controller's locals,
	 *  so the next mount starts from a clean slate. */
	function park(): void {
		drivetrain.reset();
		// The bottle as well, to match the fresh carSim mirror.
		nitrousBottle = 1;
		nitrousFlow = 0;
		startupTimer = 0;
	}

	return { step, restart, park, drivetrain };
}

export type CarController = ReturnType<typeof createCarController>;
