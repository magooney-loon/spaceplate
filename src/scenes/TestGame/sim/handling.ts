// The handling CONTRACT + the cornering model's rules. The TUNES themselves
// are per-car data — the GR86's live in cars/gr86.ts (`tunes`), moved here from
// this file when the scene went multi-car. What a tune shop touches: tyre
// compounds, the steering rack, and how willing the rear axle is to let go.
// The controller reads the current car's tune per physics step, so switching
// is instant and carries no state (`carHandling` in carInput.svelte.ts owns
// the choice).
//
// GRIP is the car, tuned FRIENDLY rather than strictly real: 0-60 mph in 5.7 s,
// 140 mph governed (both are the drivetrain's, unaffected by this file), ~1.8 g of
// cornering — more than the real GR86's 1.1 g, because a tighter, more forgiving
// turn-in reads as fun on a keyboard where a real car's understeer margin just
// reads as "it won't turn". `looseBase` and `driftAlign` are still zero and
// `powerYawBoost` is still 1, so GRIP stays the pure kinematic base model with no
// drift terms added on top — only its own steering/grip numbers were loosened up.
//
// DRIFT is NOT the real car and is not trying to be. It is an ARCADE tune — the
// car rotates roughly where you point it, the velocity vector lags behind, and an
// assist pulls the nose back so a slide is something you hold rather than
// something you survive. Five things make that work, and GRIP has none of them:
//
//   0. No TRACTION CONTROL (`tractionControl`). Grip runs the real car's; Drift
//      switches it off, so surplus torque spins the rears for real instead of being
//      trimmed away — the revs follow the WHEELS, not the car, and a donut sits on
//      the limiter. Everything below that mentions wheelspin depends on this.
//
//   1. A rear axle that runs out of grip in more than 1st gear (`tireMuLong`). At
//      1.05 the rears hold ~6 250 N and 2nd gear only ever asks ~6 300 N, so
//      `slip` never left zero above about 30 km/h.
//   2. Lateral grip that actually LEAVES (`slipGripLoss`, `looseBase`,
//      `brakeLoose`). At 0.55, full wheelspin still kept 45% of the tyre — μ never
//      fell below 0.88, more grip than most road cars have at their best. And
//      requiring wheelspin at all makes getting sideways a throttle-precision
//      exercise, which is the opposite of arcade: `looseBase` is a permanent
//      looseness Drift carries everywhere, and `brakeLoose` is the deliberate
//      ENTRY — brake into the corner to set the car, throttle to hold the angle.
//   3. More yaw AUTHORITY when the rear is loose (`powerYawBoost`) — not more yaw.
//      GRIP's yaw target is `v·tan δ / L` clamped to `μ·g / v`, and the boost
//      scales what the steering may ask for, both terms. It cannot rotate the car
//      on its own, which is the entire stability argument (see below).
//   4. Something that ENDS a slide (`driftAlign`) — the rear tyres pulling the nose
//      back toward the direction of travel, per radian of slip angle. This is the
//      auto-catch, and it is also what makes a straight line self-correcting.
//
// #3 and #4 balance at a held slip angle, faded in by `maxDriftAngle`, so the drift
// settles instead of spinning: ~25° on the throttle, ~35° off a handbrake flick.
//
// ── The stability rule, learned the hard way ────────────────────────────────────
// NOTHING here may depend on the SIGN of the slip angle except `driftAlign`.
// An earlier version added an oversteer moment pointed along `sign(beta)`, scaled
// by wheelspin. Its gradient at beta → 0 was ~12 rad/s per rad against
// `driftAlign`'s 2.4, so every bump's slip angle fed back into five times more
// rotation than the aligning term could remove — beta = 0 was a DIVERGENT
// equilibrium and the car could not be driven in a straight line. Yaw authority is
// safe because it multiplies the steering: no steering, no yaw, straight is straight.
//
// The cost of #1 is real and deliberate: Drift is traction-limited to ~5 550 N off
// the line, so 0-60 goes from 5.7 s to about 7.5. A drift tune gives some of the
// drag strip away; that is the trade, not a bug.

