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
// exposure uniform). These values are a look, not physics.
//
// The whole ramp sits below 1 -- peaking at 0.78 at noon -- on purpose. Under AgX,
// pulling exposure down moves the daylight highlights into the filmic shoulder instead
// of clipping them flat, which is most of what reads as "cinematic". It also keeps the
// curve deliberately FLAT (0.60 to 0.78 across the whole day), so scene brightness
// varies because the light varies, not because a virtual camera is riding its own
// exposure knob. Exposure below the twilight cutoff is doing a different job: the dome
// is black down there (see the SkyLight fill), so it is the only lever that decides
// whether moonlit geometry reads at all.
//
// KEYFRAME TIMES ARE NOT FREE. They are the inverse of the sun arc (sunPath.ts):
//
//     t = 0.25 + asin(elevation / maxElevation) / 2pi      (morning)
//     t = 0.75 - asin(elevation / maxElevation) / 2pi      (evening)
//
// The first pass of this curve was authored by eye and drifted badly from the arc --
// the `sunrise` keyframe landed at +9.4 degrees of elevation, `sunset` at -4.7, `dusk`
// at -23. The sky's look and the sun's position disagreed by 20-30 degrees, which is
// exactly the "something is off" that no individual value explains. Each keyframe below
// is now pinned to the elevation milestone its name claims, and the comment on each one
// records that elevation. Retime them together or they drift apart again.
//
// The pinning assumes `maxElevation` = DEFAULT_MAX_ELEVATION. A game that changes the
// arc's peak shifts every twilight boundary, so the arc peak is effectively part of
// this curve's contract.

import type { DayKeyframe, RGB, SkyBaseline } from './types';

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
		// TURBIDITY IS NOT THE COLOUR KNOB HERE; RAYLEIGH IS. This keyframe was authored at
		// turbidity 9 / rayleigh 2.8 on the assumption that "more scattering" meant "more
		// sunrise". It does not. Turbidity feeds `vBetaM`, and mie scattering is nearly
		// wavelength-flat, so raising it grows a big GREY halo -- measured, the glow band
		// within 35 degrees of the sun came out rgb(131,122,131) at saturation 0.14. A
		// colourless sunrise, which is exactly what "washed out" looked like.
		//
		// The red comes from rayleigh EXTINCTION along the horizon path (`Fex` in SkyMesh):
		// blue is scattered out of the line of sight and red survives. Rayleigh 5 puts the
		// band at rgb(184,135,105) at 8 degrees, rgb(181,82,68) at 3 and rgb(72,2,3) at the
		// horizon -- and collapses the below-horizon smear that used to fill the lower half
		// of frame from rgb(94,10,7) to rgb(8,0,0) at -20 degrees.
		//
		// Turbidity still sets how BIG and how bright that halo is, so it comes down with it.
		// None of this touches scene lighting: the env map is at 0.25 and the key dominates,
		// so ground and sun-facing surfaces measure identical before and after.
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
		// IT IS NOT ACTUALLY GOLDEN, AND IT CANNOT BE MADE SO. Preetham's warm window is
		// roughly 0 to 2 degrees of SUN elevation and no uniform widens it: the redness rides
		// the `mix(1, sqrt(vSunE * ratio * Fex), pow(1 - sunDir.y, 5))` term, whose weight is
		// 1.0 at the horizon and already 0.57 by +6. Above ~4 degrees the sun-side sky
		// measures blue (warm -0.36 on an R-minus-B scale) whatever turbidity and rayleigh
		// do, and by +14 it is 100% clipped white. Don't spend an afternoon here; the golden
		// look lives on the `sunrise` / `sunset` keyframes, which is where it has been moved.
		//
		// What IS worth doing is stopping it clipping. At the old turbidity 6 / rayleigh 2 /
		// exposure 0.72, six of seven sampled elevations from -20 to +25 were past white --
		// a flat blue-white sheet with no gradient in it. The values below take that to four,
		// which is where the curve flattens out; pushing exposure lower buys nothing more and
		// only costs the scene (0.62 keeps the ground at 0.9x, 0.48 drops it to 0.7x).
		t: 0.2627,
		name: 'goldenMorning',
		turbidity: 5,
		rayleigh: 4,
		mieCoefficient: 0.0045,
		mieDirectionalG: 0.82,
		exposure: 0.62,
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
		exposure: 0.76,
		starVisibility: 0,
		fogColor: [0.62, 0.7, 0.82],
		fogDensity: 0.02
	},
	{
		// +75 deg. Arc peak.
		t: 0.5,
		name: 'noon',
		turbidity: 2,
		rayleigh: 1,
		mieCoefficient: 0.003,
		mieDirectionalG: 0.8,
		exposure: 0.78,
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
		exposure: 0.76,
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
		exposure: 0.62,
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

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Writes into `out` -- the sampler runs every frame and must not allocate. */
const lerpRGB = (a: RGB, b: RGB, k: number, out: RGB): RGB => {
	out[0] = lerp(a[0], b[0], k);
	out[1] = lerp(a[1], b[1], k);
	out[2] = lerp(a[2], b[2], k);
	return out;
};

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
	exposure: 0.78,
	starVisibility: 0,
	fogColor: [0.7, 0.78, 0.9],
	fogDensity: 0.015
});
