import { ssaaPass } from 'three/addons/tsl/display/SSAAPassNode.js';
import type { EffectDef } from '../types';

export type SsaaParams = Record<string, never>;

export const ssaaEffect: EffectDef<SsaaParams> = {
	id: 'ssaa',
	label: 'SSAA',
	role: 'base',
	order: 0,
	requires: [],
	supportsMRT: false,
	note: 'Supersampling — the most expensive AA, needs no post chain.',
	params: () => ({}) as SsaaParams,
	build: (ctx) => ssaaPass(ctx.scene, ctx.camera)
};
