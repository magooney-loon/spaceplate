import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import type { EffectDef } from '../types';

export type AfterimageParams = {
	damp: number;
};

export const afterimageEffect: EffectDef<AfterimageParams> = {
	id: 'afterimage',
	label: 'Afterimage',
	role: 'chain',
	order: 45,
	requires: [],
	note: 'Feedback buffer — may smear under temporal AA.',
	params: () => ({ damp: 0.96 }),
	ranges: { damp: { min: 0, max: 0.99, step: 0.01 } },
	build: (ctx, u) => afterImage(ctx.color, u.damp)
};
