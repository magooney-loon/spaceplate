import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import type { EffectDef } from '../types';

export type FxaaParams = Record<string, never>;

export const fxaaEffect: EffectDef<FxaaParams> = {
	id: 'fxaa',
	label: 'FXAA',
	role: 'resolve',
	order: 2,
	requires: [],
	// FXAA detects edges by luma on sRGB, so it needs post-tonemap input. It used to
	// disable outputColorTransform and call renderOutput() itself; the builder now owns
	// that for the whole pipeline, because the LUT effect wants the same input and two
	// effects each calling renderOutput() would tone-map the frame twice.
	displayColor: true,
	note: 'Low-cost AA — the fallback when SMAA is too expensive.',
	params: () => ({}) as FxaaParams,
	build: (ctx) => fxaa(ctx.color)
};
