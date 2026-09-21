import { retroPass } from 'three/addons/tsl/display/RetroPassNode.js';
import type { EffectDef } from '../types';

export type RetroParams = Record<string, never>;

export const retroEffect: EffectDef<RetroParams> = {
	id: 'retro',
	label: 'Retro',
	role: 'base',
	order: 2,
	requires: [],
	supportsMRT: false,
	note: 'Quarter-res CRT look with internal dithering and colour crush.',
	params: () => ({}) as RetroParams,
	// RetroPassNode quantises and dithers internally at 0.25 resolution scale; it
	// does not bundle a vignette, so no conflict with our own.
	build: (ctx) => retroPass(ctx.scene, ctx.camera)
};
