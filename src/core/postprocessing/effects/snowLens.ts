// Frost on the lens — the snow counterpart to rainLens.ts, deliberately not a recolour
// of it: water beads and runs, ice GROWS. A front creeps inward from the frame edges
// (thickest in the corners), only advancing/retreating, never sliding. Mechanically
// the same effect and inherits rainLens.ts's constraints (RTT mip source, `inputClamp`,
// dry-lens latch) — read that header first.
//
// Ordered after the rain lens (37 > 36) so during sleet its RTT captures the
// already-rain-lensed frame and the two composite in the right order.
//
// Frost is dendritic (thin branching filaments, not blobs), so the shape is ridged
// noise: fractal noise folded about zero, `1 - |fbm|`, puts a bright thin ridge at
// every zero crossing. Two scales (fine needles over coarse plates) give the whole
// crystal structure. Only the ridges need a gradient (for refraction), at two octaves
// each — down from 27 evaluated octaves/pixel to 14.
//
// The front is a threshold on a vignette (distance from frame centre, perturbed by
// low-freq noise for a lobed edge) against a level `uGrowth` walks inward, slow in
// both directions — ice takes seconds to form and longer to go.

import {
	Fn,
	float,
	mix,
	mx_fractal_noise_float,
	pow,
	screenSize,
	screenUV,
	smoothstep,
	vec2,
	vec3,
	vec4
} from 'three/tsl';
import {
	lensActivity,
	uGrowth,
	uIce,
	uPatternOffset
} from '$core/skybox/layers/precipitation/lensState.svelte';
import type { EffectDef } from '../types';
import { mipSource } from './mipSource';

export type SnowLensParams = {
	/** Zoom of the crystal pattern. Larger = coarser, more widely spaced dendrites. */
	scale: number;
	/** Multiplier on the refraction offset. 0 keeps the frost but stops it bending. */
	refraction: number;
	/** Mip level sampled through fully-formed frost — much higher than the rain lens's
	 * glass blur since ice is close to opaque, but only reached at mask 1 (the corners). */
	frostBlur: number;
	/** How far toward the ice colour a fully frosted pixel is milked. */
	milk: number;
	/** How brightly the crystal filaments themselves catch the light. */
	sparkle: number;
	/** Ceiling on the linear value the lens is allowed to sample — see `mipSource.ts`. */
	inputClamp: number;
};

