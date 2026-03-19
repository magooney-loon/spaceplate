import type { BlendFunction } from 'postprocessing';

export interface DepthOfFieldState {
	enabled: boolean;
	focusDistance: number;
	focusRange: number;
	bokehScale: number;
	blendFunction: BlendFunction;
	resolutionScale: number;
	[key: string]: unknown;
}

export const defaultDepthOfFieldState: DepthOfFieldState = {
	enabled: false,
	focusDistance: 3.0,
	focusRange: 2.0,
	bokehScale: 1.0,
	blendFunction: 0 as BlendFunction,
	resolutionScale: 0.5
};

export function createDepthOfFieldActions(state: DepthOfFieldState) {
	return {
		toggleDepthOfField: () => {
			state.enabled = !state.enabled;
		},
		setDepthOfFieldFocusDistance: (value: number) => {
			state.focusDistance = value;
		},
		setDepthOfFieldFocusRange: (value: number) => {
			state.focusRange = value;
		},
		setDepthOfFieldBokehScale: (value: number) => {
			state.bokehScale = value;
		},
		setDepthOfFieldBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		setDepthOfFieldResolutionScale: (value: number) => {
			state.resolutionScale = value;
		},
		resetDepthOfField: () => {
			state.focusDistance = defaultDepthOfFieldState.focusDistance;
			state.focusRange = defaultDepthOfFieldState.focusRange;
			state.bokehScale = defaultDepthOfFieldState.bokehScale;
			state.blendFunction = defaultDepthOfFieldState.blendFunction;
			state.resolutionScale = defaultDepthOfFieldState.resolutionScale;
		}
	};
}