/** The knobs that differ between setups. Everything else is the car's hardware
 *  (its spec's `hardware` block). */
export interface HandlingTune {
	/** Shown on the HUD switch and the cluster badge. */
	label: string;

	// ── Tyres ────────────────────────────────────────────────────────────────
	/** Longitudinal grip coefficient — what the rear axle can put down before it spins. */
	tireMuLong: number;
	/** Lateral grip coefficient. The real GR86 is 1.1. */
	tireMuLat: number;
	/**
	 * Multiplier the CORNERING model runs at over `tireMuLat`. The real 1.1 g needs
	 * 148 m of road to turn at 40 m/s, and this is a tight city driven on a keyboard,
	 * so the demo buys some back. **This is the knob for "the car won't turn at
	 * speed"**; 1 is the real car. It feeds BOTH the yaw cap and the sideways bleed,
	 * which have to agree — a cap asking for more cornering than the bleed can
	 * service means the car slides a little in every corner. (Which is exactly what
	 * Drift wants, and why its value is the LOWER of the two.)
	 */
	latGripGain: number;
	/** Lateral grip with the rears locked — the drift end of the same bleed. */
	handbrakeMuLat: number;
	/** How much of the lateral tyre full wheelspin costs, 0…1. Applied in drivetrain.ts. */
	slipGripLoss: number;
	/**
	 * TRACTION CONTROL — whether the ECU catches the rears when they run away. The
	 * real GR86 has it and GRIP runs it; DRIFT switches it OFF, and that is what the
	 * button on the real car's dash does too.
	 *
	 * It does NOT change how much force the tyre can put down — that is `tireMuLong`
	 * and it is the same limit either way, so switching this costs nothing off the
	 * line. What it changes is where the SURPLUS goes. With TC on, the ECU trims it
	 * away and the rears never run more than a couple of m/s past the road; with it
	 * off the surplus spins the wheels for real, the revs follow the wheels rather
	 * than the car, and the limiter is the only thing that stops them.
	 *
	 * That is the difference between a donut sitting at ~2 900 rpm with the throttle
	 * pinned and one screaming on the limiter with the rears fully lit — and it is
	 * also what makes `slipGripLoss` (0.95 here) reachable at all, since it needs
	 * wheelspin the TC would otherwise never allow.
	 */
	tractionControl: boolean;
	/**
	 * Permanent looseness, 0…1 — the floor under everything else, and a flat cut to
	 * lateral grip in drivetrain.ts. Keep it SMALL. At 0.6 the car ran 32° of slip
	 * angle just coasting through a gentle corner: permanently sideways, no contrast
	 * between planted and provoked, which reads as floaty rather than fun. Looseness
	 * should be EARNED by an input — that is what the three knobs below are for.
	 */
	looseBase: number;
	/**
	 * Looseness at full drive load, 0…1 — the FRICTION CIRCLE, scaled by the
	 * drivetrain's `powerLoad` (how much of the rear's grip budget the drive force is
	 * spending). A tyre has one friction budget: grip spent pushing the car along is
	 * not available to hold it sideways, and that is true well before the tyre
	 * actually spins.
	 *
	 * This is what makes the throttle the drift control in EVERY gear. Keying the
	 * slide off wheelspin alone meant only 1st and 2nd could break traction, so
	 * getting sideways in 4th was impossible without the handbrake — and dropping
	 * `tireMuLong` far enough to fix that cost two seconds off 0-60. This costs
	 * nothing: the car keeps its acceleration and gains a throttle that steers.
	 */
	throttleLoose: number;
	/**
	 * Looseness the BRAKE is worth at full pedal, 0…1 — trail-braking oversteer, and
	 * the deliberate way into a drift. Physically this is load transfer: the
	 * big-brake kit's ~1.23 g moves `m·a·h/L` ≈ 2 800 N off the rear axle, nearly
	 * half its static load, and a rear tyre carrying half the weight has half the
	 * lateral grip to give. Brake into the corner to set the car, then throttle to
	 * hold the angle — the two ends of the same slide.
	 *
	 * Safe under the stability rule for the same reason `looseBase` is: it feeds
	 * LOOSENESS, which only ever multiplies the steering's authority. Standing on the
	 * brakes in a straight line still asks for no yaw and so produces none.
	 */
	brakeLoose: number;

