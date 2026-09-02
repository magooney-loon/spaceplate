// Bloom — additive. Lensflare lives here as a sub-toggle rather than a sibling
// effect because LensflareNode literally samples the bloom buffer (no bloom, no
// flare) — mirroring three.js webgpu_postprocessing_lensflare:
//   output = color + bloom + gaussianBlur(lensflare(bloom))
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import type { EffectDef } from '../types';

export type BloomParams = {
	strength: number;
	radius: number;
	threshold: number;
	/** 0 = off, 1 = on. Structural — toggling adds/removes the flare nodes. */
	lensflare: number;
	/** Brightness gate for flares — higher means smaller, tighter ghosts. */
	flareThreshold: number;
	/** Ghost spacing along the vector through the screen center. */
	ghostSpacing: number;
	/** Ghost edge falloff — higher keeps ghosts closer to their bright spots. */
	ghostAttenuation: number;
	/** Ghosts per bright spot. Structural — the shader loop count. */
	ghostSamples: number;
};

export const bloomEffect: EffectDef<BloomParams> = {
	id: 'bloom',
	label: 'Bloom',
	role: 'chain',
	order: 40,
	requires: [],
	params: () => ({
		strength: 0.05,
		radius: 0,
		threshold: 0,
		lensflare: 1,
		flareThreshold: 0.27,
		ghostSpacing: 0.25,
		ghostAttenuation: 6.5,
		ghostSamples: 3
	}),
	defaultEnabled: true,
	structural: ['lensflare', 'ghostSamples'],
	options: {
		lensflare: [
			{ value: 0, text: 'Off' },
			{ value: 1, text: 'On' }
		]
	},
	ranges: {
		strength: { min: 0, max: 3, step: 0.05 },
		radius: { min: 0, max: 1, step: 0.01 },
		threshold: { min: 0, max: 2, step: 0.01 },
		flareThreshold: { min: 0, max: 1, step: 0.01 },
		ghostSpacing: { min: 0, max: 0.3, step: 0.005 },
		ghostAttenuation: { min: 1, max: 50, step: 0.5 },
		ghostSamples: { min: 1, max: 8, step: 1 }
	},
	note: 'Lensflare ghosts feed on the bloom buffer — keep strength > 0 or the flare has nothing to sample.',
	build: (ctx, u) => {
		const bloomNode = ctx.track(bloom(ctx.color, u.strength, u.radius, u.threshold));
		if (u.lensflare.value < 0.5) return ctx.color.add(bloomNode);

		// These own render targets — ctx.track or a rebuild leaks them.
		const flare = ctx.track(
			lensflare(bloomNode, {
				threshold: u.flareThreshold,
				ghostSpacing: u.ghostSpacing,
				ghostAttenuationFactor: u.ghostAttenuation,
				ghostSamples: u.ghostSamples
			})
		);
		// Blur softens the ghosts (sampled at 1/4 res) — same wiring as the example.
		const blurred = ctx.track(gaussianBlur(flare, 8));
		return ctx.color.add(bloomNode).add(blurred);
	}
};
