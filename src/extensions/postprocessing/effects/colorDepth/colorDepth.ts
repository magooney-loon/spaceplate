import type { BlendFunction } from 'postprocessing';

export interface ColorDepthState {
	enabled: boolean;
	bits: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultColorDepthState: ColorDepthState = {
	enabled: false,
	bits: 16,
	blendFunction: 0 as BlendFunction
};

export function createColorDepthActions(state: ColorDepthState) {
	return {
		toggleColorDepth: () => {
			state.enabled = !state.enabled;
		},
		setColorDepthBits: (value: number) => {
			state.bits = value;
		},
		setColorDepthBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetColorDepth: () => {
			state.bits = defaultColorDepthState.bits;
			state.blendFunction = defaultColorDepthState.blendFunction;
		}
	};
}
