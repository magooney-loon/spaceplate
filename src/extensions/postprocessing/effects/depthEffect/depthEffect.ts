import type { BlendFunction } from 'postprocessing';

export interface DepthEffectState {
	enabled: boolean;
	inverted: boolean;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultDepthEffectState: DepthEffectState = {
	enabled: false,
	inverted: false,
	blendFunction: 0 as BlendFunction
};

export function createDepthEffectActions(state: DepthEffectState) {
	return {
		toggleDepthEffect: () => {
			state.enabled = !state.enabled;
		},
		setDepthEffectInverted: (value: boolean) => {
			state.inverted = value;
		},
		setDepthEffectBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetDepthEffect: () => {
			state.inverted = defaultDepthEffectState.inverted;
			state.blendFunction = defaultDepthEffectState.blendFunction;
		}
	};
}
