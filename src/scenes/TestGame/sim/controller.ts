// The driving controller — the physics task's brain, extracted from
// TestGame.svelte. Owns the drivetrain instance, the nitrous gameplay
// (bottle, ramp), the startup sequence, the spawn capture / restart
// teleport, the yaw + lateral grip cornering model, and the carSim
// telemetry writes. The SCENE owns the Rapier body and calls
// `step(delta, body)` from a `usePhysicsTask`; `restart(body)` from the HUD
// token effect; `park()` on unmount. See CLAUDE.md's driving-model section
// for the cornering model this implements.

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
import { carGearbox, carHandling, carIgnition } from './carSwitches.svelte';
import { carControls } from './carControls';
import { clamp, damp } from './carMath';
import { createSuspension } from './suspension';

// UNITS: the sim thinks in metres, the world is 2.5 units to the metre. Forces
// and velocities convert at this boundary and nowhere else — see units.ts.
// Every tuneable number lives in the car's `tunes` and is read FRESH each
// step: the player can flip Grip ↔ Drift mid-corner and nothing here may
// cache it.
/** m/s floor under the grip cap, so it can't divide by ~0. */
const YAW_MIN_SPEED = 1.5;
/** m/s — the slip-angle drift gate fades in across `1 → 1 + DRIFT_GATE_RAMP`,
 *  forwards only above walking pace (below it the angle is numerical noise
 *  and reverse reads inverted). A ramp, not an `if` — a step here is a kick
 *  in the steering. */
const DRIFT_GATE_SPEED = 1;
const DRIFT_GATE_RAMP = 2;

// Nitrous: Shift sprays with the throttle open in a forward gear, purges
// (vents at the hood) with that gate shut. Kit hardware is the spec's
// (`hw.nitrous*`); this controller owns the live bottle level and smoothed
// flow/purge state.
/** Below this the bottle counts as dry and the switch opens. */
const NITROUS_DRY = 0.01;

/** Purge flow ramp in, 1/s. */
const PURGE_ATTACK = 30;
/** Purge flow ramp out, 1/s. */
const PURGE_RELEASE = 14;
/** Purge drain as a fraction of full spray — the vent empties the LINE, not
 *  the bottle: taps are ~free, holding it showboating costs the kit (~16 s of
 *  continuous hiss on a full bottle). */
const PURGE_COST = 0.25;

