// The day curve. One continuous day instead of ten discrete presets: sunrise/day/
// sunset/night are points on one timeline, and the old weather "presets" were never
// sky states at all -- they belong to the mixer. Defaults are seeded from the old
// presets' values; authored keyframes will come from weather.json (see ../CLAUDE.md).
// `exposure` is applied by Sky.svelte as renderer.toneMappingExposure (SkyMesh has no
// exposure uniform) -- a look, not physics.
//
// The whole ramp sits below 1 (0.58-0.68 across the day) on purpose: under AgX it keeps
// daylight highlights in the filmic shoulder instead of clipping them flat, and scene
// brightness varies because the light varies, not because a virtual camera rides its
// own exposure knob. DO NOT reach for this knob when the daytime frame looks blown
// out -- that is bloom, not this curve (see ./CLAUDE.md). Below the twilight cutoff
// exposure is doing a different job: the dome is black down there, so it is the only
// lever deciding whether moonlit geometry reads at all.
//
// KEYFRAME TIMES ARE NOT FREE. They are the inverse of the sun arc (sunPath.ts):
//
//     t = 0.25 + asin(elevation / maxElevation) / 2pi      (morning)
//     t = 0.75 - asin(elevation / maxElevation) / 2pi      (evening)
//
// Each keyframe is pinned to the elevation milestone its name claims (recorded in its
// comment); retime them together or they drift apart. The pinning assumes
// `maxElevation` = DEFAULT_MAX_ELEVATION -- a game that changes the arc's peak shifts
// every twilight boundary, so the peak is effectively part of this curve's contract.

import { ease, lerp, lerpRGB } from './math';
import type { DayKeyframe, SkyBaseline } from './types';

