import { onDestroy } from 'svelte';
import { activateInputMap } from './input.svelte';
import type { InputMap, SlotRecord } from './types';

/**
 * Activate a map for as long as the calling component is mounted, and hand the
 * same handle straight back for convenience:
 *
 * ```svelte
 * const controls = useInputMap(carControls);
 * ```
 *
 * Call it during component init like any hook. Non-component callers use
 * `activateInputMap`, which returns the disposer directly.
 */
export const useInputMap = <S extends SlotRecord>(map: InputMap<S>): InputMap<S> => {
	onDestroy(activateInputMap(map as InputMap<SlotRecord>));
	return map;
};
