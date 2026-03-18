import type { BlendFunction } from 'postprocessing';

export interface NoiseState {
	enabled: boolean;
	premultiply: boolean;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultNoiseState: NoiseState = {
	enabled: false,
	premultiply: false,
	blendFunction: 28 as BlendFunction
};

export function createNoiseActions(state: NoiseState) {
	return {
		toggleNoise: () => {
			state.enabled = !state.enabled;
		},
		setNoiseBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetNoise: () => {
			state.premultiply = defaultNoiseState.premultiply;
			state.blendFunction = defaultNoiseState.blendFunction;
		}
	};
}
