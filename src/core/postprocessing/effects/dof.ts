import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import type { EffectDef } from '../types';

export type DofParams = {
	focusDistance: number;
	focalLength: number;
	bokehScale: number;
};

export const dofEffect: EffectDef<DofParams> = {
	id: 'dof',
	label: 'Depth of Field',
	role: 'chain',
	order: 30,
	requires: ['viewZ'],
	params: () => ({ focusDistance: 1, focalLength: 1, bokehScale: 1 }),
	ranges: {
		focusDistance: { min: 0.1, max: 50, step: 0.1 },
		focalLength: { min: 0.1, max: 20, step: 0.1 },
		bokehScale: { min: 0, max: 8, step: 0.1 }
	},
	// viewZ comes from basePass.getViewZNode() — derived from depth, no MRT attachment.
	build: (ctx, u) => dof(ctx.color, ctx.viewZ, u.focusDistance, u.focalLength, u.bokehScale)
};
