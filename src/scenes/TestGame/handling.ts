// Two SETUPS for the same car. `gr86.ts` is the hardware — engine, gearbox, mass,
// aero, brakes — and never changes between them; this file is what a tune shop
// touches: tyre compounds, the steering rack, and how willing the rear axle is to
// let go. The scene reads one of these per physics step, so switching is instant
// and carries no state (`carHandling` in carInput.svelte.ts owns the choice).
//
// GRIP is the car as it was validated — 0-60 mph in 5.7 s, 140 mph governed,
// ~1.4 g of cornering. Every number in it is the one that used to live in
// `gr86.ts` / `TestGame.svelte`, so selecting GRIP is a no-op against the old
// behaviour, including the two oversteer terms below, which are zero.
//
// DRIFT is NOT the real car and does not pretend to be. Three things have to be
// true for a rear-drive car to slide, and GRIP had none of them:
//
//   1. A rear axle that runs out of grip in more than 1st gear. At `tireMuLong`
//      1.05 the rears hold ~6 250 N; 2nd gear only ever asks ~6 300 N, so `slip`
//      never left zero above about 30 km/h.
//   2. Lateral grip that actually LEAVES when the rears spin. `slipGripLoss` was
//      0.55, so full wheelspin still kept 45% of the tyre — μ never fell below
//      0.88, which is more grip than most road cars have at their best.
//   3. Yaw that is not a pure function of the steering angle. GRIP's yaw target is
//      `v·tan δ / L` clamped to `μ·g / v`: the car can only ever rotate as fast as
//      the front wheels point, and centring the wheel stops the rotation dead.
//      A slide is rotation the steering did NOT ask for, held against something
//      that wants to end it. Those are `oversteerYaw` (the power/handbrake moment
//      that takes the tail out) and `driftAlign` (the rear tyres pulling the nose
//      back toward where the car is actually going). They balance at roughly
//      `maxDriftAngle`, and the throttle is what moves the balance — which is why
//      DRIFT is modulated on ↑ and caught on the arrows, like the real thing.
//
// The cost of #1 is real and deliberate: DRIFT is traction-limited to ~3 600 N off
// the line, so 0-60 goes from 5.7 s to about 10. A drift tune trades the drag strip
// away; that is the trade, not a bug.

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
	 * service means the car slides a little in every corner.
	 */
	latGripGain: number;
	/** Lateral grip with the rears locked — the drift end of the same bleed. */
	handbrakeMuLat: number;
	/** How much of the lateral tyre full wheelspin costs, 0…1. Applied in drivetrain.ts. */
	slipGripLoss: number;

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
	 * at exactly the speeds anyone yanks a handbrake.
	 */
	handbrakeYawBoost: number;
	/**
	 * rad/s — peak rotation a fully loose rear axle adds ON TOP of what the front
	 * wheels point at, scaled by wheelspin (or 1 on the handbrake) and faded out as
	 * the slide reaches `maxDriftAngle`. 0 = no oversteer term at all, i.e. yaw is a
	 * pure function of the steering angle and a slide cannot exist.
	 */
	oversteerYaw: number;
	/**
	 * 1/s — how hard the rear tyres pull the nose back toward the direction of
	 * travel, per radian of slip angle. This is what ends a slide when you lift, and
	 * what opposite lock is fighting. Too low and every slide is a spin; too high and
	 * the car snaps straight before you can hold it.
	 */
	driftAlign: number;
	/**
	 * rad — the slip angle the two terms above balance at under steady throttle.
	 * `oversteerYaw` fades linearly to zero across it, so past this angle only the
	 * aligning moment is left and the car recovers instead of spinning.
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
		// Zero on purpose — GRIP is the kinematic model, unchanged.
		oversteerYaw: 0,
		driftAlign: 0,
		maxDriftAngle: 0.75
	},
	drift: {
		label: 'Drift',

		// The rear axle now holds ~3 600 N: 1st and 2nd light it up at full throttle,
		// 3rd is marginal, 4th and up can't reach it. That IS the drift window — you
		// pick the gear that puts the slide where you want it.
		tireMuLong: 0.55,
		tireMuLat: 1.1,
		// Slightly less than GRIP's 1.3: the yaw CAP runs on this (the fronts are never
		// the axle that lets go), and too much of it just drags the nose back in line.
		latGripGain: 1.25,
		// Half of GRIP's. This is the μ a fully committed slide bleeds at — at 0.42 the
		// handbrake shed 4.1 m/s² sideways and the car was straight again in a tenth of
		// a second, which is why it read as a turn-tighter button.
		handbrakeMuLat: 0.22,
		// Wheelspin nearly wipes the lateral tyre, so power alone steps the tail out.
		slipGripLoss: 0.95,

		// More lock, held further up the speed range, moved faster: all three are
		// countersteer authority. GRIP's rack falls to 35% by motorway speed, which is
		// fine for lane changes and useless for catching a slide.
		maxSteerAngle: 0.62,
		steerHighSpeedFactor: 0.62,
		steerFalloffSpeed: 42,
		steerResponse: 8,
		// A little more yaw inertia than GRIP, so the car keeps rotating for a moment
		// after the input stops — without it the slide is still a function of the key.
		yawResponse: 6.5,

		// Lower than GRIP's: the flick no longer has to do the whole job on its own,
		// `oversteerYaw` is under it.
		handbrakeYawBoost: 1.8,
		oversteerYaw: 1.6,
		driftAlign: 2.4,
		// ≈43°. Full throttle in 2nd settles around 28°; the rest is headroom for a
		// deliberate flick before the aligning moment wins.
		maxDriftAngle: 0.75
	}
} as const satisfies Record<string, HandlingTune>;

export type HandlingMode = keyof typeof HANDLING_TUNES;

export const HANDLING_MODES = Object.keys(HANDLING_TUNES) as HandlingMode[];

/** Lateral μ the cornering model runs on — the yaw cap and the sideways bleed share it. */
export const latMu = (tune: HandlingTune): number => tune.tireMuLat * tune.latGripGain;
