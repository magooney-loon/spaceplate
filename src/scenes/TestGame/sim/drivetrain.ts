// Engine + clutch + gearbox, generic over a CarSpec (cars/). Pure SI, pure
// function of its own state — no runes, no Three, no Rapier. The controller
// (sim/controller.ts) owns the body and calls `step()` once per physics step
// with the road speed it measured.
//
// What this models, and why each piece is here for FEEL rather than realism:
//
// - A torque CURVE through GEARS, so acceleration falls off through the rev range
//   and snaps back on every upshift. That contrast is the whole point of gears.
// - A clutch that is fully OPEN for the length of a shift: torque cuts, revs
//   drop, the car coasts for the shift window. Shifting has to cost something
//   or nobody cares which gear they are in.
// - A slipping clutch below `launchSpeed`, so pulling away from a light holds
//   the launch rpm instead of bogging at idle.
// - A REV-MATCH LAUNCH: slot 1st out of N with the revs inside the car's launch
//   window (spec `launchWindowMinRpm/MaxRpm`) and the clutch drops CLEAN — bite
//   and driven-axle plant both scale with DEPTH in
//   the window, so the closer to the top the harder the launch. Miss the window
//   and the soft slip above eats the excess like every other launch.
// - Engine BRAKING off-throttle, scaled by the gear you are in. Lifting in 2nd
//   should feel different from lifting in 6th.
// - A bouncing rev limiter (fuel cut, not a clamp), which is what tells you to
//   shift without a HUD.
// - A traction limit at the DRIVEN axle including load transfer, so flooring 1st
//   spins the wheels instead of teleporting the car forward. The leftover torque
//   becomes WHEEL SPEED (`spin`), which the revs follow and the controller turns
//   into lost lateral grip — power oversteer, for free. The axle's static load
//   and transfer sign come from the spec's `layout` (cars/spec.ts,
//   `drivenAxleLoad`) — RWD is the original formula; FWD/AWD are the plumbing
//   until their handling feel is tuned against real cars.
// - TRACTION CONTROL, as a per-setup switch. The real car has it and Grip runs it;
//   Drift turns it off, and that is what lets the rears run away to the limiter.
//
// Everything above is the CAR and is fixed. The three numbers that are the SETUP —
// how much the driven axle can put down, how much lateral grip wheelspin costs, and
// whether the ECU intervenes — come in per step as a `HandlingTune` (handling.ts),
// because the player can switch tunes mid-corner and nothing here may cache them.
//
// ── Wheelspin is a SPEED, not a ratio ──────────────────────────────────────────
// `spin` is how much faster the driven tyre's contact patch is running than the
// road, in m/s, integrated against the rotating inertia in the car's spec. It
// used to be a force ratio clamped to 0…1 that scaled road speed by at most
// 1.8×, and that had two consequences worth remembering:
//   - **The revs could not run away.** A donut at 4 m/s pinned in 1st sat at about
//     2 900 rpm however hard the tyres were spinning, because the "wheel speed" was
//     road speed times a number that saturated. Now the surplus force accelerates
//     the wheels for real and the limiter is what stops it — a burnout screams.
//   - **The limiter used to BRAKE the car mid-wheelspin.** Its fuel cut turns crank
//     torque negative, and the drive force followed it straight to −2 100 N. A
//     spinning tyre hands the road full μ in the direction the wheels are turning,
//     whatever the engine is doing, so the force is now +traction throughout and
//     bouncing off the limiter no longer stops the slide.

import type { CarSpec } from '../cars/types';
import {
	drivenAxleLoad,
	engineBrakeTorque,
	engineTorque,
	gearRatio,
	rpmInGear,
	topGear,
	totalRatio
} from '../cars/spec';
import type { HandlingTune } from './handling';
import { clamp, damp } from './carMath';

/** Raw driver intent for one step. Shift flags are LEVEL, not edges — see `step`. */
export interface DriveInput {
	/** ↑ held. Throttle — drives the car forwards, or backwards in R. */
	forward: boolean;
	/** ↓ held. Brake — only ever the brake, in every gear. */
	backward: boolean;
	handbrake: boolean;
	shiftUp: boolean;
	shiftDown: boolean;
	/** 0..1 — nitrous flow reaching the engine this step. The SCENE owns the
	 * bottle and the throttle-switch gating (Shift alone does nothing); this is just
	 * how much spray is in, multiplying wide-open-throttle torque. Sits INSIDE
	 * the traction limit like any engine torque, so in the low gears a shot
	 * becomes wheelspin rather than teleportation. */
	nitrous: number;
}

