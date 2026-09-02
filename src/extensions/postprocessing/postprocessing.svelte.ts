// Post-processing state — the new effect set per DOCS/post-processing.md. The
// pmndrs-era catalogue and the preset/localStorage layer are gone; defaults come
// from the registry so state, builder and panel can never drift apart.

import { logPostprocessing } from '$extensions/logger';
import { EFFECTS, EFFECTS_BY_ID } from '$core/postprocessing/registry';
import type { EffectId, PostProcessingState } from './types';

export type { EffectId, PostProcessingState, ExtensionState, ExtensionActions } from './types';

const defaultState = (): PostProcessingState => {
	const state = {} as PostProcessingState;
	for (const def of EFFECTS) {
		(state as any)[def.id] = { enabled: def.defaultEnabled ?? false, ...def.params() };
	}
	return state;
};

export const postprocessingState = $state<PostProcessingState>(defaultState());

export const postprocessingActions = {
	/**
	 * Enable/disable one effect. Base passes and AA are mutually exclusive
	 * alternatives — enabling one disables its siblings so the UI never offers an
	 * illegal combination (the builder still guards, this is just friendlier).
	 */
	setEnabled(id: EffectId, on: boolean) {
		const def = EFFECTS_BY_ID.get(id);
		if (!def) return;
		(postprocessingState as any)[id].enabled = on;
		if (on && (def.role === 'base' || def.role === 'resolve')) {
			for (const other of EFFECTS) {
				if (other.id !== id && other.role === def.role) {
					(postprocessingState as any)[other.id].enabled = false;
				}
			}
		}
		logPostprocessing.info(`${def.label} ${on ? 'enabled' : 'disabled'}`);
	},

	/** Reset one effect's params to registry defaults, keeping its enabled flag. */
	resetEffect(id: EffectId) {
		const def = EFFECTS_BY_ID.get(id);
		if (!def) return;
		const settings = (postprocessingState as any)[id];
		const defaults = def.params();
		for (const key of Object.keys(defaults)) settings[key] = defaults[key];
		logPostprocessing.info(`Reset effect: ${id}`);
	},

	/** Reset everything back to registry defaults (default-enabled effects come back on). */
	resetAll() {
		const defaults = defaultState();
		for (const id of Object.keys(defaults) as EffectId[]) {
			(postprocessingState as any)[id] = defaults[id];
		}
		logPostprocessing.info('All effects reset to defaults');
	}
};
