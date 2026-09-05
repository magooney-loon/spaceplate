// Two SETUPS for the same car. `gr86.ts` is the hardware — engine, gearbox, mass,
// aero, brakes — and never changes between them; this file is what a tune shop
// touches: tyre compounds, the steering rack, and how willing the rear axle is to
// let go. The scene reads one of these per physics step, so switching is instant
// and carries no state (`carHandling` in carInput.svelte.ts owns the choice).
//
// GRIP is the car as it was validated — 0-60 mph in 5.7 s, 140 mph governed,
// ~1.4 g of cornering. Every number in it is the one that used to live in
// `gr86.ts` / `TestGame.svelte`, so selecting GRIP is a no-op against the old
// behaviour: `looseBase` and `driftAlign` are zero and `powerYawBoost` is 1, which
// collapses every term below back to the original model exactly.
//
// DRIFT is NOT the real car and is not trying to be. It is an ARCADE tune — the
// car rotates roughly where you point it, the velocity vector lags behind, and an
// assist pulls the nose back so a slide is something you hold rather than
// something you survive. Four things make that work, and GRIP has none of them:
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

/** The knobs that differ between setups. Everything else is `GR86` in gr86.ts. */
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
	 * the deliberate way into a drift. Physically this is load transfer: ~0.9 g of
	 * braking moves `m·a·h/L` ≈ 2 100 N off the rear axle, roughly a third of its
	 * static load, and a rear tyre carrying a third less weight has a third less
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

export const HANDLING_TUNES = {
	grip: {
		label: 'Grip',

		tireMuLong: 1.05,
		tireMuLat: 1.1,
		latGripGain: 1.3,
		handbrakeMuLat: 0.42,
		slipGripLoss: 0.55,
		looseBase: 0,
		throttleLoose: 0,
		brakeLoose: 0,

		// 28.6°, a touch more than the real car's 24°: the demo favours tight turns.
		// Radius at full lock is 4.7 m against the real 5.4. This was 0.7 rad — 40°,
		// not the ≈29° the old comment claimed — which is a 3.0 m radius and 94°/s of
		// yaw at 18 km/h. That is where the low-speed twitchiness came from.
		maxSteerAngle: 0.5,
		steerHighSpeedFactor: 0.35,
		steerFalloffSpeed: 42,
		steerResponse: 5.5,
		yawResponse: 7,

		handbrakeYawBoost: 2.2,
		// 1 and 0 — Grip is the original kinematic model, untouched.
		powerYawBoost: 1,
		driftAlign: 0,
		maxDriftAngle: 0.75
	},
	drift: {
		label: 'Drift',

		// The rears hold ~5 550 N: 1st lights up hard, 2nd steps out, 3rd and up hook
		// back in. High enough to keep the car properly quick — 0-60 in 6.2 s, near
		// Grip's 5.7 — because `throttleLoose` below, not wheelspin, is what gets the
		// car sideways. Trying to make wheelspin the trigger meant dropping this to
		// 0.6 and paying two and a half seconds for it.
		tireMuLong: 0.8,
		tireMuLat: 1.1,
		// The SAME as Grip. A coasting car should have a coasting car's grip: with
		// `looseBase` near zero, boost ≈ 1 and the yaw cap matches what the bleed can
		// service, so Drift corners exactly like Grip until something provokes it.
		// That contrast IS the feel — running this lower just made everything vague.
		latGripGain: 1.3,
		// A third of Grip's. This is the μ a fully committed slide bleeds at — at 0.42
		// the handbrake shed 4.1 m/s² sideways and the car was straight again in a
		// tenth of a second, which is why it read as a turn-tighter button.
		handbrakeMuLat: 0.15,
		// Wheelspin nearly wipes the lateral tyre, so power deepens a slide sharply.
		slipGripLoss: 0.95,
		// Just a hint — the car is essentially planted when you are not asking for
		// anything. 4° of slip angle coasting through a corner against 46° on the
		// throttle: that ratio is the whole feel.
		looseBase: 0.1,
		// The main drift control. Full throttle spends the rear's whole grip budget, so
		// power alone takes the tail out in any gear — 46° in 2nd, ~14° in 4th — and
		// lifting drops it to engine braking's ~0.1, which is what catches the slide.
		throttleLoose: 0.55,
		// Between `throttleLoose` and the handbrake's 1: the brake is the deliberate
		// entry, so it has to be decisively looser than power, without being the full
		// flick. Braking is worth ~0.9 g of load transfer, and the brake pedal is
		// on/off from a keyboard, so this doubles as the "tap ↓ to set the car" input.
		brakeLoose: 0.8,

		// A LITTLE more lock than Grip, held a little further up the speed range — just
		// enough countersteer authority to catch a slide (Grip's rack falls to 35% by
		// motorway speed, which is fine for lane changes and useless for catching
		// anything). These were 0.62 / 0.55 / 8, and that rack was most of what read as
		// punchy: from a keyboard the only thing smoothing a binary key press is
		// `steerResponse`, and at 8/s a 0.2 s tap already had 80% of a bigger lock in.
		maxSteerAngle: 0.95,
		steerHighSpeedFactor: 0.95,
		steerFalloffSpeed: 92,
		steerResponse: 1.5,
		// A shade under Grip's 7, so the body eases into its rotation instead of
		// snapping to it. Much lower than this and the lag starts eating countersteer.
		yawResponse: 2.5,

		// Small: the handbrake already sets looseness to 1, so it collects the whole of
		// `powerYawBoost`. 1.25 × 2.6 = 3.25 is the real flick multiplier.
		handbrakeYawBoost: 1.25,
		// Was 4.5, which put the yaw cap at ~94°/s the instant you touched the wheel on
		// the throttle at 90 km/h — nearly 3× Grip, and the main source of "punchy".
		// 2.6 lands at ~39°/s against Grip's 32, i.e. 1.35× rather than 1.7×, and the
		// drift builds over ~0.5 s instead of snapping in.
		powerYawBoost: 2.6,
		driftAlign: 1.6,
		// ≈34°, down from 49°. This is the knob for "slidy": it is the angle the boost
		// has fully faded at, so it sets where the drift settles. Steady state now
		// lands ~32° on the throttle in 2nd, ~43° off the brake, ~54° in a donut, and
		// only ~2° coasting. The handbrake held at full lock still spins the car out to
		// fully sideways, which is what that input should do.
		maxDriftAngle: 0.9
	}
} as const satisfies Record<string, HandlingTune>;

export type HandlingMode = keyof typeof HANDLING_TUNES;

export const HANDLING_MODES = Object.keys(HANDLING_TUNES) as HandlingMode[];

/** Lateral μ the cornering model runs on — the yaw cap and the sideways bleed share it. */
export const latMu = (tune: HandlingTune): number => tune.tireMuLat * tune.latGripGain;
