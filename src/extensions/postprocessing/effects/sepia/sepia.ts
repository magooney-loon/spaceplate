import type { BlendFunction } from 'postprocessing';

export interface SepiaState {
	enabled: boolean;
	intensity: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultSepiaState: SepiaState = {
	enabled: false,
	intensity: 1.0,
	blendFunction: 0 as BlendFunction
};

export function createSepiaActions(state: SepiaState) {
	return {
		toggleSepia: () => {
			state.enabled = !state.enabled;
		},
		setSepiaIntensity: (value: number) => {
			state.intensity = value;
		},
		setSepiaBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetSepia: () => {
			state.intensity = defaultSepiaState.intensity;
			state.blendFunction = defaultSepiaState.blendFunction;
		}
	};
}
