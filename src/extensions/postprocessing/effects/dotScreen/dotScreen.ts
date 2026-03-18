import type { BlendFunction } from 'postprocessing';

export interface DotScreenState {
	enabled: boolean;
	angle: number;
	scale: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultDotScreenState: DotScreenState = {
	enabled: false,
	angle: 1.57,
	scale: 1.0,
	blendFunction: 0 as BlendFunction
};

export function createDotScreenActions(state: DotScreenState) {
	return {
		toggleDotScreen: () => {
			state.enabled = !state.enabled;
		},
		setDotScreenAngle: (value: number) => {
			state.angle = value;
		},
		setDotScreenScale: (value: number) => {
			state.scale = value;
		},
		setDotScreenBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetDotScreen: () => {
			state.angle = defaultDotScreenState.angle;
			state.scale = defaultDotScreenState.scale;
			state.blendFunction = defaultDotScreenState.blendFunction;
		}
	};
}
