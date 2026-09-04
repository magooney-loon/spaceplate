// FROST ON THE LENS -- the snow counterpart to rainLens.ts, and deliberately not a
// recolour of it. Water beads and runs; ice GROWS. So where the rain lens is a field of
// drops sliding down the glass, this is a front creeping inward from the edges of the
// frame, thickest in the corners, that never moves once it has arrived -- it only advances
// and retreats.
//
// MECHANICALLY IT IS THE SAME EFFECT and inherits every one of rainLens.ts's constraints,
// documented there in full rather than repeated here: the RTT mip source and its mipmap
// `minFilter`, the `inputClamp` that stops the sun disc smearing through the blur, why the
// colour-space round trip the old mesh needed is gone, and why a dry lens must leave the
// graph rather than multiply out to zero. Read that header first.
//
// TWO LENSES, ONE CHAIN. During sleet both are live, and this one is ordered after the rain
// lens (37 > 36), so its RTT captures the already-rain-lensed frame and the two composite
// in the right order. As meshes this was left to `ViewportTextureNode`'s internals and the
// old header noted that either answer was acceptable; in the chain it is simply correct.
//
// THE SHAPE OF FROST, and why it is ridged noise. Frost is dendritic -- it grows in thin
// branching filaments, not in blobs -- and the cheapest honest way to draw that is to take
// fractal noise and fold it about zero: `1 - |fbm|` puts a bright thin ridge along every
// zero crossing of the field. Two scales of it, a fine needle layer over coarse plates, is
// the whole crystal structure. Plain (unfolded) fbm gives smoke, which is what makes most
// frost shaders look like a dirty window instead of a cold one.
//
// THE FRONT is a threshold on a vignette: distance from the centre of the frame, pushed
// around by a low-frequency noise so the growth edge is lobed rather than a clean circle,
// against a level that `uGrowth` walks inward from beyond the corners to past the centre.
// That single number is what the CPU side drives, and it is slow in BOTH directions -- ice
// takes seconds to form and longer to go, which is exactly what distinguishes it from the
// rain lens's quick beading.
import {
	Fn,
	float,
	mix,
	mx_fractal_noise_float,
	pow,
	rtt,
	screenSize,
	screenUV,
	smoothstep,
	vec2,
	vec3,
	vec4
} from 'three/tsl';
import { HalfFloatType, LinearMipmapLinearFilter } from 'three/webgpu';
import {
	lensActivity,
	uGrowth,
	uIce,
	uPatternOffset
} from '$core/skybox/layers/precipitation/lensState.svelte';
import type { EffectDef } from '../types';

export type SnowLensParams = {
	/**
	 * Zoom of the crystal pattern. Larger = coarser, more widely spaced dendrites. A fixed
	 * piece of glass, as the rain lens is.
	 */
	scale: number;
	/** Multiplier on the refraction offset. 0 keeps the frost but stops it bending. */
	refraction: number;
	/**
	 * Mip level sampled through fully-formed frost. Much higher than the rain lens's glass
	 * blur, because ice genuinely is close to opaque -- but it only ever reaches this at
	 * mask 1, which by construction is the corners of the frame.
	 */
	frostBlur: number;
	/** How far toward the ice colour a fully frosted pixel is milked. */
	milk: number;
	/** How brightly the crystal filaments themselves catch the light. */
	sparkle: number;
	/** Ceiling on the linear value the lens is allowed to SAMPLE. See rainLens.ts. */
	inputClamp: number;
};

