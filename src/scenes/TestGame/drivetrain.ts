// Engine + clutch + 6-speed gearbox for the GR86. Pure SI, pure function of its
// own state — no runes, no Three, no Rapier. The scene owns the body and calls
// `step()` once per physics step with the road speed it measured.
//
// What this models, and why each piece is here for FEEL rather than realism:
//
// - A torque CURVE through GEARS, so acceleration falls off through the rev range
//   and snaps back on every upshift. That contrast is the whole point of gears.
// - A clutch that is fully OPEN for the length of a shift: torque cuts, revs
//   drop, the car coasts for 0.28 s. Shifting has to cost something or nobody
//   cares which gear they are in.
// - A slipping clutch below `launchSpeed`, so pulling away from a light holds
//   ~3200 rpm instead of bogging at idle.
// - Engine BRAKING off-throttle, scaled by the gear you are in. Lifting in 2nd
//   should feel different from lifting in 6th.
// - A bouncing rev limiter (fuel cut, not a clamp), which is what tells you to
//   shift without a HUD.
// - A traction limit at the driven (rear) axle including load transfer, so
//   flooring 1st spins the wheels instead of teleporting the car forward. The
//   leftover torque becomes `slip`, which the scene turns into lost lateral grip
//   — power oversteer, for free.
//
// Everything above is the CAR and is fixed. The two numbers that are the SETUP —
// how much the rear axle can put down, and how much lateral grip wheelspin costs —
// come in per step as a `HandlingTune` (handling.ts), because the player can switch
// tunes mid-corner and nothing here may cache them.

import {
	G,
	GR86,
	TOP_GEAR,
	engineBrakeTorque,
	engineTorque,
	gearRatio,
	rpmInGear,
	totalRatio
} from './gr86';
import type { HandlingTune } from './handling';

/** Raw driver intent for one step. Shift flags are LEVEL, not edges — see `step`. */
export interface DriveInput {
	/** ↑ held. Throttle — drives the car forwards, or backwards in R. */
	forward: boolean;
	/** ↓ held. Brake — only ever the brake, in every gear. */
	backward: boolean;
	handbrake: boolean;
	shiftUp: boolean;
	shiftDown: boolean;
}

export interface DriveOutput {
	/** N along the car's nose, signed. Engine + engine braking, traction-clipped. */
	driveForce: number;
	/** N along the nose, signed — always opposes motion. Brakes + drag + rolling. */
	resistForce: number;
	/** Lateral grip left, 0…1: 1 = the tyre's full bite, 0 = the handbrake's drift
	 *  limit. The scene interpolates its two tuned grip rates across this. */
	gripFactor: number;
}

