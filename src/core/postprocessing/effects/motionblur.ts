import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { int } from 'three/tsl';
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
	build: (ctx, u) => motionBlur(ctx.color, ctx.velocity.mul(u.blurAmount), int(u.numSamples))
};
