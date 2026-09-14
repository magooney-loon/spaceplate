// FROST ON THE LENS -- the snow counterpart to rainLens.ts, deliberately not a recolour of
// it: water beads and runs, ice GROWS. This is a front creeping inward from the frame edges
// (thickest in the corners) that only advances and retreats, never slides. Mechanically the
// same effect and inherits every one of rainLens.ts's constraints (RTT mip source,
// `inputClamp`, dry-lens latch) — read that header first.
//
// Ordered after the rain lens (37 > 36) so during sleet its RTT captures the already-rain-
// lensed frame and the two composite in the right order.
//
// Frost is dendritic (thin branching filaments, not blobs), so the shape is RIDGED noise:
// fractal noise folded about zero, `1 - |fbm|`, puts a bright thin ridge at every zero
// crossing. Two scales — fine needles over coarse plates — is the whole crystal structure.
// Only the ridges need a gradient (for refraction), and only at two octaves each (a third
// octave ran past the pixel grid into shimmer) — down from 27 evaluated octaves/pixel to 14.
//
// The front is a threshold on a vignette (distance from frame centre, perturbed by low-freq
// noise for a lobed edge) against a level `uGrowth` walks inward from the CPU side, slow in
// both directions — ice takes seconds to form and longer to go.
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
	// Tuned DOWN across the board from the first pass, which iced over hard enough to be
	// the dominant thing in the frame. Frost is weather, not a filter: the ceiling on the
	// blend below came down with these (0.92 -> 0.85), and the CPU side got the other half
	// of the fix -- see `standingFrost` / `maxFrost` / `freezeSeconds` in LensDriver.svelte.
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
		 * The dendrite structure alone -- fine needles over coarse plates. The powers sharpen
		 * the ridges: without them `1 - |fbm|` is a fat band around each zero crossing and the
		 * result is closer to marble than to ice.
		 *
		 * Inside `Fn` so it can be evaluated three times (see the finite differences below)
		 * without three copies of the graph.
		 *
		 * TWO OCTAVES EACH, NOT THREE, and the second reason is the better one: at three, the
		 * needle layer's top octave runs at 96 cycles across the frame, which is past what the
		 * pixel grid can resolve -- it was buying shimmer, not detail, and paying a third of
		 * the layer's cost for it.
		 */
		const Crystal = Fn(([q]: [any]): any =>
			pow(ridged(q, 24, 2), float(3))
				.mul(0.8)
				.add(pow(ridged(q, 7.5, 2), float(2)).mul(0.4))
		);

		// ── Coverage: computed ONCE, outside the finite differences ──────────────────
		//
		// This used to live inside the differenced function, so the vignette, the lobe fbm
		// and the smoothstep all ran three times per pixel for a field that is
		// low-frequency by construction. Only the CRYSTAL needs a gradient; the mask's own
		// contribution to it was a soft ramp at the growth edge, and multiplying the
		// finished normal by coverage below keeps that ramp without paying for its
		// derivative. Fullscreen, that is the difference between 27 noise octaves per pixel
		// and 14.

		// The pattern lives in aspect-corrected space centred on the frame, so the crystals
		// are square on screen and the vignette is a real distance rather than a stretched
		// one. No y flip here: unlike the rain lens this is not a port of a Shadertoy shader,
		// so there is no foreign convention to reconcile and noise does not care about the
		// sign.
		const aspect = screenSize.x.div(screenSize.y);
		const patternUV = screenUV.sub(0.5).mul(vec2(aspect, 1)).mul(u.scale);

		// The vignette the front advances against: 0 at the centre, 1 at the top and
		// bottom edges, ~1.9 at the corners of a 16:9 frame. Frost reaches the corners
		// first for free, which is what it does on real glass.
		const edge = patternUV.length().mul(2);

		// The noise domain, and ONLY the noise domain -- see `uPatternOffset` on why the
		// vignette above reads the un-offset position.
		const q = patternUV.add(uPatternOffset);

		// Lobes. Without this the front is a perfect circle closing in, which reads as a
		// vignette effect rather than as something growing.
		const lobes = mx_fractal_noise_float(vec3(q.mul(4.5), 0), 2, 2, 0.5, 1);

		// At growth 0 the level sits past the far corners (2.7 against a maximum of about
		// 1.9 + 0.55) so the glass is genuinely clear, not faintly hazed; at growth 1 it
		// has swept beyond the centre.
		const front = float(2.7).sub(uGrowth.mul(2.9));
		const mask = smoothstep(float(0), float(0.5), edge.add(lobes.mul(0.55)).sub(front)).toVar();

		// Normals by finite difference, and unlike the rain lens this is a free choice rather
		// than a forced one: the field is smooth fbm with no `floor`/`fract` grids in it, so
		// `dFdx`/`dFdy` would be well-behaved here. Finite differences are used anyway because
		// they are resolution-independent -- a screen-space derivative makes the refraction
		// strength depend on the display's pixel density, and `refraction` would have to be
		// retuned per monitor.
		//
		// The offsets go on the NOISE coordinate `q`, which is `patternUV` plus a constant --
		// the same three points, one addition each cheaper.
		const e = float(0.0015);
		const crystal = Crystal(q).toVar();
		const cx = Crystal(q.add(vec2(e, 0)));
		const cy = Crystal(q.add(vec2(0, e)));
		// Coverage scales the finished normal rather than each sample: the growth front's own
		// ramp survives (refraction still comes up with the ice rather than snapping on at its
		// boundary) without differencing the mask to get it.
		const n = vec2(cx.sub(crystal), cy.sub(crystal)).mul(u.refraction).mul(mask);

		// Blur rides coverage, so it is heaviest in the corners and absent in the clear
		// middle. There is no counterpart to the rain lens's `dropBlur` -- water drops are
		// lenses and resolve a sharper image than the film around them, but there is nothing
		// you can see clearly THROUGH ice.
		const focus = mask.mul(u.frostBlur);

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
		const frosted = mix(frame.rgb, uIce, mask.mul(u.milk)).add(
			uIce.mul(crystal.mul(mask).mul(u.sparkle))
		);

		// Coverage IS the blend -- the mesh's `opacityNode`, written out. The ceiling keeps a
		// little of the untouched (and unclamped) frame in even at the densest corner, and it
		// came down with the rest of the tuning: at 0.92 a full corner was effectively opaque.
		return mix(ctx.color, vec4(frosted, ctx.color.a), mask.mul(0.85));
	}
};