export interface DrivetrainState {
	/** -1 reverse, 0 neutral, 1…6. */
	gear: number;
	rpm: number;
	/** 0 = clutch on the floor (mid-shift), 1 = fully home. */
	clutch: number;
	/** 0…1 — how far past the rear axle's traction limit the engine is asking. */
	slip: number;
	throttle: number;
	brake: number;
	/** Fuel cut is active (limiter bouncing or top speed reached). */
	limiting: boolean;
	/** True for the frame a gear change starts — the scene can bark a sound off it. */
	shifted: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export type Drivetrain = ReturnType<typeof createDrivetrain>;

export function createDrivetrain() {
	const state: DrivetrainState = {
		gear: 1,
		rpm: GR86.idleRpm,
		clutch: 1,
		slip: 0,
		throttle: 0,
		brake: 0,
		limiting: false,
		shifted: false
	};

	let shiftTimer = 0;
	let cutTimer = 0;
	/** Rising-edge latches for Q/E — the scene passes held booleans. */
	let prevUp = false;
	let prevDown = false;
	/** Last step's drive force, for the load-transfer term. Chicken-and-egg, one step stale. */
	let prevDrive = 0;

	function engage(gear: number): void {
		if (gear === state.gear) return;
		state.gear = gear;
		shiftTimer = GR86.shiftTime;
		state.shifted = true;
	}

	function requestShift(dir: number, speedMs: number): void {
		const next = state.gear + dir;
		if (next > TOP_GEAR || next < -1) return;
		// Reverse only while (nearly) stopped or already rolling back; forward
		// gears only while (nearly) stopped or already rolling forward. The 3 m/s
		// grace window lets you slot 1st from R/N (or R from 1st) while still
		// creeping instead of waiting for a dead stop; the money-shift guard
		// below still refuses anything that would over-rev. Neutral is always
		// available.
		if (next < 0 && speedMs > 3) return;
		if (next > 0 && speedMs < -3) return;
		// Money-shift guard: refuse a downshift that would slam past the limiter.
		if (next > 0 && rpmInGear(next, speedMs) > GR86.limiterRpm) return;
		engage(next);
	}

	/**
	 * Advance one physics step.
	 *
	 * @param dt      step length, seconds
	 * @param speedMs road speed along the nose, signed, m/s
	 * @param tune    the selected setup — read fresh every step, never cached
	 */
	function step(dt: number, speedMs: number, input: DriveInput, tune: HandlingTune): DriveOutput {
		state.shifted = false;
		const rolling = Math.abs(speedMs);

		// ── Gear selection ───────────────────────────────────────────────────
		if (input.shiftUp && !prevUp) requestShift(1, speedMs);
		if (input.shiftDown && !prevDown) requestShift(-1, speedMs);
		prevUp = input.shiftUp;
		prevDown = input.shiftDown;

		// ── Pedals ───────────────────────────────────────────────────────────────
		// No pedal swapping in reverse: ↑ is ALWAYS throttle, ↓ is ALWAYS brake.
		// In R the throttle simply drives the car backwards — you slot R with Q
		// and pull away on the same key as everywhere else.
		const throttle = input.forward ? 1 : 0;
		const braking = input.backward ? 1 : 0;
		state.throttle = throttle;
		state.brake = braking;

		// ── Clutch & engine speed ────────────────────────────────────────────
		shiftTimer = Math.max(0, shiftTimer - dt);
		const ratio = gearRatio(state.gear);
		const connected = ratio !== 0 && shiftTimer === 0;

		if (!connected) {
			// Neutral or mid-shift: the engine is on its own. Blipping the throttle
			// during a shift actually does something, which is the point.
			state.clutch = 0;
			const free = GR86.idleRpm + throttle * (GR86.limiterRpm - GR86.idleRpm);
			const rate = throttle > 0 ? GR86.freeRevRate : GR86.freeDropRate;
			state.rpm += (free - state.rpm) * damp(rate, dt);
		} else {
			// Slip the clutch off the line so a launch holds revs instead of bogging.
			// Scaled by gear: 1st is home by 4.5 m/s, 6th would never slip anyway.
			const homeAt = GR86.launchSpeed * (totalRatio(1) / totalRatio(state.gear));
			const coupling = clamp(rolling / homeAt, 0, 1);
			state.clutch = coupling;

			// `slip` feeds back here: spinning wheels turn faster than the road, so
			// the revs climb even though the car is not.
			const gearRpm = rpmInGear(state.gear, speedMs * (1 + state.slip * 0.8));
			const slipping = GR86.idleRpm + throttle * (GR86.launchRpm - GR86.idleRpm);
			const target = Math.max(
				GR86.idleRpm,
				gearRpm,
				gearRpm * coupling + slipping * (1 - coupling)
			);
			state.rpm += (target - state.rpm) * damp(GR86.rpmResponse, dt);
		}

		// ── Fuel cut: rev limiter and the 140 mph governor ───────────────────
		if (state.rpm >= GR86.limiterRpm) cutTimer = GR86.limiterCut;
		cutTimer = Math.max(0, cutTimer - dt);
		const governed = speedMs > GR86.topSpeed;
		const cut = cutTimer > 0 || governed;
		state.limiting = cut && throttle > 0;
		state.rpm = clamp(state.rpm, GR86.idleRpm, GR86.limiterRpm + 150);

		// ── Crank torque → wheel force ───────────────────────────────────────
		let crankTorque = 0;
		if (connected) {
			// Lugging: below ~1400 rpm the engine can't make its curve.
			const lug = clamp(state.rpm / GR86.lugRpm, 0.35, 1);
			const wot = engineTorque(state.rpm) * lug;
			const drag = engineBrakeTorque(state.rpm);
			crankTorque = cut ? -drag : throttle * wot - (1 - throttle) * drag;
		}
		// A slipping clutch transmits less than the crank makes — without this the car
		// launched off the line at the full traction limit and ran 0-60 in 5.2 s
		// against the real GR86's 6.1. It is also what stops the car lurching when you
		// blip the throttle at walking pace.
		const clutchTorque = GR86.clutchMinBite + (1 - GR86.clutchMinBite) * state.clutch;
		const reduction = (totalRatio(state.gear) * GR86.efficiency) / GR86.wheelRadius;
		let driveForce = crankTorque * clutchTorque * reduction * Math.sign(ratio || 1);

		// ── Traction at the rear axle ────────────────────────────────────────
		// Static rear load plus longitudinal transfer (m·a·h/L, and m·a is just
		// last step's force). Handbrake locks the rears, so they drive nothing.
		const rearLoad = Math.max(
			0,
			GR86.mass * G * GR86.rearWeightBias + (prevDrive * GR86.cogHeight) / GR86.wheelbase
		);
		const traction = input.handbrake ? 0 : tune.tireMuLong * rearLoad;

		let slipTarget = 0;
		if (Math.abs(driveForce) > traction) {
			// Only powering the wheels loose counts as wheelspin — engine braking
			// past the limit is a locked-diff shove, not smoke.
			if (crankTorque > 0 && traction > 0) {
				slipTarget = clamp((Math.abs(driveForce) - traction) / traction, 0, 1);
			}
			driveForce = Math.sign(driveForce) * traction;
		}
		// Fast to break traction, slower to hook back up.
		state.slip += (slipTarget - state.slip) * damp(slipTarget > state.slip ? 14 : 5, dt);
		prevDrive = driveForce;

		// ── Brakes, aero, rolling resistance ─────────────────────────────────
		let resist = 0;
		if (rolling > 0.05) {
			const dir = Math.sign(speedMs);
			let magnitude = GR86.dragK * speedMs * speedMs + GR86.rollingResistance;
			magnitude += braking * GR86.brakeForce;
			if (input.handbrake) magnitude += GR86.handbrakeForce;
			// Never let a retarding force push the car backwards inside one step.
			const stopping = (rolling * GR86.mass) / dt;
			resist = -dir * Math.min(magnitude, stopping);
		}

		// ── Lateral grip left over for the cornering model ───────────────────
		// The handbrake takes it all the way to the drift end; wheelspin takes a
		// chunk of it, which is how a rear-drive car steps out under power. How big
		// a chunk is the setup's call — 0.55 (Grip) leaves 45% of the tyre under
		// total wheelspin, which is not loose enough to slide on power alone.
		const gripFactor = input.handbrake ? 0 : 1 - tune.slipGripLoss * state.slip;

		return { driveForce, resistForce: resist, gripFactor };
	}

	/** Called when the car is parked and the scene stops touching the body. */
	function idle(dt: number): void {
		state.throttle = 0;
		state.brake = 0;
		state.slip = 0;
		state.limiting = false;
		state.shifted = false;
		state.rpm += (GR86.idleRpm - state.rpm) * damp(GR86.freeDropRate, dt);
		prevDrive = 0;
	}

	function reset(): void {
		state.gear = 1;
		state.rpm = GR86.idleRpm;
		state.clutch = 1;
		state.slip = 0;
		state.throttle = 0;
		state.brake = 0;
		state.limiting = false;
		state.shifted = false;
		shiftTimer = 0;
		cutTimer = 0;
		prevUp = false;
		prevDown = false;
		prevDrive = 0;
	}

	return { state, step, idle, reset };
}
