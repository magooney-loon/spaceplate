// Anamorphic streaks — thin HORIZONTAL bloom off screen highlights (headlights, chrome,
// the sun/moon disc): the "sci-fi lens" look, and the one item the "Not built" list in
// CLAUDE.md named. Same BloomNode addon `bloom.ts` uses, but with its `highPassFn`
// overridden to stretch the bright-pass sideways at EXTRACTION time instead of blurring
// it isotropically over five mips — three's own `webgpu_postprocessing_anamorphic`
// example. A second, independent BloomNode instance: `highPassFn` is per-instance state,
// and the main bloom effect needs the stock (radial) extraction for its own look.
//
// Reads `ctx.color` post-bloom (order 41, right after bloom's 40) rather than sharing
// bloom's own bright-pass — an independent threshold means a scene with bloom disabled
// still gets streaks, and the two effects' thresholds mean different things (bloom's
// picks a glow radius, this one picks which highlights are worth a line across the frame).

import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import {
	Fn,
	Loop,
	float,
	luminance,
	mix,
	rtt,
	smoothstep,
	uv,
	vec2,
	vec3,
	vec4,
	viewportSize
} from 'three/tsl';
import { MirroredRepeatWrapping } from 'three/webgpu';
import type { EffectDef } from '../types';

export type AnamorphicParams = {
	/** Ceiling on the linear value fed to the streak's own highpass — same prefilter
	 * clamp bloom.ts uses, and for the same reason: the sun disc is ~60800 linear. */
	inputClamp: number;
	strength: number;
	/** Luminance threshold — higher than bloom's global default on purpose: this is for
	 * hotspots (headlights, chrome, the sun), not general scene brightness. */
	threshold: number;
	/** Horizontal reach per sample, in ray-buffer texel multiples. */
	stretch: number;
	/** Loop bound baked into the shader at build time — structural. */
	samples: number;
	tintR: number;
	tintG: number;
	tintB: number;
};

export const anamorphicEffect: EffectDef<AnamorphicParams> = {
	id: 'anamorphic',
	label: 'Anamorphic Streaks',
	role: 'chain',
	order: 41,
	requires: [],
	structural: ['samples'],
	params: () => ({
		inputClamp: 8,
		// Tuned against TestGame: the addon-example defaults (strength 1.5, threshold
		// 0.55) streaked off nearly every lit surface, not just hotspots -- reads as a
		// haze, not a lens artefact. Dropping strength 10x and pushing threshold to
		// where only real hotspots (sun, headlights, chrome) clear it is what makes
		// this an occasional lens accent rather than a filter over everything.
		strength: 0.15,
		threshold: 2,
		stretch: 4,
		samples: 32,
		tintR: 0.65,
		tintG: 0.78,
		tintB: 1
	}),
	// Cheap (a quarter-res bright-pass and one unlatched horizontal loop) and, at these
	// tuned defaults, restrained enough to leave on: only real hotspots clear the
	// threshold, so a scene with none in frame shows nothing.
	defaultEnabled: true,
	ranges: {
		inputClamp: { min: 0.5, max: 64, step: 0.5 },
		strength: { min: 0, max: 3, step: 0.01 },
		// Headroom above the old ceiling (2) -- the tuned default now sits at it.
		threshold: { min: 0, max: 3, step: 0.01 },
		stretch: { min: 0.5, max: 12, step: 0.25 },
		samples: { min: 8, max: 96, step: 2 },
		tintR: { min: 0, max: 1, step: 0.01 },
		tintG: { min: 0, max: 1, step: 0.01 },
		tintB: { min: 0, max: 1, step: 0.01 }
	},
	note: 'Thin horizontal lens streaks off bright highlights — headlights, chrome, the sun disc. A second bloom pass with a custom horizontal-only highpass (three’s webgpu_postprocessing_anamorphic recipe), tinted and added on top. Threshold picks what counts as a highlight; Stretch/Samples shape the line.',
	build: (ctx, u) => {
		const streakNode: any = ctx.track(bloom(ctx.color, u.strength, 0, u.threshold));
		streakNode.setResolutionScale(0.25);

		// Loop bound must be a JS number at build time (structural), same rule as
		// godrays.ts's blurSigma/blurTolerance.
		const sampleCount = u.samples.value;
		const half = sampleCount / 2;

		// `rtt()` owns a render target the addon class doesn't know to dispose (same
		// "RTTNode has no dispose()" trap as godrays.ts's convertToTexture). The target
		// is only created once BloomNode's setup() actually CALLS this Fn — which
		// happens on first build, not synchronously here — so the reference is captured
		// through the closure and read lazily by the track() below, after it exists.
		let brightTarget: any = null;

		streakNode.highPassFn = Fn(({ input, threshold, smoothWidth }: any) => {
			// Clamp before extraction — an unclamped HDR highlight (the sun disc, a
			// headlight's raw emissive) would streak far past any sane `threshold`.
			const clamped = vec4(input.rgb.min(vec3(u.inputClamp)), input.a);
			const v = luminance(clamped.rgb);
			const alpha = smoothstep(threshold, threshold.add(smoothWidth), v);
			// Materialised as a real texture (not a per-fragment expression) so it can be
			// sampled at SHIFTED uvs below — a procedural node has no arbitrary-uv sample.
			const brightPass = rtt(mix(vec4(0), clamped, alpha), null, null, {
				wrapS: MirroredRepeatWrapping,
				wrapT: MirroredRepeatWrapping
			});
			brightTarget = brightPass;

			const total = vec4(0).toVar();
			// `viewportSize` is `viewport.zw` (a vec4 swizzle) — the addon's loose `.d.ts`
			// doesn't carry that through, and TSL's own "anytype x anytype: widen to the
			// greater length vector" promotion rule (postprocessing/CLAUDE.md) then
			// infers vec3 downstream of it. `any` all the way through this local, same
			// cast-at-the-call-site rule as `godrays.ts`'s light cast: the type system is
			// wrong here, not the graph.
			const invSize: any = vec2(1).div(viewportSize as any);

			Loop({ start: -half, end: half }, ({ i }: any) => {
				// Tapers to 0 at the ends of the reach so the streak fades rather than
				// cuts off — squared for a tighter core, same shape as the addon example.
				const softness = float(i).abs().div(half).oneMinus().pow(2);
				const shiftedUv = vec2(uv().x.add(invSize.x.mul(i).mul(u.stretch)), uv().y);
				total.addAssign(brightPass.sample(shiftedUv).mul(softness));
			});

			return total.div(float(sampleCount).div(3));
		});

		ctx.track({ dispose: () => brightTarget?.renderTarget?.dispose() });

		const tint = vec3(u.tintR, u.tintG, u.tintB);
		return ctx.color.add(streakNode.mul(tint));
	}
};
