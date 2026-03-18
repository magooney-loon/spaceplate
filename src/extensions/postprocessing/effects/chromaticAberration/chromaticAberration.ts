import type { BlendFunction } from 'postprocessing';

export interface ChromaticAberrationState {
	enabled: boolean;
	radialModulation: boolean;
	modulationOffset: number;
	offsetX: number;
	offsetY: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultChromaticAberrationState: ChromaticAberrationState = {
	enabled: false,
	radialModulation: false,
	modulationOffset: 0.15,
	offsetX: 0.01,
	offsetY: 0.01,
	blendFunction: 0 as BlendFunction
};

export function createChromaticAberrationActions(state: ChromaticAberrationState) {
	return {
		toggleChromaticAberration: () => {
			state.enabled = !state.enabled;
		},
		setChromaticAberrationOffsetX: (value: number) => {
			state.offsetX = value;
		},
		setChromaticAberrationOffsetY: (value: number) => {
			state.offsetY = value;
		},
		setChromaticAberrationModulation: (radial: boolean, offset: number) => {
			state.radialModulation = radial;
			state.modulationOffset = offset;
		},
		setChromaticAberrationBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetChromaticAberration: () => {
			state.offsetX = defaultChromaticAberrationState.offsetX;
			state.offsetY = defaultChromaticAberrationState.offsetY;
			state.radialModulation = defaultChromaticAberrationState.radialModulation;
			state.modulationOffset = defaultChromaticAberrationState.modulationOffset;
			state.blendFunction = defaultChromaticAberrationState.blendFunction;
		}
	};
}