export function createCarController(spec: CarSpec, world: World) {
	const drivetrain = createDrivetrain(spec);
	// Per car, like the drivetrain — the springs are spec data (cars/types.ts,
	// `suspension`), so this is where a second car stops sharing the GR86's
	// ride. The controller steps the PHYSICS half; the scene's render task owns
	// the VISUAL half and hands the instance to the wheel/rig consumers.
	const suspension = createSuspension(spec);
	const hw = spec.hardware;

	/**
	 * Clear Rapier's force accumulator and immediately re-apply what holds the
	 * car up (the suspension's rays — see CLAUDE.md's colliders section). Every
	 * early return below goes through here. `wake` is passed through: the idle
	 * branch must not wake a sleeping body just to hold up one already resting.
	 */
	function resetForces(body: RapierRigidBody, wake: boolean): void {
		body.resetForces(wake);
		suspension.step(body, world);
	}

	// Nitrous + startup state — the scene used to own these locals.
	let nitrousBottle = 1; // 0..1
	/** 0..1 — smoothed spray level. This is what reaches the drivetrain, the
	 *  flames (blue mix + pilot jet) and the HUD, never the raw key. */
	let nitrousFlow = 0;
	/** 0..1 — smoothed PURGE flow (the standstill vent; see the bottle block). */
	let nitrousPurge = 0;
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

		// The `steer` slot reads SCREEN-natural (− left, + right); this model's sign is
		// the opposite. Negated at exactly this line and nowhere else. With the arrows
		// it is ±1 or 0, bit-identical to the two booleans it replaced; with a stick it
		// is proportional, which is the only behavioural difference the migration adds
		// and only when a pad is plugged in.
		const steerKey = -carControls.axis('steer');
		const handbrake = carControls.pressed('handbrake');

		// Ignition gates throttle, brake and shifting — engine off, no drive. Handbrake
		// still works (safety), steering still works (rolling car must still steer).
		// During startup (on but !ready), the startup sequence block below returns early.
		const ignOn = carIgnition.on;
		const throttle = ignOn && carControls.pressed('throttle');
		const brake = ignOn && carControls.pressed('brake');

		// Reset the startup timer when ignition cuts — a mid-startup N press aborts
		// the rev sequence instantly.
		if (!ignOn) startupTimer = 0;

		// The bottle. Runs BEFORE the idle early-return below so it regenerates while
		// parked too, and so `nitrousFlow` is already honest when the idle branch
		// publishes it. Note the throttle switch reads the gated ↑ key: parked with
		// Shift held but no throttle, nothing sprays — the line PURGES instead (and
		// the car may sleep through it; the FX owns its own invalidate).
		const nitrousHeld = ignOn && carControls.pressed('nitrous') && nitrousBottle > NITROUS_DRY;
		const spraying = nitrousHeld && carControls.pressed('throttle') && drivetrain.state.gear >= 1;
		// THE PURGE — the same pedal with the spray gate shut (no throttle, or N/R)
		// vents the line at the hood instead of feeding the intake: the cryo plume
		// sitting on the line, revving in N, rolling off-throttle in gear. A trickle
		// of bottle (the line's worth), so it cannot hiss forever on a dry kit.
		const purging = nitrousHeld && !spraying;
		nitrousFlow +=
			((spraying ? 1 : 0) - nitrousFlow) *
			damp(spraying ? hw.nitrousAttack : hw.nitrousRelease, delta);
		nitrousPurge +=
			((purging ? 1 : 0) - nitrousPurge) * damp(purging ? PURGE_ATTACK : PURGE_RELEASE, delta);
		if (spraying) {
			nitrousBottle = Math.max(0, nitrousBottle - (nitrousFlow * delta) / hw.nitrousCapacity);
		} else if (purging) {
			nitrousBottle = Math.max(
				0,
				nitrousBottle - (nitrousPurge * delta * PURGE_COST) / hw.nitrousCapacity
			);
		} else {
			nitrousBottle = Math.min(1, nitrousBottle + hw.nitrousRegen * delta);
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
			// The kit isn't live until the startup sequence hands over — same rule
			// as the flow above.
			carSim.nitrousPurge = 0;
			carSim.accelFwd = 0;
			carSim.accelLat = 0;
			parkDebugTelemetry();
			publishCarHud(delta, suspension);
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
			!carControls.pressed('shiftUp') &&
			!carControls.pressed('shiftDown');
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
			// THE parked purge publish — the idle branch is exactly where the vent
			// gets held (no pedals, body sleeping; the FX and the drain hiss run
			// off this number from their own always-running tasks).
			carSim.nitrousPurge = nitrousPurge;
			// Parked: the suspension has nothing to lean on, so it rests.
			carSim.accelFwd = 0;
			carSim.accelLat = 0;
			// The DEBUG feed parks too — but the springs do NOT: `resetForces` above
			// cast the four rays, so the panel and the rig still show a parked car
			// standing on four loaded corners, which is exactly what it is doing.
			parkDebugTelemetry();
			carSim.clutch = drivetrain.state.clutch;
			publishCarHud(delta, suspension);
			return;
		}

		const out = drivetrain.step(
			delta,
			speedMs,
			{
				forward: throttle,
				backward: brake,
				handbrake,
				shiftUp: ignOn && carControls.pressed('shiftUp'),
				shiftDown: ignOn && carControls.pressed('shiftDown'),
				// The gearbox SWITCH, read fresh like the tune — the box may change
				// its mind about who shifts halfway through a corner.
				auto: ignOn && carGearbox.mode === 'auto',
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
		// Slip angle at the CG. NOTHING below may depend on its SIGN except
		// `driftAlign` — see CLAUDE.md's "stability rule".
		const driftGate = clamp((speedMs - DRIFT_GATE_SPEED) / DRIFT_GATE_RAMP, 0, 1);
		const beta =
			driftGate > 0 ? Math.atan2(vLateral, Math.max(Math.abs(vForward), 1e-3)) * driftGate : 0;
		carSim.drift = beta;

		// How loose the rear is, 0…1 — whichever source is loosest wins, they do
		// NOT stack (see CLAUDE.md's "Looseness is max(...)" bullet). Faded back
		// out as the slide reaches `maxDriftAngle`, which is what lets a drift
		// SETTLE rather than spin.
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

		// The planted car: the lesser of the geometric and grip-limited rate, both
		// scaled by the boost (see CLAUDE.md's yaw-authority bullets).
		const yawDemand = ((speedMs * Math.tan(carSim.steerAngle)) / hw.wheelbase) * boost;
		const yawCap = (latGrip * boost * G) / Math.max(absSpeed, YAW_MIN_SPEED);
		// The auto-catch, scaled by how much rear grip is left — a spinning tyre
		// aligns nothing (CLAUDE.md's `driftAlign` bullet). Zero in Grip.
		// On the handbrake `loose` is 1, so it has its own catch (`handbrakeAlign`).
		const align = handbrake ? tune.handbrakeAlign : tune.driftAlign * (1 - loose);
		const targetYaw = clamp(yawDemand, -yawCap, yawCap) - align * beta;

		const ang = body.angvel(_ang);
		ang.y += (targetYaw - ang.y) * damp(tune.yawResponse, delta);
		body.setAngvel(ang, true);

		// Bleed the sideways velocity, capped at what the tyres could actually pull
		// back (CLAUDE.md "Cornering is the μ, not the damp rate"). μ runs from
		// `handbrakeMuLat` to `latGrip`, interpolated across the drivetrain's
		// `gripFactor`.
		const muLat =
			tune.handbrakeMuLat + (latGrip - tune.handbrakeMuLat) * clamp(out.gripFactor, 0, 1);
		const settle = vLateral * damp(hw.gripRate, delta);
		const bleedLimit = muLat * G * UNITS_PER_METER * delta; // m/s² → world units/s this step
		/** Share of the lateral budget this corner demands, 0..1 — pins at 1
		 *  exactly at max banking; the squeal (carAudio) reads it. */
		const latLoad = clamp(Math.abs(settle) / bleedLimit, 0, 1);
		const bleed = clamp(settle, -bleedLimit, bleedLimit);
		_vel.addScaledVector(_right, -bleed);
		body.setLinvel({ x: _vel.x, y: _vel.y, z: _vel.z }, true);

		// The suspension's input: the model's OWN accelerations, not a finite
		// difference of the pose (CLAUDE.md's suspension section). `-bleed`
		// because the bleed is applied along `-_right` and the reaction points
		// the other way, so this is positive in a left-hand corner (body +X).
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
		// One seq tick per engagement — the drivetrain's `shifted` flag lives for a
		// single STEP, and this runs several steps per frame, so the shift bark's
		// tick edge-detects a counter instead (hullHitSeq's own contract).
		if (drivetrain.state.shifted) carSim.shiftSeq++;
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
		carSim.nitrousPurge = nitrousPurge;

		// The debug feed — publishes only, every number already computed above.
		// The rig must never re-derive one of these (CLAUDE.md's "if the rig
		// needs a number, publish the number").
		carSim.spin = drivetrain.state.spin;
		carSim.clutch = drivetrain.state.clutch;
		carSim.driveForce = out.driveForce;
		carSim.resistForce = out.resistForce;
		carSim.powerLoad = out.powerLoad;
		carSim.gripFactor = out.gripFactor;
		carSim.loose = loose;
		carSim.muLat = muLat;
		// The yaw rate actually COMMANDED this step (`ang.y` is post-damp, i.e.
		// what went into `setAngvel`), and the sideways velocity in body +X —
		// straight through, no sign games: whichever side +X is, the rig's
		// velocity arrow is `(velLat, 0, -speedMs)` in the same frame it draws in.
		carSim.yawRate = ang.y;
		carSim.velLat = vLateral / UNITS_PER_METER;

		publishCarHud(delta, suspension);
	}

	/** Zero the debug feed on the paths that never reach the drivetrain (startup
	 *  and parked). The SPRING half is deliberately left alone — the rays ran. */
	function parkDebugTelemetry(): void {
		carSim.spin = 0;
		carSim.velLat = 0;
		carSim.yawRate = 0;
		carSim.driveForce = 0;
		carSim.resistForce = 0;
		carSim.powerLoad = 0;
		carSim.gripFactor = 1;
		carSim.loose = 0;
		carSim.muLat = latMu(spec.tunes[carHandling.mode]);
		carSim.clutch = 1;
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
		nitrousPurge = 0;
		startupTimer = 0;
	}

	return { step, restart, park, drivetrain, suspension };
}

export type CarController = ReturnType<typeof createCarController>;
