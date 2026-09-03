// The "basic" DoF — composed by hand, not the bokeh DepthOfFieldNode (dropped for
// performance: one box blur vs its multi-pass kernel). Mirrors
// webgpu_postprocessing_dof_basic: mix(color, boxBlur(color), smoothstep(min, max,
// |viewZ + focus|)). boxBlur is a plain TSL Fn (no render targets) whose loops take
// uniform bounds, so every param here stays hot — no structural keys, no rebuilds.
import { mix, smoothstep } from 'three/tsl';
import { boxBlur } from 'three/addons/tsl/display/boxBlur.js';
import type { EffectDef } from '../types';

export type DofParams = {
	/** View-space distance in front of the camera that stays sharp. */
	focus: number;
	/** |viewZ − focus| at/below this is completely in focus. */
	minDistance: number;
	/** |viewZ − focus| at/beyond this is completely out of focus. */
	maxDistance: number;
	/** Box blur kernel — keep in [1, 3]; samples grow as (size*2+1)^2. */
	blurSize: number;
	/** Box blur spread — widens the blur for free (no extra samples). */
	blurSpread: number;
};

export const dofEffect: EffectDef<DofParams> = {
	id: 'dof',
	label: 'Depth of Field',
	role: 'chain',
	order: 30,
	requires: ['viewZ'],
	params: () => ({ focus: 55.7, minDistance: 50, maxDistance: 200, blurSize: 1, blurSpread: 1 }),
	ranges: {
		focus: { min: 0.1, max: 100, step: 0.1 },
		minDistance: { min: 0, max: 50, step: 0.1 },
		maxDistance: { min: 0.5, max: 200, step: 0.5 },
		blurSize: { min: 1, max: 3, step: 1 },
		blurSpread: { min: 1, max: 7, step: 1 }
	},
	note: 'Basic DoF — one box blur mixed in by distance from the focus plane (world units). Widen min/maxDistance for a deeper sharp band; keep max > min.',
	// viewZ comes from basePass.getViewZNode() — derived from depth, no MRT attachment.
	// viewZ is negative in front of the camera, hence add() against the positive focus.
	build: (ctx, u) => {
		const blurred = boxBlur(ctx.color, { size: u.blurSize, separation: u.blurSpread });
		const blur = smoothstep(u.minDistance, u.maxDistance, ctx.viewZ.add(u.focus).abs());
		return mix(ctx.color, blurred, blur);
	}
};