export const snowLensEffect: EffectDef<SnowLensParams> = {
	id: 'snowLens',
	label: 'Snow Lens',
	role: 'chain',
	order: 37,
	requires: [],
	// Tuned down across the board from the first pass, which iced over hard enough to
	// dominate the frame — the ceiling on the blend below came down with these
	// (0.92 -> 0.85); the CPU side got the rest of the fix (LensDriver.svelte).
	params: () => ({
		scale: 1,
		refraction: 0.3,
		frostBlur: 2.2,
		milk: 0.28,
		sparkle: 0.3,
		inputClamp: 8
	}),
	defaultEnabled: true,
	ranges: {
		scale: { min: 0.2, max: 3, step: 0.05 },
		refraction: { min: 0, max: 2, step: 0.05 },
		frostBlur: { min: 0, max: 8, step: 0.1 },
		milk: { min: 0, max: 1, step: 0.01 },
		sparkle: { min: 0, max: 2, step: 0.05 },
		inputClamp: { min: 0.5, max: 64, step: 0.5 }
	},
	structuralTag: () => (lensActivity.snow ? 1 : 0),
	note: 'Driven by weather + camera speed, not by these sliders — frost only appears while it is snowing. Unlike rain it has a standing term, so a stationary camera ices over too (LensDriver.svelte).',
	build: (ctx, u) => {
		if (!lensActivity.snow) return ctx.color;

		/** Ridged fractal noise: fbm folded about zero, so zero crossings become thin
		 * bright filaments. A plain function, not `Fn`: no assignment, so no stack
		 * needed (layers/skyLayer.ts). Position lifted to vec3 explicitly — only
		 * `mx_noise_float` declares the vec2|vec3 conversion, the fractal variant doesn't. */
		const ridged = (p: any, frequency: number, octaves: number) =>
			mx_fractal_noise_float(vec3(p.mul(frequency), 0), octaves, 2, 0.55, 1)
				.abs()
				.oneMinus()
				.clamp(0, 1);

		/** The dendrite structure — fine needles over coarse plates. The powers sharpen
		 * the ridges; without them `1 - |fbm|` is a fat band and reads as marble, not
		 * ice. Inside `Fn` so it can be evaluated three times (finite differences below)
		 * without three copies of the graph. Two octaves each, not three: a third pushes
		 * the needle layer past what the pixel grid resolves — shimmer, not detail, at
		 * a third more cost. */
		const Crystal = Fn(([q]: [any]): any =>
			pow(ridged(q, 24, 2), float(3))
				.mul(0.8)
				.add(pow(ridged(q, 7.5, 2), float(2)).mul(0.4))
		);

		// Coverage computed once, outside the finite differences — it used to run
		// inside the differenced function, so the vignette/lobe fbm/smoothstep all ran
		// three times per pixel for a field that's low-frequency by construction. Only
		// the crystal needs a gradient; multiplying the finished normal by coverage
		// keeps the growth-edge ramp without paying for its derivative. Fullscreen,
		// that's 14 noise octaves per pixel instead of 27.

		// Aspect-corrected space centred on the frame, so crystals are square on
		// screen. No y-flip: unlike the rain lens this isn't a Shadertoy port.
		const aspect = screenSize.x.div(screenSize.y);
		const patternUV = screenUV.sub(0.5).mul(vec2(aspect, 1)).mul(u.scale);

		// Vignette the front advances against: 0 at centre, 1 at top/bottom edges,
		// ~1.9 at the corners of a 16:9 frame — frost reaches corners first for free.
		const edge = patternUV.length().mul(2);

		// The noise domain, and only the noise domain — see `uPatternOffset` on why
		// the vignette above reads the un-offset position.
		const q = patternUV.add(uPatternOffset);

		// Lobes: without this the front is a perfect closing circle, reading as a
		// vignette rather than something growing.
		const lobes = mx_fractal_noise_float(vec3(q.mul(4.5), 0), 2, 2, 0.5, 1);

		// At growth 0 the level sits past the far corners (2.7 vs a max of ~2.45), so
		// the glass is genuinely clear; at growth 1 it has swept past the centre.
		const front = float(2.7).sub(uGrowth.mul(2.9));
		const mask = smoothstep(float(0), float(0.5), edge.add(lobes.mul(0.55)).sub(front)).toVar();

		// Normals by finite difference. A free choice here (the field is smooth fbm
		// with no floor/fract grids, so dFdx/dFdy would behave) but used anyway for
		// resolution independence — a screen-space derivative would tie `refraction`
		// to the display's pixel density. Offsets go on `q` (patternUV + a constant).
		const e = float(0.0015);
		const crystal = Crystal(q).toVar();
		const cx = Crystal(q.add(vec2(e, 0)));
		const cy = Crystal(q.add(vec2(0, e)));
		// Coverage scales the finished normal rather than each sample, so refraction
		// comes up with the ice rather than snapping on at its boundary.
		const n = vec2(cx.sub(crystal), cy.sub(crystal)).mul(u.refraction).mul(mask);

		// Blur rides coverage — heaviest in the corners, absent in the clear middle.
		// No counterpart to the rain lens's dropBlur: there's nothing to see clearly
		// through ice the way a drop still resolves an image.
		const focus = mask.mul(u.frostBlur);

		const frame = mipSource(ctx, { clamp: u.inputClamp, uv: screenUV.add(n), level: focus });

		// Ice scatters rather than absorbs: milk toward the ice colour by coverage,
		// then lay the lit crystal filaments over the top — the part that keeps frost
		// from reading as a smear once the blur has taken the frame apart.
		const frosted = mix(frame.rgb, uIce, mask.mul(u.milk)).add(
			uIce.mul(crystal.mul(mask).mul(u.sparkle))
		);

		// Coverage is the blend (the mesh's old opacityNode, written out). The ceiling
		// keeps a little of the unclamped frame in even at the densest corner.
		return mix(ctx.color, vec4(frosted, ctx.color.a), mask.mul(0.85));
	}
};