export interface DriveOutput {
	/** N along the car's nose, signed. Engine + engine braking, traction-clipped. */
	driveForce: number;
	/** N along the car's nose, signed — always opposes motion. Brakes + drag + rolling. */
	resistForce: number;
	/** Lateral grip left, 0…1: 1 = the tyre's full bite, 0 = the handbrake's drift
	 *  limit. The controller interpolates its two tuned grip rates across this. */
	gripFactor: number;
	/** How much of the driven axle's grip budget the drive force is spending, 0…1 —
	 *  the FRICTION CIRCLE. A tyre has one budget; grip spent pushing the car along
	 *  is not available to hold it sideways, and that is true well before the tyre
	 *  actually spins. The controller turns this into looseness (`throttleLoose`),
	 *  which is what lets the throttle provoke a slide in a gear that never lights
	 *  the rears up — without it, only 1st and 2nd could ever break traction. */
	powerLoad: number;
}

export interface DrivetrainState {
	/** -1 reverse, 0 neutral, 1…6. */
	gear: number;
	rpm: number;
	/** 0 = clutch on the floor (mid-shift), 1 = fully home. */
	clutch: number;
	/** 0…1 — how LIT the driven tyres are: wheel overspeed over the spec's
	 *  `fullSlipSpeed`, so 1 is a tyre doing nothing but smoke. Feeds lateral
	 *  grip here, looseness in the controller, and the cluster's TC lamp. */
	slip: number;
	/** m/s — how much faster the driven contact patch is running than the road,
	 *  signed along the nose. The state `slip` is a normalised view of; the revs
	 *  read it. */
	spin: number;
	throttle: number;
	brake: number;
	/** Fuel cut is active (limiter bouncing or top speed reached). */
	limiting: boolean;
	/** True for the frame a gear change starts — the scene can bark a sound off it. */
	shifted: boolean;
	/** True for the frame a REV-MATCH LAUNCH lands — 1st slotted from N with the
	 * revs in the window and the clutch just dropped clean. The scene flashes
	 * the cluster off it. */
	launched: boolean;
	/** The caught launch's tier, set the same frame as `launched` (from the
	 * caught rpm, not the live one): 0 = STREET (4–5k), 1 = JUICY (5–5.5k),
	 * 2 = PERFECT (5.5–6k). Presentation bands — the boost itself stays
	 * continuous; the cluster flash names the band. */
	launchTier: number;
	/** 0..1 — rev-match launch LIVE: depth in the window × what's left of the
	 * clutch drop. Fades to 0 exactly as the clutch homes; the tyre-squeal
	 * source reads it through carSim. */
	launch: number;
}

/** m/s under which the tyre is gripping rather than sliding. Noise floor. */
const HOOKED = 0.05;

export type Drivetrain = ReturnType<typeof createDrivetrain>;