export const DEFAULT_DAY_CURVE: DayKeyframe[] = [
	{
		// -75 deg. Solar midnight: the darkest the dome ever gets.
		t: 0,
		name: 'night',
		turbidity: 1.2,
		rayleigh: 0.35,
		mieCoefficient: 0.0008,
		mieDirectionalG: 0.6,
		exposure: 0.62,
		starVisibility: 1,
		fogColor: [0.02, 0.03, 0.06],
		fogDensity: 0.02
	},
	{
		// -18 deg. Astronomical dawn: the first light that is not starlight.
		t: 0.21143,
		name: 'astronomicalDawn',
		turbidity: 2,
		rayleigh: 0.8,
		mieCoefficient: 0.0015,
		mieDirectionalG: 0.7,
		exposure: 0.6,
		starVisibility: 0.8,
		fogColor: [0.05, 0.07, 0.14],
		fogDensity: 0.028
	},
	{
		// -6 deg. Civil dawn: blue hour, the sky is bright but the sun is still down.
		t: 0.2373,
		name: 'dawn',
		turbidity: 4,
		rayleigh: 1.8,
		mieCoefficient: 0.003,
		mieDirectionalG: 0.75,
		exposure: 0.6,
		starVisibility: 0.3,
		fogColor: [0.16, 0.18, 0.3],
		fogDensity: 0.034
	},
	{
		// 0 deg. The sun is exactly on the horizon -- peak scattering, peak colour.
		//
		// RAYLEIGH IS THE COLOUR KNOB HERE, NOT TURBIDITY: turbidity feeds mie, which is
		// wavelength-flat and only grows a grey halo; the red comes from rayleigh
		// extinction along the horizon path (see ./CLAUDE.md). Turbidity still sets how
		// big and bright the halo is.
		t: 0.25,
		name: 'sunrise',
		turbidity: 6,
		rayleigh: 5,
		mieCoefficient: 0.005,
		mieDirectionalG: 0.78,
		exposure: 0.68,
		starVisibility: 0.05,
		fogColor: [0.52, 0.36, 0.28],
		fogDensity: 0.038
	},
	{
		// +6 deg. Morning golden hour -- the mirror of goldenHour below.
		//
		// NOT ACTUALLY GOLDEN, AND CANNOT BE MADE SO: Preetham's warm window is only
		// ~0-2 degrees of sun elevation (see ./CLAUDE.md). The values are tuned to stop
		// clipping, nothing more; the golden look lives on `sunrise`/`sunset`.
		t: 0.2627,
		name: 'goldenMorning',
		turbidity: 5,
		rayleigh: 4,
		mieCoefficient: 0.0045,
		mieDirectionalG: 0.82,
		exposure: 0.58,
		starVisibility: 0,
		fogColor: [0.62, 0.5, 0.4],
		fogDensity: 0.03
	},
	{
		// +44 deg. Full daylight, colour has settled to blue.
		t: 0.35,
		name: 'morning',
		turbidity: 3.5,
		rayleigh: 1.3,
		mieCoefficient: 0.0035,
		mieDirectionalG: 0.8,
		exposure: 0.66,
		starVisibility: 0,
		fogColor: [0.62, 0.7, 0.82],
		fogDensity: 0.02
	},
	{
		// +75 deg. Arc peak. Sits a notch under `morning`/`afternoon` rather than above them:
		// it is the brightest light of the day, so it is where the camera stops down.
		t: 0.5,
		name: 'noon',
		turbidity: 2,
		rayleigh: 1,
		mieCoefficient: 0.003,
		mieDirectionalG: 0.8,
		exposure: 0.65,
		starVisibility: 0,
		fogColor: [0.7, 0.78, 0.9],
		fogDensity: 0.015
	},
	{
		// +44 deg. Mirror of `morning`; slightly hazier, as afternoons read.
		t: 0.65,
		name: 'afternoon',
		turbidity: 3,
		rayleigh: 1.2,
		mieCoefficient: 0.0035,
		mieDirectionalG: 0.8,
		exposure: 0.66,
		starVisibility: 0,
		fogColor: [0.68, 0.72, 0.84],
		fogDensity: 0.018
	},
	{
		// +6 deg. Golden hour proper -- and just as un-golden as `goldenMorning`; see the
		// note there. Same de-clipping rebalance.
		t: 0.7373,
		name: 'goldenHour',
		turbidity: 5,
		rayleigh: 4,
		mieCoefficient: 0.0045,
		mieDirectionalG: 0.85,
		exposure: 0.58,
		starVisibility: 0,
		fogColor: [0.72, 0.55, 0.38],
		fogDensity: 0.028
	},
	{
		// 0 deg. The sun touches the horizon. Same rebalance as `sunrise` -- see the note
		// there on why rayleigh and not turbidity carries the colour. Kept marginally hazier
		// and warmer than sunrise, as evenings read.
		t: 0.75,
		name: 'sunset',
		turbidity: 7,
		rayleigh: 5.2,
		mieCoefficient: 0.005,
		mieDirectionalG: 0.78,
		exposure: 0.68,
		starVisibility: 0.05,
		fogColor: [0.6, 0.36, 0.26],
		fogDensity: 0.038
	},
	{
		// -6 deg. Civil dusk: the evening blue hour.
		t: 0.7627,
		name: 'dusk',
		turbidity: 5,
		rayleigh: 2,
		mieCoefficient: 0.004,
		mieDirectionalG: 0.85,
		exposure: 0.62,
		starVisibility: 0.35,
		fogColor: [0.24, 0.2, 0.32],
		fogDensity: 0.034
	},
	{
		// -18 deg. Astronomical dusk: last colour drains, stars take over.
		t: 0.7886,
		name: 'astronomicalDusk',
		turbidity: 2.5,
		rayleigh: 1,
		mieCoefficient: 0.002,
		mieDirectionalG: 0.75,
		exposure: 0.6,
		starVisibility: 0.8,
		fogColor: [0.07, 0.08, 0.16],
		fogDensity: 0.028
	}
];

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
	if (n === 1) {
		const only = curve[0];
		out.turbidity = only.turbidity;
		out.rayleigh = only.rayleigh;
		out.mieCoefficient = only.mieCoefficient;
		out.mieDirectionalG = only.mieDirectionalG;
		out.exposure = only.exposure;
		out.starVisibility = only.starVisibility;
		lerpRGB(only.fogColor, only.fogColor, 0, out.fogColor);
		out.fogDensity = only.fogDensity;
		return out;
	}

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
	lerpRGB(a.fogColor, b.fogColor, k, out.fogColor);
	out.fogDensity = lerp(a.fogDensity, b.fogDensity, k);
	return out;
};

/**
 * Scratch baseline for the sampler to write into. The values mirror the `noon` keyframe
 * so that the degenerate path -- an empty curve, where the sampler returns `out`
 * untouched -- still lands on a sane sky rather than a blown-out one.
 */
export const createBaseline = (): SkyBaseline => ({
	turbidity: 2,
	rayleigh: 1,
	mieCoefficient: 0.003,
	mieDirectionalG: 0.8,
	exposure: 0.65,
	starVisibility: 0,
	fogColor: [0.7, 0.78, 0.9],
	fogDensity: 0.015
});
