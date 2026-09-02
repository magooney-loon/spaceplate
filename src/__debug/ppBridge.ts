// Console switches for the post-processing pipeline.
//
// The only UI that drives `postprocessingState` is the Studio panel, and Studio is
// frequently the thing you need to run WITHOUT — its selection overlay is a full-screen
// quad inside the scene pass, and MRT attachments other than `output` do not blend, so
// it overwrites the velocity buffer and silently kills motion blur (see
// DOCS/post-processing.md §8.7). The state is plain `$state` with no persistence, so
// without the panel there is nothing holding an effect on.
//
// This goes through `postprocessingActions`, the same entry point the panel calls — it
// is the real path, not a shortcut around it. Being able to toggle live in one session
// also beats comparing two reloads: flip an effect while something is moving and watch
// the same frame change.
//
//     pp.on('motionBlur')                     // structural — rebuilds the pipeline
//     pp.set('motionBlur', 'blurAmount', 3)   // hot — uniform write, no rebuild
//     pp.off('motionBlur')
//     pp.state.motionBlur                     // current values
//
// Params marked `structural` in the registry (motion blur's `numSamples`, which the
// shader bakes as a loop bound) do rebuild when written — that is the builder working as
// designed, not a bug in the bridge.

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