export function createDrivetrain(spec: CarSpec) {
	const hw = spec.hardware;

	const state: DrivetrainState = {
		gear: 1,
		rpm: hw.idleRpm,
		clutch: 1,
		slip: 0,
		spin: 0,
		throttle: 0,
		brake: 0,
		limiting: false,
		shifted: false,
		launched: false,
		launchTier: 0,
		launch: 0
	};

	let shiftTimer = 0;
	let cutTimer = 0;
	/** Rising-edge latches for Q/E — the scene passes held booleans. */
	let prevUp = false;
	let prevDown = false;
	/** Last step's drive force, for the load-transfer term. Chicken-and-egg, one step stale. */
	let prevDrive = 0;
	/** Phase accumulator for the idle wobble — organic fluctuation around idle. */
	let idlePhase = 0;
	/** rpm held during a REV-MATCH LAUNCH, 0 = none. Latched in engage() when 1st
	 * slots from N with the revs in the window; cleared by the clutch coming
	 * home, a lift, or any further gear change (engage re-latches). */
	let launchHold = 0;
	/** Depth in the window at the catch, 0…1 — how hard the launch is. Bite and
	 * the driven-axle plant both scale with it. */
	let launchQ = 0;
	/** The live launch boost: `launchQ` held through the clutch drop, then
	 * decaying into 1st (spec `launchBoostDecay`). Plant and torque gain read THIS —
	 * the slam must outlive the drop or it reads as a blip. Zeroed instantly on
	 * a lift or gear change: no reward for aborted launches. */
	let launchBoost = 0;
	/** One-shot latch so `state.launched` fires on the landing frame only. */
	let launchAnnounced = false;

	function engage(gear: number): void {
		if (gear === state.gear) return;
		// The rev-match window is judged at the TAP — the shift cut that follows
		// lets the revs climb out of it, and that climb is the player's timing,
		// not a miss. Depth in the window (`launchQ`) is how hard the launch is:
		// the floor is barely more than the street launch, the top is a dropped
		// clutch at full plant. Rolling engagements past `launchSpeed` self-clear
		// in the step (coupling is already 1) — a launch this is not.
		launchHold =
			gear === 1 &&
			state.gear === 0 &&
			state.rpm >= hw.launchWindowMinRpm &&
			state.rpm <= hw.launchWindowMaxRpm
				? state.rpm
				: 0;
		launchQ =
			launchHold > 0
				? clamp(
						(state.rpm - hw.launchWindowMinRpm) / (hw.launchWindowMaxRpm - hw.launchWindowMinRpm),
						0,
						1
					)
				: 0;
		launchBoost = launchQ;
		state.gear = gear;
		shiftTimer = hw.shiftTime;
		state.shifted = true;
	}

	function requestShift(dir: number, speedMs: number): void {
		const next = state.gear + dir;
		if (next > topGear(spec) || next < -1) return;
		// Reverse only while (nearly) stopped or already rolling back; forward
		// gears only while (nearly) stopped or already rolling forward. The 5 m/s
		// grace window (up from 3, for friendlier shifting) lets you slot 1st from
		// R/N (or R from 1st) while still creeping instead of waiting for a dead
		// stop; the money-shift guard below still refuses anything that would
		// over-rev. Neutral is always available.
		if (next < 0 && speedMs > 5) return;
		if (next > 0 && speedMs < -5) return;
		// Money-shift guard: refuse a downshift that would slam past the limiter.
		if (next > 0 && rpmInGear(spec, next, speedMs) > hw.limiterRpm) return;
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
		state.launched = false;
		const rolling = Math.abs(speedMs);

		// ── Gear selection ───────────────────────────────────────────────────
		if (input.shiftUp && !prevUp) requestShift(1, speedMs);
		if (input.shiftDown && !prevDown) requestShift(-1, speedMs);
		prevUp = input.shiftUp;
		prevDown = input.shiftDown;

		// ── Pedals ───────────────────────────────────────────────────────────
		// No pedal swapping in reverse: ↑ is ALWAYS throttle, ↓ is ALWAYS brake.
		// In R the throttle simply drives the car backwards — you slot R with Q
		// and pull away on the same key as everywhere else.
		const throttle = input.forward ? 1 : 0;
		const braking = input.backward ? 1 : 0;
		state.throttle = throttle;
		state.brake = braking;

		// ── Clutch & engine speed ────────────────────────────────────────────
		shiftTimer = Math.max(0, shiftTimer - dt);
		const ratio = gearRatio(spec, state.gear);
		const total = totalRatio(spec, state.gear);
		const connected = ratio !== 0 && shiftTimer === 0;

		if (!connected) {
			// Neutral or mid-shift: the engine is on its own. Blipping the throttle
			// during a shift actually does something, which is the point.
			state.clutch = 0;
			state.launch = 0;
			const free = hw.idleRpm + throttle * (hw.limiterRpm - hw.idleRpm);
			const rate = throttle > 0 ? hw.freeRevRate : hw.freeDropRate;
			state.rpm += (free - state.rpm) * damp(rate, dt);
		} else {
			// Slip the clutch off the line so a launch holds revs instead of bogging.
			// Scaled by gear: 1st is home by launchSpeed, top gear would never slip anyway.
			const homeAt = hw.launchSpeed * (totalRatio(spec, 1) / total);
			const coupling = clamp(rolling / homeAt, 0, 1);
			// REV-MATCH LAUNCH (window at the top): while held, the clutch is DOWN
			// CLEAN and DEPTH in the window sets how hard — bite scales
			// `clutchMinBite`→1 with `launchQ`, the revs sit where you caught them
			// instead of the soft-slip launch rpm. The BOOST (plant + torque) is
			// `launchBoost`: held through the drop, then decaying into 1st so the
			// slam outlives the engagement. The hold ends when the clutch homes or
			// the throttle lifts; a lift (or any gear change) kills the boost too —
			// no reward for aborted launches.
			if (launchHold > 0 && (coupling >= 1 || throttle === 0)) {
				launchHold = 0;
				launchQ = 0;
				if (throttle === 0) launchBoost = 0;
			}
			if (launchHold > 0) launchBoost = launchQ;
			else if (launchBoost > 0) {
				launchBoost = Math.max(0, launchBoost - hw.launchBoostDecay * dt);
			}
			if (launchHold > 0 && !launchAnnounced) {
				launchAnnounced = true;
				state.launched = true;
				// The tier off the CAUGHT rpm (launchHold is still the catch here).
				state.launchTier = launchHold >= 5500 ? 2 : launchHold >= 5000 ? 1 : 0;
			}
			if (launchHold === 0) launchAnnounced = false;
			state.clutch = launchHold > 0 ? Math.max(coupling, launchQ) : coupling;
			// The tyres' chirp reads the boost: full through the drop, easing off
			// with the tail into 1st.
			state.launch = launchBoost;

			// `spin` feeds back here: spinning wheels turn faster than the road, so the
			// revs climb even though the car is not. It is a real wheel speed, so this
			// is just the gearing — a donut on the limiter is 12 m/s of spin over a
			// 4 m/s car, and the tacho says so.
			const gearRpm = rpmInGear(spec, state.gear, speedMs + state.spin);
			const slipping =
				launchHold > 0 ? launchHold : hw.idleRpm + throttle * (hw.launchRpm - hw.idleRpm);
			const target = Math.max(hw.idleRpm, gearRpm, gearRpm * coupling + slipping * (1 - coupling));
			state.rpm += (target - state.rpm) * damp(hw.rpmResponse, dt);
		}

		// ── Fuel cut: rev limiter and the top-speed governor ─────────────────
		if (state.rpm >= hw.limiterRpm) cutTimer = hw.limiterCut;
		cutTimer = Math.max(0, cutTimer - dt);
		const governed = speedMs > hw.topSpeed;
		const cut = cutTimer > 0 || governed;
		state.limiting = cut && throttle > 0;
		state.rpm = clamp(state.rpm, hw.idleRpm, hw.limiterRpm + 150);

		// ── Crank torque → wheel force ───────────────────────────────────────
		let crankTorque = 0;
		if (connected) {
			// Lugging: below `lugRpm` the engine can't make its curve.
			const lug = clamp(state.rpm / hw.lugRpm, 0.35, 1);
			// Nitrous multiplies the WOT term only — a fuel cut still cuts and engine
			// braking is untouched, exactly as if the kit had just made the curve fatter.
			// The launch boost multiplies on top of that, same rule.
			const wot =
				engineTorque(spec, state.rpm) *
				lug *
				(1 + hw.nitrousTorqueGain * input.nitrous) *
				(1 + hw.launchTorqueGain * launchBoost);
			const drag = engineBrakeTorque(spec, state.rpm);
			crankTorque = cut ? -drag : throttle * wot - (1 - throttle) * drag;
		}
		// A slipping clutch transmits less than the crank makes — without this the car
		// launched off the line at the full traction limit and ran 0-60 in 5.2 s
		// against the real GR86's 6.1. It is also what stops the car lurching when you
		// blip the throttle at walking pace.
		const clutchTorque = hw.clutchMinBite + (1 - hw.clutchMinBite) * state.clutch;
		const reduction = (total * hw.efficiency) / hw.wheelRadius;
		const requested = crankTorque * clutchTorque * reduction * Math.sign(ratio || 1);

		// ── Traction at the driven axle ──────────────────────────────────────
		// Static driven-axle load plus longitudinal transfer (m·a·h/L, and m·a is
		// just last step's force), layout-aware — cars/spec.ts. Handbrake locks
		// the rears, so they drive nothing.
		const drivenLoad = drivenAxleLoad(spec, prevDrive);
		const traction = input.handbrake ? 0 : tune.tireMuLong * drivenLoad;

		// What the tyre hands the road. Gripping, it passes the engine's request up to
		// the limit. SLIDING, it gives full μ along the way the wheels are turning and
		// the engine has no say at all — which is why a burnout keeps pulling through
		// the limiter's fuel cut instead of braking the car (see the header).
		// During a rev-match launch the driven-axle μ gains up to the spec's
		// `launchGripGain` — the plant that makes the launch HARDER with depth in
		// the window (the request at full bite is already past the tyre, so grip
		// is the cap on thrust).
		const sliding = Math.abs(state.spin) > HOOKED;
		const plant = 1 + launchBoost * hw.launchGripGain;
		const driveForce = sliding
			? Math.sign(state.spin) * traction * plant
			: clamp(requested, -traction * plant, traction * plant);

		// Everything the engine asked for beyond what the tyre took goes into WHEEL
		// SPEED. The rotating assembly resists that as an equivalent mass at the
		// contact patch, I/r², with the engine's own inertia reflected through the
		// gearing squared: ~460 kg in 1st against ~95 in 3rd. That single number is
		// why 1st lights up in a blink, 2nd builds over a couple of seconds, and 3rd
		// (which cannot out-pull the tyre anyway) never spins.
		const spinMass =
			((connected ? hw.engineInertia * total * total : 0) + hw.wheelInertia) /
			(hw.wheelRadius * hw.wheelRadius);
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
		if (tune.tractionControl) state.spin = clamp(state.spin, -hw.tcSlipSpeed, hw.tcSlipSpeed);

		prevDrive = driveForce;
		// No filter on `slip` any more: `spin` carries the real rotating inertia, which
		// is the smooth thing the old asymmetric damping was faking. It is also why
		// lifting still catches the slide — off throttle the surplus goes sharply
		// negative (engine braking pulling one way, the sliding tyre the other), so a
		// lit 1st gear hooks back up in about 0.7 s and 2nd in a quarter of that.
		state.slip = clamp(Math.abs(state.spin) / hw.fullSlipSpeed, 0, 1);
		// Friction circle: the share of the driven axle's budget the drive force is
		// using, AFTER the clip (so it saturates at 1 exactly when the tyre lets go).
		// Off throttle this is just engine braking, a tenth or so — which is the
		// point, because it is what makes lifting a real input rather than a no-op.
		const powerLoad = traction > 0 ? clamp(Math.abs(driveForce) / traction, 0, 1) : 0;

		// ── Brakes, aero, rolling resistance ─────────────────────────────────
		let resist = 0;
		if (rolling > 0.05) {
			const dir = Math.sign(speedMs);
			let magnitude = hw.dragK * speedMs * speedMs + hw.rollingResistance;
			magnitude += braking * hw.brakeForce;
			if (input.handbrake) magnitude += hw.handbrakeForce;
			// Never let a retarding force push the car backwards inside one step.
			const stopping = (rolling * hw.mass) / dt;
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
		state.launch = 0;
		launchBoost = 0;
		// Organic idle: slow sine wobble around idle rpm. The two terms
		// (1.5 Hz main + 0.4 Hz sub-harmonic) keep it from looking periodic.
		idlePhase += dt;
		const wobble = Math.sin(idlePhase * 1.5) * 40 + Math.sin(idlePhase * 0.4) * 10;
		state.rpm += (hw.idleRpm + wobble - state.rpm) * damp(hw.freeDropRate, dt);
		prevDrive = 0;
	}

	function reset(): void {
		state.gear = 1;
		state.rpm = hw.idleRpm;
		state.clutch = 1;
		state.slip = 0;
		state.spin = 0;
		state.throttle = 0;
		state.brake = 0;
		state.limiting = false;
		state.shifted = false;
		state.launched = false;
		state.launchTier = 0;
		state.launch = 0;
		shiftTimer = 0;
		cutTimer = 0;
		prevUp = false;
		prevDown = false;
		prevDrive = 0;
		idlePhase = 0;
		launchHold = 0;
		launchQ = 0;
		launchBoost = 0;
		launchAnnounced = false;
	}

	return { state, step, idle, reset };
}
