// Sun and moon positions. Fixed arc -- predictable, gamey, trivially
// authorable. A real solar model (latitude + day-of-year) can arrive later as an
// alternative module, because everything downstream reads only the derived direction.

import { smooth01, wrap01 } from './math';
import type { CelestialBody, MoonPhase, MoonPhaseName, Vec3 } from './types';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Peak elevation of the arc at local noon.
 *
 * This is not just a look knob: the day curve's keyframe times are the inverse of the
 * arc (dayCurve.ts), so changing the peak moves every twilight boundary. One constant,
 * imported everywhere, rather than a `?? 75` repeated in four places.
 */
export const DEFAULT_MAX_ELEVATION = 75;

/**
 * Days one full new -> full -> new cycle takes. The real synodic month is 29.53, and
 * this is deliberately not it: the arc above is already a gamey fixed one, and at the
 * dev clock's 60x a realistic month is twelve hours of play to see a single phase
 * change. Eight advances the phase by an eighth every night -- visibly a different moon
 * from one night to the next, which is the entire point of the cycle existing.
 *
 * `setPathOptions({ synodicDays: 29.53 })` buys the real thing, and `0` freezes the
 * moon at whatever `moonLag` says (the pre-cycle behaviour, a permanent full moon).
 */
export const DEFAULT_SYNODIC_DAYS = 8;

export type PathOptions = {
	/** Peak elevation in degrees at local noon. */
	maxElevation?: number;
	/**
	 * Moon offset in normalized days AT DAY ZERO. 0.5 = opposition = full moon. The
	 * cycle below carries it forward from here; this is the seed, not a constant.
	 */
	moonLag?: number;
	/** Length of the synodic cycle in days. 0 pins the moon at `moonLag` forever. */
	synodicDays?: number;
};

/**
 * The moon's lag behind the sun at a given moment, in normalized days.
 *
 * ONE number carries both the phase and the moonrise time, because in this model they
 * are the same fact: the moon walks the sun's own arc, so a lag of 0.5 puts it opposite
 * the sun -- fully lit AND rising at sunset -- while a lag of 0 puts it on the sun,
 * unlit and up only by day. Nothing has to be kept in sync because there is nothing to
 * sync.
 *
 * It INCREASES with time, which is the direction the real moon goes: it rises later each
 * night, waxing from new through first quarter to full.
 */
export const moonLagAt = (t: number, day: number, options: PathOptions = {}): number => {
	const cycle = options.synodicDays ?? DEFAULT_SYNODIC_DAYS;
	const seed = options.moonLag ?? 0.5;
	return cycle > 0 ? wrap01(seed + (day + t) / cycle) : wrap01(seed);
};

// Ordered from new. Read with a half-bucket offset below, so `new`, `firstQuarter`,
// `full` and `lastQuarter` are CENTRED on their exact ages rather than starting there.
const PHASE_NAMES: MoonPhaseName[] = [
	'new',
	'waxingCrescent',
	'firstQuarter',
	'waxingGibbous',
	'full',
	'waningGibbous',
	'lastQuarter',
	'waningCrescent'
];

export const createMoonPhase = (): MoonPhase => ({
	age: 0.5,
	illumination: 1,
	waxing: false,
	name: 'full'
});

/**
 * Phase from a lag. Writes into `out` -- this runs every frame like everything else in
 * here. The lit fraction is the standard half-cosine, which is exactly what the disc's
 * own shading integrates to, so the light model and the picture cannot disagree.
 */
export const moonPhaseAt = (lag: number, out: MoonPhase = createMoonPhase()): MoonPhase => {
	const age = wrap01(lag);
	out.age = age;
	out.illumination = (1 - Math.cos(TAU * age)) / 2;
	out.waxing = age < 0.5;
	out.name = PHASE_NAMES[Math.floor(wrap01(age + 1 / 16) * 8) % 8];
	return out;
};

/**
 * The arc, in closed form.
 *
 *   elevation(t) = maxElevation * sin(2pi * (t - 0.25))
 *   azimuth(t)   = 360 * t
 *
 * At t=0.25 elevation is 0 and azimuth 90 (sunrise, east); t=0.5 gives peak elevation
 * due south; t=0.75 returns to the horizon in the west; t=0 is the anti-peak due
 * north. Sunrise and sunset therefore land on fixed normalized times by construction.
 */
export const elevationAt = (t: number, maxElevation: number): number =>
	maxElevation * Math.sin(TAU * (t - 0.25));

export const azimuthAt = (t: number): number => (360 * t) % 360;

/**
 * Spherical -> cartesian, Y up. Mirrors what SkyMesh expects for `sunPosition`.
 *
 * Exported because the key light needs to rebuild a direction from a *modified*
 * elevation (sky.svelte.ts clamps it above the horizon), not just read a body's own.
 * Writes into `out`; this runs every frame.
 */
export const directionAt = (elevationDeg: number, azimuthDeg: number, out: Vec3): Vec3 => {
	const phi = (90 - elevationDeg) * DEG;
	const theta = azimuthDeg * DEG;
	const sinPhi = Math.sin(phi);
	out.x = sinPhi * Math.sin(theta);
	out.y = Math.cos(phi);
	out.z = sinPhi * Math.cos(theta);
	return out;
};

export const createBody = (): CelestialBody => ({
	direction: { x: 0, y: 1, z: 0 },
	elevation: 0,
	azimuth: 0,
	visibility: 0
});

const bodyAt = (t: number, maxElevation: number, out: CelestialBody): CelestialBody => {
	const elevation = elevationAt(t, maxElevation);
	out.elevation = elevation;
	out.azimuth = azimuthAt(t);
	directionAt(elevation, out.azimuth, out.direction);
	// Ramped across the horizon rather than stepped: a hard 0/1 at elevation 0 is a
	// per-frame discontinuity that every consumer inherits -- a moon disc would pop on,
	// a gameplay check would chatter on the boundary. Cloud occlusion multiplies into
	// this once the weather mixer exists.
	out.visibility = smooth01(-2, 2, elevation);
	return out;
};

/** `out` is optional so one-off callers (Studio readouts) stay ergonomic. */
export const sunAt = (
	t: number,
	options: PathOptions = {},
	out: CelestialBody = createBody()
): CelestialBody => bodyAt(t, options.maxElevation ?? DEFAULT_MAX_ELEVATION, out);

/**
 * The moon walks the sun's arc, a `moonLagAt` behind it.
 *
 * Takes `day` as well as `t` because the lag is no longer a constant: it advances one
 * synodic cycle per `synodicDays`, which is what makes the phase cycle. The disc's
 * terminator falls out of the resulting sun-moon angle in `Moon.svelte` with no extra
 * plumbing -- there is no phase parameter anywhere in the shader.
 */
export const moonAt = (
	t: number,
	day: number,
	options: PathOptions = {},
	out: CelestialBody = createBody()
): CelestialBody =>
	bodyAt(
		wrap01(t + moonLagAt(t, day, options)),
		options.maxElevation ?? DEFAULT_MAX_ELEVATION,
		out
	);