	// ── Steering ─────────────────────────────────────────────────────────────
	/** rad — full lock at the front wheels. Turn radius at lock is `wheelbase / tan δ`. */
	maxSteerAngle: number;
	/** Fraction of lock still available at `steerFalloffSpeed` — slow hands at speed. */
	steerHighSpeedFactor: number;
	/**
	 * m/s at which the falloff above has fully taken effect. Has to span the speeds
	 * the car is actually driven at: this was 1.8 m/s (6.5 km/h) once, so the rack
	 * was already clipped to its high-speed fraction at walking pace and the falloff
	 * did nothing whatsoever from there to 140 mph.
	 */
	steerFalloffSpeed: number;
	/** 1/s — how fast the steering rack follows the key. */
	steerResponse: number;
	/** 1/s — how fast the body's yaw rate chases its target. Lower = more inertia. */
	yawResponse: number;

	// ── Oversteer ────────────────────────────────────────────────────────────
	/**
	 * The flick. A locked rear axle lets the car rotate faster than the tyres can
	 * hold, so this scales the yaw DEMAND as well as the cap — boosting the cap alone
	 * did nothing below ~25 km/h, where the geometric term is the binding one, i.e.
	 * at exactly the speeds anyone yanks a handbrake. Multiplies with
	 * `powerYawBoost`, which the handbrake already gets in full (it sets looseness
	 * to 1), so Drift's value is small — it is a top-up, not the whole flick.
	 */
	handbrakeYawBoost: number;
	/**
	 * Yaw AUTHORITY multiplier at full looseness — it scales what the steering may
	 * ask for (demand and cap alike), and is faded back to 1 as the slip angle
	 * reaches `maxDriftAngle`. 1 = no boost at all, i.e. yaw is exactly the Grip
	 * model. Never a term added to the yaw target: see the stability rule above.
	 */
	powerYawBoost: number;
	/**
	 * 1/s — how hard the rear tyres pull the nose back toward the direction of
	 * travel, per radian of slip angle, AT FULL REAR GRIP. The scene scales it by
	 * `1 - loose`, because a spinning tyre aligns nothing: the aligning moment has to
	 * fade exactly as the rear lets go, or the harder you loosen the rear the harder
	 * the car fights you. (As a constant it made donuts impossible — full lock and
	 * full throttle at walking pace gave a 130 m circle.)
	 *
	 * The auto-catch: what ends a slide when you lift, what opposite lock is helping,
	 * and what keeps a straight line straight. Too low and every slide is a spin; too
	 * high and the car snaps straight before you can hold it. Because of the scaling
	 * this wants to be considerably larger than it looks — at Drift's `looseBase` of
	 * 0.6 only 40% of it is ever applied off the throttle.
	 */
	driftAlign: number;
	/**
	 * rad — the slip angle `powerYawBoost` has fully faded out at, so past it only
	 * the aligning moment is left and the car recovers instead of spinning. The
	 * steady-state drift angle lands a little under this.
	 */
	maxDriftAngle: number;
}

/** The setups a car carries. The GR86 ships Grip/Drift; the union is explicit
 *  (it used to be `keyof typeof HANDLING_TUNES`) because tunes now live in the
 *  spec. */
export type HandlingMode = 'grip' | 'drift';

export const HANDLING_MODES: readonly HandlingMode[] = ['grip', 'drift'];

/** Lateral μ the cornering model runs on — the yaw cap and the sideways bleed share it. */
export const latMu = (tune: HandlingTune): number => tune.tireMuLat * tune.latGripGain;
