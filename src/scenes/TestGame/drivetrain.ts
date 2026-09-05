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
//   leftover torque becomes WHEEL SPEED (`spin`), which the revs follow and the
//   scene turns into lost lateral grip — power oversteer, for free.
// - TRACTION CONTROL, as a per-setup switch. The real car has it and Grip runs it;
//   Drift turns it off, and that is what lets the rears run away to the limiter.
//
// Everything above is the CAR and is fixed. The three numbers that are the SETUP —
// how much the rear axle can put down, how much lateral grip wheelspin costs, and
// whether the ECU intervenes — come in per step as a `HandlingTune` (handling.ts),
// because the player can switch tunes mid-corner and nothing here may cache them.
//
// ── Wheelspin is a SPEED, not a ratio ──────────────────────────────────────────
// `spin` is how much faster the rear tyre's contact patch is running than the road,
// in m/s, integrated against the rotating inertia in `gr86.ts`. It used to be a
// force ratio clamped to 0…1 that scaled road speed by at most 1.8×, and that had
// two consequences worth remembering:
//   - **The revs could not run away.** A donut at 4 m/s pinned in 1st sat at about
//     2 900 rpm however hard the tyres were spinning, because the "wheel speed" was
//     road speed times a number that saturated. Now the surplus force accelerates
//     the wheels for real and the limiter is what stops it — a burnout screams.
//   - **The limiter used to BRAKE the car mid-wheelspin.** Its fuel cut turns crank
//     torque negative, and the drive force followed it straight to −2 100 N. A
//     spinning tyre hands the road full μ in the direction the wheels are turning,
//     whatever the engine is doing, so the force is now +traction throughout and
//     bouncing off the limiter no longer stops the slide.

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
	/** How much of the rear axle's grip budget the drive force is spending, 0…1 —
	 *  the FRICTION CIRCLE. A tyre has one budget; grip spent pushing the car along
	 *  is not available to hold it sideways, and that is true well before the tyre
	 *  actually spins. The scene turns this into looseness (`throttleLoose`), which
	 *  is what lets the throttle provoke a slide in a gear that never lights the
	 *  rears up — without it, only 1st and 2nd could ever break traction. */
	powerLoad: number;
}

