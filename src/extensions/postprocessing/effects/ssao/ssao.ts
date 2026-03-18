import type { BlendFunction } from 'postprocessing';

export interface SSAOState {
	enabled: boolean;
	samples: number;
	rings: number;
	radius: number;
	intensity: number;
	bias: number;
	fade: number;
	luminanceInfluence: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultSSAOState: SSAOState = {
	enabled: false,
	samples: 9,
	rings: 7,
	radius: 0.1825,
	intensity: 1.0,
	bias: 0.025,
	fade: 0.01,
	luminanceInfluence: 0.7,
	blendFunction: 7 as BlendFunction
};

export function createSSAOActions(state: SSAOState) {
	return {
		toggleSSAO: () => {
			state.enabled = !state.enabled;
		},
		setSSAOSamples: (value: number) => {
			state.samples = value;
		},
		setSSAORings: (value: number) => {
			state.rings = value;
		},
		setSSAORadius: (value: number) => {
			state.radius = value;
		},
		setSSAOIntensity: (value: number) => {
			state.intensity = value;
		},
		setSSAOBias: (value: number) => {
			state.bias = value;
		},
		setSSAOFade: (value: number) => {
			state.fade = value;
		},
		setSSAOLuminanceInfluence: (value: number) => {
			state.luminanceInfluence = value;
		},
		setSSAOBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetSSAO: () => {
			state.samples = defaultSSAOState.samples;
			state.rings = defaultSSAOState.rings;
			state.radius = defaultSSAOState.radius;
			state.intensity = defaultSSAOState.intensity;
			state.bias = defaultSSAOState.bias;
			state.fade = defaultSSAOState.fade;
			state.luminanceInfluence = defaultSSAOState.luminanceInfluence;
			state.blendFunction = defaultSSAOState.blendFunction;
		}
	};
}
