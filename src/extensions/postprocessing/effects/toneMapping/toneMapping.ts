import type { BlendFunction, ToneMappingMode } from 'postprocessing';

export interface ToneMappingState {
	enabled: boolean;
	mode: ToneMappingMode;
	whitePoint: number;
	middleGrey: number;
	blendFunction: BlendFunction;
	resolution: number;
	minLuminance: number;
	averageLuminance: number;
	adaptationRate: number;
	[key: string]: unknown;
}

export const defaultToneMappingState: ToneMappingState = {
	enabled: false,
	mode: 11 as ToneMappingMode,
	whitePoint: 4.0,
	middleGrey: 0.6,
	blendFunction: 0 as BlendFunction,
	resolution: 256,
	minLuminance: 0.01,
	averageLuminance: 1.0,
	adaptationRate: 1.0
};

export function createToneMappingActions(state: ToneMappingState) {
	return {
		toggleToneMapping: () => {
			state.enabled = !state.enabled;
		},
		setToneMappingMode: (value: ToneMappingMode) => {
			state.mode = value;
		},
		setToneMappingWhitePoint: (value: number) => {
			state.whitePoint = value;
		},
		setToneMappingMiddleGrey: (value: number) => {
			state.middleGrey = value;
		},
		setToneMappingResolution: (value: number) => {
			state.resolution = value;
		},
		setToneMappingMinLuminance: (value: number) => {
			state.minLuminance = value;
		},
		setToneMappingAverageLuminance: (value: number) => {
			state.averageLuminance = value;
		},
		setToneMappingAdaptationRate: (value: number) => {
			state.adaptationRate = value;
		},
		setToneMappingBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetToneMapping: () => {
			state.mode = defaultToneMappingState.mode;
			state.whitePoint = defaultToneMappingState.whitePoint;
			state.middleGrey = defaultToneMappingState.middleGrey;
			state.blendFunction = defaultToneMappingState.blendFunction;
			state.resolution = defaultToneMappingState.resolution;
			state.minLuminance = defaultToneMappingState.minLuminance;
			state.averageLuminance = defaultToneMappingState.averageLuminance;
			state.adaptationRate = defaultToneMappingState.adaptationRate;
		}
	};
}
