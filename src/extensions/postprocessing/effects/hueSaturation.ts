import type { BlendFunction } from 'postprocessing';

export interface HueSaturationState {
	enabled: boolean;
	hue: number;
	saturation: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultHueSaturationState: HueSaturationState = {
	enabled: false,
	hue: 0,
	saturation: 0,
	blendFunction: 0 as BlendFunction
};

export function createHueSaturationActions(state: HueSaturationState) {
	return {
		toggleHueSaturation: () => {
			state.enabled = !state.enabled;
		},
		setHue: (value: number) => {
			state.hue = value;
		},
		setSaturation: (value: number) => {
			state.saturation = value;
		},
		setHueSaturationBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetHueSaturation: () => {
			state.hue = defaultHueSaturationState.hue;
			state.saturation = defaultHueSaturationState.saturation;
			state.blendFunction = defaultHueSaturationState.blendFunction;
		}
	};
}
