import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { convertToTexture, int } from 'three/tsl';
import type { EffectDef } from '../types';

export type MotionBlurParams = {
	/** Loop count — baked by the shader compiler, so structural. */
	numSamples: number;
	/** Smear width, as a fraction of scene motion per frame AT THE REFERENCE RATE (60fps,
	 * `build.ts`) — `ctx.shutterScale` is what makes that true regardless of actual frame rate. */
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
	// The one sampler addon that does NOT convertToTexture its input — fed a computed
	// chain node it throws "inputNode.sample is not a function". Convert here: texture
	// inputs pass through at zero cost, computed ones get an RTT.
	build: (ctx, u) => {
		const input = convertToTexture(ctx.color);
		// RTTNode owns a render target but has no dispose() — register the target
		// itself so a rebuild frees it. When the input was already a texture this
		// is the base pass's target, which the builder already owns — skip.
		if (input !== (ctx.color as unknown)) {
			ctx.track({ dispose: () => (input as any).renderTarget.dispose() });
		}
		// `shutterScale` is not optional: `ctx.velocity` is a raw PER-FRAME NDC delta, so
		// without it the smear scales with frame rate, not scene motion. See BuildContext.shutterScale.
		return motionBlur(
			input,
			ctx.velocity.mul(u.blurAmount).mul(ctx.shutterScale),
			int(u.numSamples)
		);
	}
};