export interface DrivetrainState {
	/** -1 reverse, 0 neutral, 1…6. */
	gear: number;
	rpm: number;
	/** 0 = clutch on the floor (mid-shift), 1 = fully home. */
	clutch: number;
	/** 0…1 — how LIT the rears are: wheel overspeed over `FULL_SLIP`, so 1 is a tyre
	 *  doing nothing but smoke. Feeds lateral grip here, looseness in the scene, and
	 *  the cluster's TC lamp. */
	slip: number;
	/** m/s — how much faster the rear contact patch is running than the road, signed
	 *  along the nose. The state `slip` is a normalised view of; the revs read it. */
	spin: number;
	throttle: number;
	brake: number;
	/** Fuel cut is active (limiter bouncing or top speed reached). */
	limiting: boolean;
	/** True for the frame a gear change starts — the scene can bark a sound off it. */
	shifted: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * m/s of wheel overspeed that reads as TOTAL wheelspin — `slip` = 1, and the tyre
 * has given up whatever `slipGripLoss` says it gives up. Sized off what the gearing
 * can actually reach: 1st tops out ~12 m/s of spin at the limiter, 2nd ~10 after a
 * long pull, 3rd cannot spin at all. So 1st goes fully lit and 2nd only gets there
 * if you hold it, which is the contrast the tune wants.
 */
const FULL_SLIP = 10;
/**
 * m/s of overspeed the TRACTION CONTROL tolerates. Modelled as a ceiling on slip
 * rather than a torque-cut loop — the outcome is what matters, and a real ECU trims
 * torque precisely to stop the number here from growing. Deliberately generous: at
 * 2 m/s Grip's launch lands at `slip` 0.2, which is what its old force-ratio slip
 * peaked at, so Grip loses the same ~11% of lateral tyre off the line it always did
 * and the cluster's TC lamp (`slip > 0.15`) still lights when the ECU is working.
 */
const TC_SLIP = 2;
/** m/s under which the tyre is gripping rather than sliding. Noise floor. */
const HOOKED = 0.05;

export type Drivetrain = ReturnType<typeof createDrivetrain>;

export function createDrivetrain() {
	const state: DrivetrainState = {
		gear: 1,
		rpm: GR86.idleRpm,
		clutch: 1,
		slip: 0,
		spin: 0,
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
		const total = totalRatio(state.gear);
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
			const homeAt = GR86.launchSpeed * (totalRatio(1) / total);
			const coupling = clamp(rolling / homeAt, 0, 1);
			state.clutch = coupling;

			// `spin` feeds back here: spinning wheels turn faster than the road, so the
			// revs climb even though the car is not. It is a real wheel speed, so this
			// is just the gearing — a donut on the limiter is 12 m/s of spin over a
			// 4 m/s car, and the tacho says so.
			const gearRpm = rpmInGear(state.gear, speedMs + state.spin);
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
		const reduction = (total * GR86.efficiency) / GR86.wheelRadius;
		const requested = crankTorque * clutchTorque * reduction * Math.sign(ratio || 1);

		// ── Traction at the rear axle ────────────────────────────────────────
		// Static rear load plus longitudinal transfer (m·a·h/L, and m·a is just
		// last step's force). Handbrake locks the rears, so they drive nothing.
		const rearLoad = Math.max(
			0,
			GR86.mass * G * GR86.rearWeightBias + (prevDrive * GR86.cogHeight) / GR86.wheelbase
		);
		const traction = input.handbrake ? 0 : tune.tireMuLong * rearLoad;

		// What the tyre hands the road. Gripping, it passes the engine's request up to
		// the limit. SLIDING, it gives full μ along the way the wheels are turning and
		// the engine has no say at all — which is why a burnout keeps pulling through
		// the limiter's fuel cut instead of braking the car (see the header).
		const sliding = Math.abs(state.spin) > HOOKED;
		const driveForce = sliding
			? Math.sign(state.spin) * traction
			: clamp(requested, -traction, traction);

		// Everything the engine asked for beyond what the tyre took goes into WHEEL
		// SPEED. The rotating assembly resists that as an equivalent mass at the
		// contact patch, I/r², with the engine's own inertia reflected through the
		// gearing squared: ~460 kg in 1st against ~95 in 3rd. That single number is
		// why 1st lights up in a blink, 2nd builds over a couple of seconds, and 3rd
		// (which cannot out-pull the tyre anyway) never spins.
		const spinMass =
			((connected ? GR86.engineInertia * total * total : 0) + GR86.wheelInertia) /
			(GR86.wheelRadius * GR86.wheelRadius);
		const wasSpin = state.spin;
		state.spin += ((requested - driveForce) / spinMass) * dt;
		// Never let a decaying spin cross zero inside one step — that is the wheels
		// grabbing and dragging the car the other way.
		if (wasSpin * state.spin < 0) state.spin = 0;
		// The handbrake holds the rears still: locked, not lit.
		if (input.handbrake) state.spin = 0;
		// TRACTION CONTROL, the setup's call. Grip runs the real car's, so the rears
		// are caught the moment they step out. Drift has none — the whole point, and
		// the only reason a donut can sit on the limiter.
		if (tune.tractionControl) state.spin = clamp(state.spin, -TC_SLIP, TC_SLIP);

		prevDrive = driveForce;
		// No filter on `slip` any more: `spin` carries the real rotating inertia, which
		// is the smooth thing the old asymmetric damping was faking. It is also why
		// lifting still catches the slide — off throttle the surplus goes sharply
		// negative (engine braking pulling one way, the sliding tyre the other), so a
		// lit 1st gear hooks back up in about 0.7 s and 2nd in a quarter of that.
		state.slip = clamp(Math.abs(state.spin) / FULL_SLIP, 0, 1);
		// Friction circle: the share of the rear's budget the drive force is using, AFTER
		// the clip (so it saturates at 1 exactly when the tyre lets go). Off throttle
		// this is just engine braking, a tenth or so — which is the point, because it is
		// what makes lifting a real input rather than a no-op.
		const powerLoad = traction > 0 ? clamp(Math.abs(driveForce) / traction, 0, 1) : 0;

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
		// `looseBase` is a small flat cut, `brakeLoose` is trail-braking oversteer
		// (braking moves load off the rear axle, and a lighter rear tyre has less
		// lateral grip to give), and `throttleLoose` is the friction circle above. All
		// zero in Grip. They compound, so brake-and-power together is the loosest the
		// car gets short of the handbrake.
		//
		// `looseBase` deliberately stays SMALL. At 0.6 the car ran 32° of slip angle
		// just coasting through a gentle corner — permanently sideways, no contrast
		// between planted and provoked, which reads as floaty rather than fun. The
		// looseness wants to be earned by an input, not baked into the tyre.
		const gripFactor = input.handbrake
			? 0
			: (1 - tune.slipGripLoss * state.slip) *
				(1 - tune.looseBase) *
				(1 - tune.brakeLoose * braking) *
				(1 - tune.throttleLoose * powerLoad);

		return { driveForce, resistForce: resist, gripFactor, powerLoad };
	}

	/** Called when the car is parked and the scene stops touching the body. */
	function idle(dt: number): void {
		state.throttle = 0;
		state.brake = 0;
		state.slip = 0;
		state.spin = 0;
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
		state.spin = 0;
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
