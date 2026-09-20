// Fog scattering — the frame blended against a blurred (mip, not gaussian) copy of
// itself on the scene fog's distance ramp: the scattering half of fog a `fogNode` can't
// do (SkyFog.svelte only tints/absorbs). Driven by the weather, not the panel —
// `$core/skybox/fogScatter.svelte.ts` carries the band/weight; see postprocessing/CLAUDE.md
// for the full rationale.

import { mix, screenUV, smoothstep } from 'three/tsl';
import { uFogFar, uFogNear, uFogScatter } from '$core/skybox/fogScatter.svelte';
import type { EffectDef } from '../types';
import { mipSource } from './mipSource';

export type FogScatterParams = {
	/**
	 * Ceiling on the blend at the far end of the band, before the weather's own weight.
	 * 1 would dissolve distant geometry completely; fog does not actually do that at any
	 * density a game is playable at, and the remaining sharpness is what keeps a far
	 * landmark readable as a landmark.
	 */
	strength: number;
	/**
	 * Mip level sampled at the far end of the band — the blur radius, in octaves. Whole
	 * numbers are not required; the sampler interpolates between levels, which is what
	 * makes the ramp smooth rather than stepped.
	 */
	blur: number;
	/** Ceiling on the values entering the blurred copy — see `mipSource.ts`. */
	inputClamp: number;
};

export const fogScatterEffect: EffectDef<FogScatterParams> = {
	id: 'fogScatter',
	label: 'Fog Scattering',
	role: 'chain',
	// After AO (10) and the basic DoF (30), before motion blur (35), the lenses (36/37)
	// and bloom (40): fog is a property of the air, so it belongs under anything
	// modelling the lens/shutter/eye, and before the lenses so a storm's rain droplets
	// refract an already-fogged frame rather than the fog blurring the droplets.
	order: 32,
	// `viewZ` is a PassNode builtin — no MRT attachment, so this effect adds no
	// attachment to the union and never forces a scene-wide shader rebuild.
	requires: ['viewZ'],
	params: () => ({ strength: 0.85, blur: 3.2, inputClamp: 8 }),
	// Enabled by default. Always in the graph — the weatherGrade/afterimage bargain, not
	// a latch: `weight` below is the weather fog channel times the band, an exact 0 in
	// clear air, so the mix is a true identity at rest. Trades a full-frame target + a
	// mip chain regenerated every frame regardless of weather for never rebuilding the
	// pipeline on a fog transition (postprocessing/CLAUDE.md).
	defaultEnabled: true,
	ranges: {
		strength: { min: 0, max: 1, step: 0.01 },
		blur: { min: 0.5, max: 6, step: 0.1 },
		inputClamp: { min: 1, max: 32, step: 0.5 }
	},
	note: 'Blurs the frame into the distance on the scene fog band, so a fog bank softens what is inside it instead of only paling it. Driven by the weather fog channel — an exact identity in clear weather, and never a pipeline rebuild.',
	build: (ctx, u) => {
		// viewZ is negative in front of the camera, so distance along the ray is its
		// negation. Past the band's far edge (sky included) it clamps to 1.
		const distance = ctx.viewZ.negate();
		const band = smoothstep(uFogNear, uFogFar, distance);

		// The weather's weight is the outer gate: the band alone is 1 at the horizon in
		// every weather, including none.
		const weight = band.mul(uFogScatter).mul(u.strength);

		// The level ramps with the band rather than sitting at `blur` everywhere: a
		// constant level would soften the camera's feet as hard as the horizon.
		const scattered = mipSource(ctx, {
			clamp: u.inputClamp,
			uv: screenUV,
			level: band.mul(u.blur)
		});

		// The base of the mix is the UNCLAMPED frame, so a bright light source keeps its
		// real radiance wherever the scattering is thin (and keeps feeding bloom, which
		// folds in after this).
		return mix(ctx.color, scattered, weight);
	}
};
