// The uniform bag — the hot-update path; discipline in ./CLAUDE.md ("Rebuild
// discipline"). Every numeric param becomes a `uniform()` owned by the pipeline,
// never a raw number handed to a node factory. Structural params (loop counts,
// texture sizes) flow through here too — one code path; they are just also keyed
// into the rebuild decision.

import { uniform } from 'three/tsl';
import type { EffectParams, UniformBag } from './types';

export const createUniformBag = <P extends EffectParams>(values: P): UniformBag<P> => {
	const bag = {} as UniformBag<P>;
	for (const key of Object.keys(values) as (keyof P & string)[]) {
		bag[key] = uniform(values[key]) as UniformBag<P>[keyof P];
	}
	return bag;
};

/**
 * In-place value write — the hot path. Never disposes or rebuilds anything. `values`
 * may carry keys the bag does not (a removed param, the `enabled` flag); those are
 * skipped. Returns whether anything was written, so a caller sweeping several bags can
 * `invalidate()` once for the lot instead of per effect.
 */
export const writeUniformBag = <P extends EffectParams>(
	bag: UniformBag<P>,
	values: Partial<P>
): boolean => {
	let wrote = false;
	for (const key of Object.keys(values) as (keyof P & string)[]) {
		const node = bag[key];
		if (!node) continue;
		node.value = values[key]!;
		wrote = true;
	}
	return wrote;
};
