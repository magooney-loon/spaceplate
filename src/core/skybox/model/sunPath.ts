// Sun and moon positions (§3.3, §3.4). Fixed arc -- predictable, gamey, trivially
// authorable. A real solar model (latitude + day-of-year) can arrive later as an
// alternative module, because everything downstream reads only the derived direction.

import { smooth01 } from './math';
import type { CelestialBody, Vec3 } from './types';

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

export type PathOptions = {
	/** Peak elevation in degrees at local noon. */
	maxElevation?: number;
	/** Moon offset in normalized days. 0.5 = opposition = full moon. */
	moonLag?: number;
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
 * The moon mirrors the sun's arc with a configurable lag, defaulting to opposition --
 * a full moon every night to start. Phase is just the sun-moon angle, so this lag knob
 * becomes the phase control when a phase-shaded disc is eventually rendered.
 */
export const moonAt = (
	t: number,
	options: PathOptions = {},
	out: CelestialBody = createBody()
): CelestialBody =>
	bodyAt((t + (options.moonLag ?? 0.5)) % 1, options.maxElevation ?? DEFAULT_MAX_ELEVATION, out);
