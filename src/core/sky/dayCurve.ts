// The day curve (§4). One continuous day instead of ten discrete presets.
//
// The old SKY_PRESETS were these keyframes wearing a disguise: sunrise/day/sunset/
// night are four points on one timeline. The rest (cloudy, storm, fog) are not here at
// all -- they were always weather wearing a sky costume, and belong to the mixer.
//
// These defaults are seeded from the values the old presets shipped with, so the look
// is recognisable. They are the fallback; authored keyframes will come from
// weather.json (§16) once the config plumbing exists.
//
// exposure is applied by Sky.svelte as renderer.toneMappingExposure (SkyMesh has no
// exposure uniform). Night is deliberately lifted to 0.35: a physically dark night
// plus moonlight reads as pitch black, and the values below are a look, not physics.

import type { DayKeyframe, RGB, SkyBaseline } from './types';

export const DEFAULT_DAY_CURVE: DayKeyframe[] = [
	{
		t: 0,
		name: 'night',
		turbidity: 0.1,
		rayleigh: 0.1,
		mieCoefficient: 0.0001,
		mieDirectionalG: 0.5,
		exposure: 0.35,
		starVisibility: 1,
		fogColor: [0.02, 0.03, 0.06],
		fogDensity: 0.02
	},
	{
		t: 0.22,
		name: 'astronomicalDawn',
		turbidity: 2,
		rayleigh: 1,
		mieCoefficient: 0.002,
		mieDirectionalG: 0.7,
		exposure: 0.45,
		starVisibility: 0.6,
		fogColor: [0.08, 0.09, 0.16],
		fogDensity: 0.03
	},
	{
		t: 0.27,
		name: 'sunrise',
		turbidity: 8,
		rayleigh: 2.5,
		mieCoefficient: 0.004,
		mieDirectionalG: 0.75,
		exposure: 0.6,
		starVisibility: 0.1,
		fogColor: [0.5, 0.35, 0.28],
		fogDensity: 0.035
	},
	{
		t: 0.35,
		name: 'morning',
		turbidity: 4,
		rayleigh: 1.5,
		mieCoefficient: 0.0035,
		mieDirectionalG: 0.8,
		exposure: 0.9,
		starVisibility: 0,
		fogColor: [0.6, 0.68, 0.8],
		fogDensity: 0.02
	},
	{
		t: 0.5,
		name: 'noon',
		turbidity: 2,
		rayleigh: 1,
		mieCoefficient: 0.003,
		mieDirectionalG: 0.8,
		exposure: 1,
		starVisibility: 0,
		fogColor: [0.7, 0.78, 0.9],
		fogDensity: 0.015
	},
	{
		t: 0.7,
		name: 'goldenHour',
		turbidity: 6,
		rayleigh: 2,
		mieCoefficient: 0.0045,
		mieDirectionalG: 0.85,
		exposure: 0.9,
		starVisibility: 0,
		fogColor: [0.72, 0.55, 0.38],
		fogDensity: 0.025
	},
	{
		t: 0.76,
		name: 'sunset',
		turbidity: 10,
		rayleigh: 3,
		mieCoefficient: 0.005,
		mieDirectionalG: 0.7,
		exposure: 0.7,
		starVisibility: 0.05,
		fogColor: [0.6, 0.36, 0.26],
		fogDensity: 0.035
	},
	{
		t: 0.8,
		name: 'dusk',
		turbidity: 5,
		rayleigh: 2,
		mieCoefficient: 0.005,
		mieDirectionalG: 0.9,
		exposure: 0.55,
		starVisibility: 0.4,
		fogColor: [0.2, 0.18, 0.3],
		fogDensity: 0.03
	}
];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const lerpRGB = (a: RGB, b: RGB, k: number): RGB => [
	lerp(a[0], b[0], k),
	lerp(a[1], b[1], k),
	lerp(a[2], b[2], k)
];

/** Smoothstep easing -- flat lerp between keyframes reads mechanical at low counts. */
const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * Sample the curve at normalized time `t`, writing into `out` rather than allocating.
 *
 * The curve is cyclic: the last keyframe wraps to the first across midnight, so the
 * gap from `dusk` (0.8) to `night` (0.0/1.0) interpolates correctly instead of
 * snapping. Keyframes are assumed sorted by `t`.
 */
export const sampleDayCurve = (
	t: number,
	out: SkyBaseline,
	curve: DayKeyframe[] = DEFAULT_DAY_CURVE
): SkyBaseline => {
	const n = curve.length;
	if (n === 0) return out;
	if (n === 1) return Object.assign(out, curve[0]);

	// Find the last keyframe at or before t; -1 means t precedes the first.
	let i = -1;
	for (let k = 0; k < n; k++) {
		if (curve[k].t <= t) i = k;
		else break;
	}

	const a = i === -1 ? curve[n - 1] : curve[i];
	const b = i === -1 || i === n - 1 ? curve[0] : curve[i + 1];

	// Span across the midnight wrap is measured forward, modulo one day.
	const span = (b.t - a.t + 1) % 1 || 1;
	const k = ease(Math.min(1, Math.max(0, ((t - a.t + 1) % 1) / span)));

	out.turbidity = lerp(a.turbidity, b.turbidity, k);
	out.rayleigh = lerp(a.rayleigh, b.rayleigh, k);
	out.mieCoefficient = lerp(a.mieCoefficient, b.mieCoefficient, k);
	out.mieDirectionalG = lerp(a.mieDirectionalG, b.mieDirectionalG, k);
	out.exposure = lerp(a.exposure, b.exposure, k);
	out.starVisibility = lerp(a.starVisibility, b.starVisibility, k);
	out.fogColor = lerpRGB(a.fogColor, b.fogColor, k);
	out.fogDensity = lerp(a.fogDensity, b.fogDensity, k);
	return out;
};

export const createBaseline = (): SkyBaseline => ({
	turbidity: 2,
	rayleigh: 1,
	mieCoefficient: 0.003,
	mieDirectionalG: 0.8,
	exposure: 1,
	starVisibility: 0,
	fogColor: [0.7, 0.78, 0.9],
	fogDensity: 0.015
});
