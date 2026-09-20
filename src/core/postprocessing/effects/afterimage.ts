// Afterimage — three's AfterImageNode as a chain effect. BRIGHT-PASS feedback (only
// pixels above ~0.1 linear persist, multiplied by `damp`), not a full-frame mix — see
// postprocessing/CLAUDE.md for the always-on-at-damp-0 rationale.
//   damp = clamp(panel damp + uAfterimageBoost, 0, 0.96)

import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { uniform } from 'three/tsl';
import type { EffectDef } from '../types';

export type AfterimageParams = {
	/** Standing damp floor, 0…0.99 — the rest-of-the-time trail level. */
	damp: number;
};

/**
 * Runtime damp modulation, 0…~0.9 — adds onto the panel's `damp` floor. Module-scope
 * `uniform()` so identity survives rebuilds; written per frame by a scene-side driver
 * (e.g. TestGame's CarAfterimage.svelte), 0 with no driver mounted.
 */
export const uAfterimageBoost = uniform(0);

/** Ceiling on floor + boost — addon docs say [0,1]; 0.96 stays safely below runaway feedback. */
const DAMP_MAX = 0.96;

export const afterimageEffect: EffectDef<AfterimageParams> = {
	id: 'afterimage',
	label: 'Afterimage',
	role: 'chain',
	order: 45,
	requires: [],
	note: 'Bright-pixel feedback trails. Damp is the standing floor; runtime drivers (TestGame nitrous) add on top.',
	params: () => ({ damp: 0 }),
	defaultEnabled: true,
	ranges: { damp: { min: 0, max: 0.99, step: 0.01 } },
	build: (ctx, u) => afterImage(ctx.color, u.damp.add(uAfterimageBoost).min(DAMP_MAX))
};
