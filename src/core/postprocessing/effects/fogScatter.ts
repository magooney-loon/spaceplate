// Fog scattering — the frame blended against a blurred (mip, not gaussian) copy of
// itself on the scene fog's distance ramp: the scattering half of fog a `fogNode` can't
// do (SkyFog.svelte only tints/absorbs). Driven by the weather, not the panel —
// `$core/skybox/fogScatter.svelte.ts` carries the band/weight; see postprocessing/CLAUDE.md
// for the full rationale and the shared activity-latch contract with the lens effects.

import { mix, screenUV, smoothstep } from 'three/tsl';
import { fogScatterActivity, uFogFar, uFogNear, uFogScatter } from '$core/skybox/fogScatter.svelte';
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
	// After AO (10) and the basic DoF (30), BEFORE motion blur (35), the lenses (36/37)
	// and bloom (40): this is a property of the air in the scene, so it belongs under
	// anything modelling the lens, the shutter or the eye, and bloom should spread the
	// light that scattering has already moved.
	//
	// It sat at 40 until it was noticed that that is bloom's own order — a tie broken
	// only by the two effects' positions in the registry array — and that it put fog
	// AFTER the lenses, so a storm (the one weather that activates scattering and rain
	// together) blurred the atmosphere through the windscreen droplets instead of the
	// other way round.
	order: 32,
	// `viewZ` is a PassNode builtin — no MRT attachment, so this effect adds no
	// attachment to the union and never forces a scene-wide shader rebuild.
	requires: ['viewZ'],
	params: () => ({ strength: 0.85, blur: 3.2, inputClamp: 8 }),
	// Enabled by default and free when the weather is dry: with no fog the latch below
	// keeps it out of the graph entirely, so the cost is exactly zero until it rains.
	defaultEnabled: true,
	ranges: {
		strength: { min: 0, max: 1, step: 0.01 },
		blur: { min: 0.5, max: 6, step: 0.1 },
		inputClamp: { min: 1, max: 32, step: 0.5 }
	},
	// The latch (see fogScatter.svelte.ts): the graph must not contain this effect while
	// the weather is dry, because an inactive one still allocates a full-frame target and
	// regenerates its mip chain every frame to be blended at weight zero.
	structuralTag: () => (fogScatterActivity.active ? 'on' : 'off'),
	note: 'Blurs the frame into the distance on the scene fog band, so a fog bank softens what is inside it instead of only paling it. Driven by the weather fog channel — it does nothing in clear weather, and leaves the pipeline entirely below a low fog threshold.',
	build: (ctx, u) => {
		// Dry: fold in nothing at all. The effect stays "enabled" in the panel — this is
		// the weather's decision, not the user's — and the graph is exactly what it would
		// be with the effect switched off.
		if (!fogScatterActivity.active) return ctx.color;

		// `viewZ` is NEGATIVE in front of the camera (three's view-space convention), so
		// the distance along the ray is its negation. Everything past the band's far edge
		// — the sky included — clamps to 1, which is what fog thick enough to trigger this
		// should do to a sky.
		const distance = ctx.viewZ.negate();
		const band = smoothstep(uFogNear, uFogFar, distance);

		// The weather's weight is the outer gate: the band alone is 1 at the horizon in
		// every weather, including none.
		const weight = band.mul(uFogScatter).mul(u.strength);

		// The blurred copy (mipSource.ts owns the clamp and the configure-in-place rules).
		// The level RAMPS with the band rather than sitting at `blur` everywhere: a
		// constant mip level would soften the pixels at the camera's feet as hard as the
		// ones at the horizon, and the near end of a fog bank is where you can still see.
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
