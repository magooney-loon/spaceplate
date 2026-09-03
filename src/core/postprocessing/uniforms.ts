// The uniform bag — see "Rebuild discipline" in CLAUDE.md. Every numeric param becomes a
// `uniform()` owned by the pipeline, never a raw number handed to a node factory.
// That keeps a handle for in-place animation and sidesteps the addon .d.ts
// inconsistency about which arguments accept nodes.
//
// Structural params (loop counts, texture sizes) still flow through the bag so
// there is one code path — they are simply also keyed into the rebuild decision.

import { uniform } from 'three/tsl';
import type { EffectParams, UniformBag } from './types';

export const createUniformBag = <P extends EffectParams>(values: P): UniformBag<P> => {
	const bag = {} as UniformBag<P>;
	for (const key of Object.keys(values) as (keyof P & string)[]) {
		bag[key] = uniform(values[key]) as UniformBag<P>[keyof P];
	}
	return bag;
};

/** In-place value write — the hot path. Never disposes or rebuilds anything. */
export const writeUniformBag = <P extends EffectParams>(
	bag: UniformBag<P>,
	values: Partial<P>
): void => {
	for (const key of Object.keys(values) as (keyof P & string)[]) {
		const node = bag[key];
		if (node) node.value = values[key]!;
	}
};
