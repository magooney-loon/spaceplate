import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { convertToTexture, int } from 'three/tsl';
import type { EffectDef } from '../types';

export type MotionBlurParams = {
	/** Loop count — baked by the shader compiler, so structural. */
	numSamples: number;
	blurAmount: number;
};

export const motionBlurEffect: EffectDef<MotionBlurParams> = {
	id: 'motionBlur',
	label: 'Motion Blur',
	role: 'chain',
	order: 35,
	requires: ['velocity'],
	structural: ['numSamples'],
	params: () => ({ numSamples: 9, blurAmount: 0.25 }),
	defaultEnabled: true,
	ranges: {
		numSamples: { min: 4, max: 64, step: 1 },
		blurAmount: { min: 0, max: 4, step: 0.05 }
	},
	// A TSL Fn, not a node class — no instance to hold uniforms on, so the bag is
	// the only way to animate it. The example multiplies velocity by a blur scale.
	//
	// motionBlur is the one sampler addon that does NOT convertToTexture its input
	// (bloom/fxaa/smaa/afterImage all do) — fed a computed chain node (the basic
	// DoF's mix, the old bokeh DoF's output, ...) it throws
	// "inputNode.sample is not a function". Convert here: texture inputs pass
	// through untouched at zero cost, computed ones get an RTT.
	build: (ctx, u) => {
		const input = convertToTexture(ctx.color);
		// RTTNode owns a render target but has no dispose() — register the target
		// itself so a rebuild frees it. When the input was already a texture this
		// is the base pass's target, which the builder already owns — skip.
		if (input !== (ctx.color as unknown)) {
			ctx.track({ dispose: () => (input as any).renderTarget.dispose() });
		}
		return motionBlur(input, ctx.velocity.mul(u.blurAmount), int(u.numSamples));
	}
};
