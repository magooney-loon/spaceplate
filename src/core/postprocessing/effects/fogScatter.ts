// Fog scattering — the frame blended against a blurred copy of itself on the scene fog's
// own distance ramp. three's `webgpu_custom_fog_scattering` demo, adapted to this
// pipeline's conventions.
//
// WHY IT EXISTS. `SkyFog.svelte` tints surfaces toward the fog colour by distance, which
// is the absorption half of fog and all a `fogNode` can do. The other half is
// SCATTERING: a volume of droplets redirects light between neighbouring paths, so a
// distant lamp gets a halo and a distant edge stops being an edge. Tinting alone leaves
// every silhouette inside a fog bank perfectly crisp and merely paler — haze in a
// photograph rather than weather you are standing in. One blur, mixed on the fog factor,
// is most of the difference.
//
// IT IS DRIVEN BY THE WEATHER, NOT BY THE PANEL. `$core/skybox/fogScatter.svelte.ts`
// carries the band and the weight, written by SkyFog's task; the params here only shape
// what the driver asks for. It follows the lens effects' contract exactly, including the
// structural activity latch — read that module's header before changing either.
//
// THE BLUR IS A MIPMAP, not a gaussian. The effect wants a broad, low-frequency
// smear, which is precisely what a mip chain already is, and the lens effects had
// already established the `rtt()` + `levelNode` route here (see rainLens.ts on why it is
// configured in place rather than through `.sample()`/`.level()`). The reference demo
// reaches for `gaussianBlur` instead, which is several taps per pixel for a result this
// one approximates in one.

import { mix, rtt, screenUV, smoothstep, vec3, vec4 } from 'three/tsl';
import { HalfFloatType, LinearMipmapLinearFilter } from 'three/webgpu';
import { fogScatterActivity, uFogFar, uFogNear, uFogScatter } from '$core/skybox/fogScatter.svelte';
import type { EffectDef } from '../types';

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
	/**
	 * Ceiling on the values entering the blurred copy. Same job as the lens effects'
	 * `inputClamp`: the chain carries unbounded linear HDR, and one 400-nit specular
	 * pixel dragged through a mip chain becomes a visible square block of glow. The
	 * UNCLAMPED frame is still the base of the mix, so nothing is dimmed where the
	 * scattering is thin.
	 */
	inputClamp: number;
};

export const fogScatterEffect: EffectDef<FogScatterParams> = {
	id: 'fogScatter',
	label: 'Fog Scattering',
	role: 'chain',
	// After AO (10) and the basic DoF (30), before the lenses and bloom: this is a
	// property of the air in the scene, so it belongs under anything modelling the lens
	// or the eye, and bloom should spread the light that scattering has already moved.
	order: 40,
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

		// The mip source. Clamped (see `inputClamp`), and configured IN PLACE rather than
		// via `.sample()`/`.level()`: those return plain TextureNode clones, and only the
		// RTT node ITSELF carries the `updateBefore` that renders the target — a graph
		// containing only clones never fills it.
		const clamped = vec4(ctx.color.rgb.min(vec3(u.inputClamp)), ctx.color.a);
		const scattered: any = ctx.track(
			rtt(clamped, null, null, {
				type: HalfFloatType,
				generateMipmaps: true,
				minFilter: LinearMipmapLinearFilter
			})
		);
		scattered.uvNode = screenUV;
		// The blur RAMPS with the band rather than sitting at `blur` everywhere: a
		// constant mip level would soften the pixels at the camera's feet as hard as the
		// ones at the horizon, and the near end of a fog bank is where you can still see.
		scattered.levelNode = band.mul(u.blur);

		// The base of the mix is the UNCLAMPED frame, so a bright light source keeps its
		// real radiance wherever the scattering is thin (and keeps feeding bloom, which
		// folds in after this).
		return mix(ctx.color, scattered, weight);
	}
};
