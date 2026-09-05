// 2023 Toyota GR86 — the real car's numbers, in SI units (metres, kilograms,
// newtons, seconds, rad). Nothing in this file knows about world units.
//
// WHY SI: the driving model needs a torque curve, gear ratios and aero drag to
// feel like a car, and those only compose if they share one unit system. The
// scene converts at the boundary — see UNITS_PER_METER below.

/**
 * World units per real metre in TestGame.
 *
 * The GLB is authored in metres (the chassis collider args — half-extents
 * 0.95 × 0.55 × 2.1 — are a GR86 to the centimetre), and the scene scales the
 * car ×2.5 to sit right in the city. So the city is built at 2.5 units/metre,
 * and everything the player *perceives* — speed, acceleration, gravity — is
 * the world value divided by this.
 *
 * Consequences, all handled at the call site in TestGame.svelte:
 * - force:    N_world = N_si * UNITS_PER_METER  (a_world = a_si * UPM, mass is unchanged)
 * - velocity: v_world = v_si * UNITS_PER_METER
 * - angular:  unchanged — rad/s is scale-free, which is why steering is a yaw RATE
 * - gravity:  the shared <World> runs at 9.8 units/s², i.e. 3.9 m/s² here, so the
 *             car's RigidBody carries gravityScale={UNITS_PER_METER} to feel 1 g.
 *             (Scene-local — the global gravity belongs to every other scene too.)
 *
 * If the city model ever gets rescaled, this and the ×2.5 on the visual group
 * move together.
 */
export const UNITS_PER_METER = 2.5;

export const G = 9.81;

export const GR86 = {
	// ── Mass & geometry ──────────────────────────────────────────────────────
	/** kg — 2,875 lb with a driver aboard. */
	mass: 1290,
	/** m — front axle to rear axle. Sets the geometric steering radius. */
	wheelbase: 2.575,
	/** m — centre of gravity height. Drives longitudinal load transfer. */
	cogHeight: 0.46,
	/** Fraction of static weight on the driven (rear) axle — the GR86 is 53/47. */
	rearWeightBias: 0.47,
	/** m — 215/40R18: 18" rim (0.2286) + 40% of 215 mm sidewall. */
	wheelRadius: 0.315,

	// ── Engine (FA24, 2.4 l naturally aspirated) ─────────────────────────────
	idleRpm: 800,
	/** Fuel cut. Redline on the dial is 7500; the ECU cuts just under it. */
	limiterRpm: 7400,
	/** Where the tacho's red zone starts — display only. */
	redlineRpm: 7000,
	/** Top of the HUD dial. */
	maxRpm: 8000,
	/** s — how long each fuel cut lasts, so the limiter bounces instead of flatlining. */
	limiterCut: 0.05,
	/** rpm the engine hangs at on a clutch-slipped launch at full throttle. */
	launchRpm: 3200,
	/** m/s at which the clutch is fully home in 1st — below this it slips. */
	launchSpeed: 4.5,
	/** Fraction of crank torque a fully slipping clutch still passes to the wheels. */
	clutchMinBite: 0.45,
	/** 1/s — how fast rpm chases its target when the clutch is engaged. */
	rpmResponse: 22,
	/** 1/s — free-revving (neutral or mid-shift): spin-up, then trailing-off. */
	freeRevRate: 7,
	freeDropRate: 5,
	/** Nm of engine braking = base + perRpm × rpm. ≈50 Nm at redline. */
	engineBrakeBase: 12,
	engineBrakePerRpm: 0.0055,
	/** Below this the engine lugs and gives back less than the curve says. */
	lugRpm: 1400,

	// ── Transmission (6-speed manual + 4.10 final) ───────────────────────────
	/** 1st … 6th. Gear -1 is reverse, 0 is neutral — see `gearRatio`. */
	gearRatios: [3.626, 2.188, 1.541, 1.213, 1.0, 0.767],
	reverseRatio: 3.437,
	finalDrive: 4.1,
	/** Driveline efficiency, crank torque → wheel torque. */
	efficiency: 0.9,
	/** s — clutch-out time per shift. Torque is cut for the whole window. */
	shiftTime: 0.28,

	// ── Brakes ───────────────────────────────────────────────────────────────
	// Tyre μ and the whole steering rack are NOT here — they are the setup, not the
	// car, and they differ between the Grip and Drift tunes. See handling.ts.
	/** N — all four discs at full pedal, ≈0.9 g → 100-0 km/h in ~2.9 s. */
	brakeForce: 11400,
	/** N — the handbrake's own (rear-only) retardation. */
	handbrakeForce: 4200,

	// ── Aerodynamics & losses ────────────────────────────────────────────────
	/** N per (m/s)² — ½·ρ·Cd·A with Cd 0.28, A 2.02 m². */
	dragK: 0.3465,
	/** N — rolling resistance, ≈0.013·m·g. */
	rollingResistance: 165,
	/** m/s — 140 mph. The real car is electronically limited here, and so is this one. */
	topSpeed: 62.6
} as const;

/** Signed ratio for a gear index: -1 reverse, 0 neutral, 1…6 forward. */
export function gearRatio(gear: number): number {
	if (gear === 0) return 0;
	if (gear < 0) return -GR86.reverseRatio;
	return GR86.gearRatios[gear - 1] ?? 0;
}

export const TOP_GEAR = GR86.gearRatios.length;

/** Total reduction from crank to wheel, always positive. */
export function totalRatio(gear: number): number {
	return Math.abs(gearRatio(gear)) * GR86.finalDrive;
}

const RPM_PER_RAD_S = 60 / (2 * Math.PI);

/** Engine rpm the given gear imposes at this road speed (m/s). 0 in neutral. */
export function rpmInGear(gear: number, speedMs: number): number {
	const ratio = totalRatio(gear);
	if (ratio === 0) return 0;
	return (Math.abs(speedMs) / GR86.wheelRadius) * RPM_PER_RAD_S * ratio;
}

// FA24 wide-open-throttle curve. Peak 249 Nm (184 lb-ft) at 3700, and 232 Nm at
// 7000 — which is exactly the 228 hp claim (170 kW / 733 rad/s). Flat on purpose:
// this engine's character is that it pulls the same everywhere and then dies at
// the limiter, which is what makes the shift points matter.
const TORQUE_CURVE: readonly (readonly [number, number])[] = [
	[0, 120],
	[800, 140],
	[1200, 182],
	[1800, 212],
	[2400, 231],
	[3000, 241],
	[3700, 249],
	[4500, 244],
	[5200, 240],
	[6000, 236],
	[6600, 234],
	[7000, 232],
	[7400, 214],
	[7800, 150]
];

/** Wide-open-throttle crank torque (Nm) at `rpm`, linearly interpolated. */
export function engineTorque(rpm: number): number {
	const last = TORQUE_CURVE.length - 1;
	if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
	if (rpm >= TORQUE_CURVE[last][0]) return TORQUE_CURVE[last][1];
	for (let i = 1; i <= last; i++) {
		const [r1, t1] = TORQUE_CURVE[i];
		if (rpm > r1) continue;
		const [r0, t0] = TORQUE_CURVE[i - 1];
		return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
	}
	return TORQUE_CURVE[last][1];
}

/** Closed-throttle drag from the engine itself (Nm, positive = retarding). */
export function engineBrakeTorque(rpm: number): number {
	return GR86.engineBrakeBase + GR86.engineBrakePerRpm * rpm;
}
