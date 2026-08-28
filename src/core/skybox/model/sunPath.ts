// Sun and moon positions (§3.3, §3.4). Fixed arc -- predictable, gamey, trivially
// authorable. A real solar model (latitude + day-of-year) can arrive later as an
// alternative module, because everything downstream reads only the derived direction.

import type { CelestialBody } from './types';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

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

/** Spherical -> cartesian, Y up. Mirrors what SkyMesh expects for `sunPosition`. */
const directionFrom = (elevationDeg: number, azimuthDeg: number) => {
	const phi = (90 - elevationDeg) * DEG;
	const theta = azimuthDeg * DEG;
	const sinPhi = Math.sin(phi);
	return {
		x: sinPhi * Math.sin(theta),
		y: Math.cos(phi),
		z: sinPhi * Math.cos(theta)
	};
};

const bodyAt = (t: number, maxElevation: number): CelestialBody => {
	const elevation = elevationAt(t, maxElevation);
	const azimuth = azimuthAt(t);
	return {
		direction: directionFrom(elevation, azimuth),
		elevation,
		azimuth,
		// Cloud occlusion arrives with the weather mixer; a clear sky is fully visible
		// once the body is above the horizon.
		visibility: elevation > 0 ? 1 : 0
	};
};

export const sunAt = (t: number, options: PathOptions = {}): CelestialBody =>
	bodyAt(t, options.maxElevation ?? 75);

/**
 * The moon mirrors the sun's arc with a configurable lag, defaulting to opposition --
 * a full moon every night to start. Phase is just the sun-moon angle, so this lag knob
 * becomes the phase control when a phase-shaded disc is eventually rendered.
 */
export const moonAt = (t: number, options: PathOptions = {}): CelestialBody => {
	const lag = options.moonLag ?? 0.5;
	return bodyAt((t + lag) % 1, options.maxElevation ?? 75);
};
