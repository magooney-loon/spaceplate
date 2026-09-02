import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { EffectDef } from '../types';

export type BloomParams = {
	strength: number;
	radius: number;
	threshold: number;
};

export const bloomEffect: EffectDef<BloomParams> = {
	id: 'bloom',
	label: 'Bloom',
	role: 'chain',
	order: 40,
	requires: [],
	params: () => ({ strength: 1, radius: 0, threshold: 0 }),
	ranges: {
		strength: { min: 0, max: 3, step: 0.05 },
		radius: { min: 0, max: 1, step: 0.01 },
		threshold: { min: 0, max: 2, step: 0.01 }
	},
	build: (ctx, u) => ctx.color.add(bloom(ctx.color, u.strength, u.radius, u.threshold))
};
