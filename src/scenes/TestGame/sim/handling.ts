// The handling CONTRACT + the cornering model's rules. The TUNE itself is
// per-car data (the GR86's lives in cars/gr86.ts) — one tune per car, the
// grip/drift switch is gone: a car ships with the setup it ships with. See
// CLAUDE.md's "One tune per car" section for what the knobs mean and the
// stability rule (NOTHING here may depend on the SIGN of the slip angle
// except `driftAlign`).

/** The handling knobs. Everything else is the car's hardware (its spec's
 *  `hardware` block). */
export interface HandlingTune {
	// ── Tyres ────────────────────────────────────────────────────────────────
	/** Longitudinal grip coefficient — what the rear axle can put down before it spins. */
	tireMuLong: number;
	/** Longitudinal μ once the tyre is SLIDING and the car is CORNERING — the
	 *  ARCADE GREASE. Real physics runs kinetic below the static cap; drift
	 *  games run it at or above, so a lit rear keeps its push and drifts carry
	 *  speed instead of bogging. Blended in by the drivetrain across the input's
	 *  `cornering` (0 = straight → the plain `tireMuLong`, so the BURNOUT GATE
	 *  still works — a standstill wheel only keeps spinning while the engine
	 *  asks for more than the tyre takes; 1 = full drift → this). Equal to
	 *  `tireMuLong` = the plain physical model. */
	slideMuLong: number;
	/** Lateral grip coefficient. The real GR86 is 1.1. */
	tireMuLat: number;
	/**
	 * Multiplier the CORNERING model runs at over `tireMuLat`. **The knob for
	 * "the car won't turn at speed"**; 1 is the real car. Feeds BOTH the yaw
	 * cap and the sideways bleed, which must agree — see CLAUDE.md.
	 */
	latGripGain: number;
	/** Lateral grip with the rears locked — the drift end of the same bleed. */
	handbrakeMuLat: number;
	/** How much of the lateral tyre full wheelspin costs, 0…1. Applied in drivetrain.ts. */
	slipGripLoss: number;
	/**
	 * Permanent looseness, 0…1 — the floor under everything else, and a flat
	 * cut to lateral grip in drivetrain.ts. Keep it SMALL: looseness should
	 * be EARNED by an input, not baked into the tyre (see CLAUDE.md).
	 */
	looseBase: number;
	/**
	 * Looseness at full drive load, 0…1 — the FRICTION CIRCLE, scaled by the
	 * drivetrain's `powerLoad`. What makes the throttle the drift control in
	 * EVERY gear, not just the ones that can spin the rears.
	 */
	throttleLoose: number;
	/**
	 * Looseness the BRAKE is worth at full pedal, 0…1 — trail-braking
	 * oversteer via load transfer off the rear axle. Safe under the
	 * stability rule: it only ever multiplies the steering's authority.
	 */
	brakeLoose: number;

	// ── Steering ─────────────────────────────────────────────────────────────
	/** rad — full lock at the front wheels. Turn radius at lock is `wheelbase / tan δ`. */
	maxSteerAngle: number;
	/** Fraction of lock still available at `steerFalloffSpeed` — slow hands at speed. */
	steerHighSpeedFactor: number;
	/** m/s at which the falloff above has fully taken effect — must span the
	 *  speeds the car is actually driven at, or it's a no-op. */
	steerFalloffSpeed: number;
	/** 1/s — how fast the steering rack follows the key. */
	steerResponse: number;
	/** 1/s — how fast the body's yaw rate chases its target. Lower = more inertia. */
	yawResponse: number;

	// ── Oversteer ────────────────────────────────────────────────────────────
	/**
	 * The flick. A locked rear axle lets the car rotate faster than the tyres
	 * can hold, so this scales the yaw DEMAND as well as the cap. Multiplies
	 * with `powerYawBoost`, so its value is a top-up on the flick, not the
	 * whole of it.
	 */
	handbrakeYawBoost: number;
	/**
	 * Yaw AUTHORITY multiplier at full looseness — scales what the steering
	 * may ask for (demand and cap alike), fading back to 1 as slip angle
	 * reaches `maxDriftAngle`. Never a term added to the yaw target (stability rule).
	 */
	powerYawBoost: number;
	/**
	 * 1/s — how hard the rear tyres pull the nose back toward the direction
	 * of travel, per radian of slip angle, AT FULL REAR GRIP. Scaled by
	 * `1 - loose` at the call site, since a spinning tyre aligns nothing.
	 * The auto-catch: what ends a slide on lift, what opposite lock is
	 * helping, what keeps a straight line straight.
	 */
	driftAlign: number;
	/**
	 * 1/s — the auto-catch WHILE the handbrake is held. `driftAlign` is scaled
	 * by `1 - loose` and the handbrake is loose 1, so without this nothing pulls
	 * the nose back and a handbrake stop swaps ends and skates. Steering still
	 * wins a held handbrake turn; a tap-and-hold stop comes to rest near straight.
	 */
	handbrakeAlign: number;
	/**
	 * rad — the slip angle `powerYawBoost` has fully faded out at, so past
	 * it only the aligning moment is left and the car recovers instead of
	 * spinning. The steady-state drift angle lands a little under this.
	 */
	maxDriftAngle: number;

	// ── Understeer ───────────────────────────────────────────────────────────
	/**
	 * 0…1 — how much a DRIVEN FRONT axle's own power load pulls the yaw CAP
	 * down, never the demand: `powerYawBoost`'s push-wide opposite. A driven
	 * front tyre spends its budget twice over (steering AND propulsion), so
	 * under power it has less lateral grip to turn with — the car's heading
	 * rotates slower than the wheel angle asks and the nose runs wide, which
	 * is understeer without any new term touching the SIGN of the slip angle
	 * (the stability rule above still holds: this multiplies a cap, same as
	 * `powerYawBoost` does, it just multiplies it down instead of up). Reads
	 * `drivenAxles(spec)` at the call site, so it is a no-op on a spec whose
	 * front isn't driven — 0 on the RWD tune, where it would never apply
	 * anyway, kept explicit rather than assumed.
	 */
	powerPush: number;
}

/** Lateral μ the cornering model runs on — the yaw cap and the sideways bleed share it. */
export const latMu = (tune: HandlingTune): number => tune.tireMuLat * tune.latGripGain;