export const snowLensEffect: EffectDef<SnowLensParams> = {
	id: 'snowLens',
	label: 'Snow Lens',
	role: 'chain',
	order: 37,
	requires: [],
	params: () => ({
		scale: 1,
		refraction: 0.4,
		frostBlur: 3.4,
		milk: 0.45,
		sparkle: 0.55,
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

		/**
		 * Ridged fractal noise: fbm folded about zero, so its zero crossings become thin
		 * bright filaments. See the header on why this and not plain fbm.
		 *
		 * A plain function rather than an `Fn`, because it contains no assignment and so
		 * needs no stack to record into (layers/skyLayer.ts). `mx_fractal_noise_float` brings
		 * its own. The position is lifted to vec3 explicitly: only `mx_noise_float` declares
		 * the `vec2|vec3` conversion, the fractal variant does not.
		 */
		const ridged = (p: any, frequency: number, octaves: number) =>
			mx_fractal_noise_float(vec3(p.mul(frequency), 0), octaves, 2, 0.55, 1)
				.abs()
				.oneMinus()
				.clamp(0, 1);

		/**
		 * The frost field at a point, as (crystal, mask).
		 *
		 * `mask` is coverage -- 0 clear glass, 1 fully iced -- and every visible consequence
		 * of this effect is scaled by it, so the un-frosted middle of the frame is untouched
		 * rather than merely lightly affected. `crystal` is the dendrite structure, already
		 * multiplied by the mask so its gradient carries the edge of the growth front too and
		 * the refraction ramps up with the ice instead of snapping on at its boundary.
		 *
		 * Inside `Fn` so it can be evaluated three times (see the finite differences below)
		 * without three copies of the graph.
		 */
		const Frost = Fn(([p]: [any]): any => {
			// The vignette the front advances against: 0 at the centre, 1 at the top and
			// bottom edges, ~1.9 at the corners of a 16:9 frame. Frost reaches the corners
			// first for free, which is what it does on real glass.
			const edge = p.length().mul(2);

			// The noise domain, and ONLY the noise domain -- see `uPatternOffset` on why the
			// vignette above reads the un-offset `p`.
			const q = p.add(uPatternOffset);

			// Lobes. Without this the front is a perfect circle closing in, which reads as a
			// vignette effect rather than as something growing.
			const lobes = mx_fractal_noise_float(vec3(q.mul(4.5), 0), 3, 2, 0.5, 1);

			// At growth 0 the level sits past the far corners (2.7 against a maximum of about
			// 1.9 + 0.55) so the glass is genuinely clear, not faintly hazed; at growth 1 it
			// has swept beyond the centre.
			const front = float(2.7).sub(uGrowth.mul(2.9));
			const mask = smoothstep(float(0), float(0.5), edge.add(lobes.mul(0.55)).sub(front));

			// Fine needles over coarse plates. The powers sharpen the ridges: without them
			// `1 - |fbm|` is a fat band around each zero crossing and the result is closer to
			// marble than to ice.
			const needles = ridged(q, 24, 3);
			const plates = ridged(q, 7.5, 3);
			const crystal = pow(needles, float(3))
				.mul(0.8)
				.add(pow(plates, float(2)).mul(0.4));

			return vec2(crystal.mul(mask), mask);
		});

		// The pattern lives in aspect-corrected space centred on the frame, so the crystals
		// are square on screen and the vignette is a real distance rather than a stretched
		// one. No y flip here: unlike the rain lens this is not a port of a Shadertoy shader,
		// so there is no foreign convention to reconcile and noise does not care about the
		// sign.
		const aspect = screenSize.x.div(screenSize.y);
		const patternUV = screenUV.sub(0.5).mul(vec2(aspect, 1)).mul(u.scale);

		// Normals by finite difference, and unlike the rain lens this is a free choice rather
		// than a forced one: the field is smooth fbm with no `floor`/`fract` grids in it, so
		// `dFdx`/`dFdy` would be well-behaved here. Finite differences are used anyway because
		// they are resolution-independent -- a screen-space derivative makes the refraction
		// strength depend on the display's pixel density, and `refraction` would have to be
		// retuned per monitor.
		const e = float(0.0015);
		const c = Frost(patternUV).toVar();
		const cx = Frost(patternUV.add(vec2(e, 0))).x;
		const cy = Frost(patternUV.add(vec2(0, e))).x;
		const n = vec2(cx.sub(c.x), cy.sub(c.x)).mul(u.refraction);

		// Blur rides coverage, so it is heaviest in the corners and absent in the clear
		// middle. There is no counterpart to the rain lens's `dropBlur` -- water drops are
		// lenses and resolve a sharper image than the film around them, but there is nothing
		// you can see clearly THROUGH ice.
		const focus = c.y.mul(u.frostBlur);

		// The mip source. See rainLens.ts on why this is configured in place rather than
		// through `.sample()` / `.level()`.
		const clamped = vec4(ctx.color.rgb.min(vec3(u.inputClamp)), ctx.color.a);
		const frame: any = ctx.track(
			rtt(clamped, null, null, {
				type: HalfFloatType,
				generateMipmaps: true,
				minFilter: LinearMipmapLinearFilter
			})
		);
		frame.uvNode = screenUV.add(n);
		frame.levelNode = focus;

		// Ice scatters rather than absorbs: milk the frame toward the ice colour by coverage,
		// then lay the lit crystal filaments over the top. The second term is what keeps the
		// frost from reading as a smear -- it is the only part with any structure in it once
		// the blur has taken the frame apart.
		const frosted = mix(frame.rgb, uIce, c.y.mul(u.milk)).add(uIce.mul(c.x.mul(u.sparkle)));

		// Coverage IS the blend -- the mesh's `opacityNode`, written out. The ceiling keeps a
		// little of the untouched (and unclamped) frame in even at the densest corner.
		return mix(ctx.color, vec4(frosted, ctx.color.a), c.y.mul(0.92));
	}
};
