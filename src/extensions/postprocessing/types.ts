// Post-processing extension types. The state shape is DERIVED from the registry
// (`EFFECT_REGISTRY` → `EffectId` + `EffectParamMap`), so adding an effect needs no edit
// here and the UI's shape cannot drift from the builder's. It did drift, before this was
// derived: `ao`, `rainLens` and `snowLens` shipped without ever reaching the state type,
// which nothing caught because every access goes through an `as any`.

import type { EffectId, EffectParamMap } from '$core/postprocessing/registry';

export const extensionScope = 'postprocessing';

export type { EffectId };

export type PostProcessingState = {
	[K in EffectId]: { enabled: boolean } & EffectParamMap[K];
};

export type ExtensionState = PostProcessingState;
export type ExtensionActions = typeof import('./postprocessing.svelte').postprocessingActions;
