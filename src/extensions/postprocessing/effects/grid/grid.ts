import type { BlendFunction } from 'postprocessing';

export interface GridState {
	enabled: boolean;
	scale: number;
	lineWidth: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultGridState: GridState = {
	enabled: false,
	scale: 1.0,
	lineWidth: 0.0,
	blendFunction: 25 as BlendFunction
};

export function createGridActions(state: GridState) {
	return {
		toggleGrid: () => {
			state.enabled = !state.enabled;
		},
		setGridScale: (value: number) => {
			state.scale = value;
		},
		setGridLineWidth: (value: number) => {
			state.lineWidth = value;
		},
		setGridBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetGrid: () => {
			state.scale = defaultGridState.scale;
			state.lineWidth = defaultGridState.lineWidth;
			state.blendFunction = defaultGridState.blendFunction;
		}
	};
}
