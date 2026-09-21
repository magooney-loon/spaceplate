// The one effect implemented by hand — the template for future custom TSL effects.
// Written rather than imported because the addon version (CRT.js) measures distance
// in raw uv space: always a viewport ellipse, never a true circle. Placement: late
// chain, pre-tonemap (before tone mapping = real lens falloff; after = crushed
// shadows).

import { Fn, uv, vec2, vec4, float, length, smoothstep, mix } from 'three/tsl';
import type { EffectDef } from '../types';

export type VignetteParams = {
	intensity: number;
	smoothness: number;
	/** 0 = frame-shaped ellipse, 1 = true circle (aspect-corrected). */
	roundness: number;
};

const vignetteFn = Fn(([color, intensity, smoothness, roundness, aspect]: any[], _builder: any) => {
	// roundness 0 keeps uv space (ellipse follows the viewport); 1 corrects x by
	// aspect so the falloff is a true circle.
	const scaleX = mix(float(1), aspect, roundness);
	const dist = length(uv().sub(0.5).mul(vec2(scaleX, 1))).mul(2);

	// 1.42 ≈ √2 so the falloff reaches the frame corners.
	const mask = smoothstep(float(1.42), float(1.42).sub(smoothness), dist);
	const amount = mix(float(1).sub(intensity), float(1), mask);

	// Multiply rgb only; carry alpha through untouched.
	return vec4(color.rgb.mul(amount), color.a);
});

export const vignetteEffect: EffectDef<VignetteParams> = {
	id: 'vignette',
	label: 'Vignette',
	role: 'chain',
	order: 50,
	requires: [],
	params: () => ({ intensity: 0.88, smoothness: 0.8, roundness: 0 }),
	defaultEnabled: true,
	ranges: {
		intensity: { min: 0, max: 1, step: 0.01 },
		smoothness: { min: 0.01, max: 1.4, step: 0.01 },
		roundness: { min: 0, max: 1, step: 0.01 }
	},
	build: (ctx, u) => vignetteFn(ctx.color, u.intensity, u.smoothness, u.roundness, ctx.aspect)
};
