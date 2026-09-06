// Afterimage — three's AfterImageNode as a chain effect. The node is a BRIGHT-PASS
// feedback buffer, not a full-frame mix: only pixels above ~0.1 linear in the OLD
// frame persist (multiplied by `damp`, combined with `max`), so what trails is
// bright stuff — the sun, emissives, and (the reason this exists) the nitrous
// flames' bloom glow. At damp 0 it is an exact passthrough.
//
// DEFAULT ON, FULLY DOWN: `enabled` defaults true and `damp` defaults 0 — the
// effect is in the graph from boot but contributes nothing until something
// drives the boost uniform below. That is deliberately NOT the rainLens pattern
// (a `structuralTag` latch that adds/removes the effect as activity comes and
// goes): every latch flip is a graph rebuild, and a rebuild mid-driving — per
// nitrous burst — is a hitch. The always-on cost is one fullscreen composite
// fetch per frame at damp 0, which is the price of a hitch-free smear.
//
// The DAMP is a floor plus a runtime term:
//   damp = clamp(panel damp + uAfterimageBoost, 0, 0.96)
// The panel param is the STANDING floor (trails you want at rest); the boost is
// written per frame by a scene-side driver (the lensState pattern — the effect
// samples a shared uniform, the driver owns its meaning). TestGame's nitrous
// driver (NitrousAfterimage.svelte) is the first writer. 0.96 is the ceiling so
// the feedback can never run away, and matches the addon example's classic full
// setting.

import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { uniform } from 'three/tsl';
import type { EffectDef } from '../types';

export type AfterimageParams = {
	/** Standing damp floor, 0…0.99 — the rest-of-the-time trail level. */
	damp: number;
};

/**
 * Runtime damp modulation, 0…~0.9 — adds onto the panel's `damp` floor inside
 * the shader (the `lensState` contract: a module-scope `uniform()` so its
 * identity survives pipeline rebuilds; ONE class of writer — a scene-side
 * driver — and one reader, this effect). Written per frame, never through the
 * param bag. 0 from every scene that has no driver mounted.
 */
export const uAfterimageBoost = uniform(0);

/** Ceiling on floor + boost — the addon's docs say [0,1]; 0.96 is the example's
 * classic full setting and safely below runaway feedback. */
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
