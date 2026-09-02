import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { EffectDef } from '../types';

export type SmaaParams = Record<string, never>;

export const smaaEffect: EffectDef<SmaaParams> = {
	id: 'smaa',
	label: 'SMAA',
	role: 'resolve',
	order: 1,
	requires: [],
	params: () => ({}) as SmaaParams,
	defaultEnabled: true,
	// Applies before the output color transform (unlike FXAA) — the default
	// outputColorTransform=true path handles tonemap/sRGB after it.
	build: (ctx) => smaa(ctx.color)
};
