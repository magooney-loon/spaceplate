import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { texture3D } from 'three/tsl';
import type { EffectDef } from '../types';
import { LUT_CATALOGUE, ensureLutLoaded, getLutTexture, lutState } from '../luts.svelte';

export type LutParams = {
	/** Index into LUT_CATALOGUE — a choice, not a magnitude. Structural: it swaps the texture. */
	lut: number;
	/** 0 = ungraded, 1 = the LUT at full strength. */
	intensity: number;
};

export const lutEffect: EffectDef<LutParams> = {
	id: 'lut',
	label: '3D LUT',
	role: 'grade',
	order: 10,
	requires: [],
	// `.cube` LUTs are authored against a display image, so this needs tone-mapped,
	// encoded colour rather than the linear values the chain carries. The builder folds
	// in the single renderOutput() — see EffectDef.displayColor.
	displayColor: true,
	structural: ['lut'],
	// The graph is built AROUND the texture, so a load landing (or a different LUT being
	// picked) has to recompile rather than write a uniform.
	structuralTag: () => lutState.version,
	options: { lut: LUT_CATALOGUE.map(({ value, text }) => ({ value, text })) },
	ranges: {
		lut: { min: 0, max: LUT_CATALOGUE.length - 1, step: 1 },
		intensity: { min: 0, max: 1, step: 0.01 }
	},
	note: "three's nine example LUTs. Drop more into public/luts/ and append to LUT_CATALOGUE.",
	params: () => ({ lut: 0, intensity: 1 }),
	build: (ctx, u) => {
		const index = Math.round(u.lut.value);
		const map = getLutTexture(index);
		if (!map) {
			// Not loaded yet (or failed). Kick the load and pass colour through untouched
			// — when it lands, lutState.version bumps and the structural key rebuilds us
			// properly. Returning ctx.color here is a no-op fold, NOT the error fallback.
			ensureLutLoaded(index);
			return ctx.color;
		}
		// `size` is the cube's edge length, which Lut3DNode bakes into the sample maths;
		// it comes from the texture, never from a param.
		return lut3D(ctx.color, texture3D(map), map.image.width, u.intensity);
	}
};
