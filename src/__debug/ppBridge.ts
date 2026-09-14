// Console switches for the post-processing pipeline — needed because Studio's
// selection overlay silently kills motion blur (the MRT shader-cache trap, see
// `core/postprocessing/CLAUDE.md`), so toggling effects often has to happen without
// Studio running. Goes through `postprocessingActions`, the same entry point the panel
// calls.
//
//     pp.on('motionBlur')                     // structural — rebuilds the pipeline
//     pp.set('motionBlur', 'blurAmount', 3)   // hot — uniform write, no rebuild
//     pp.off('motionBlur')
//     pp.state.motionBlur                     // current values

import { postprocessingActions, postprocessingState } from '$extensions/postprocessing';
import type { EffectId } from '$extensions/postprocessing';

declare global {
	// eslint-disable-next-line no-var
	var pp: {
		on: (id: EffectId) => void;
		off: (id: EffectId) => void;
		set: (id: EffectId, key: string, value: number) => void;
		state: typeof postprocessingState;
	};
}

export const installPostProcessingBridge = () => {
	globalThis.pp = {
		on: (id) => postprocessingActions.setEnabled(id, true),
		off: (id) => postprocessingActions.setEnabled(id, false),
		set: (id, key, value) => {
			(postprocessingState as any)[id][key] = value;
		},
		state: postprocessingState
	};

	console.log(
		'[DEBUG] pp.on("motionBlur") / pp.off(id) / pp.set("motionBlur","blurAmount",3) / pp.state'
	);
};
