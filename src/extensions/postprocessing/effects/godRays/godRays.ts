import type { KernelSize, BlendFunction } from 'postprocessing';

export interface GodRaysState {
	enabled: boolean;
	samples: number;
	density: number;
	decay: number;
	weight: number;
	exposure: number;
	clampMax: number;
	blur: boolean;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
	sunX: number;
	sunY: number;
	sunZ: number;
	sunColor: number;
	[key: string]: unknown;
}

export const defaultGodRaysState: GodRaysState = {
	enabled: false,
	samples: 60,
	density: 0.96,
	decay: 0.9,
	weight: 0.4,
	exposure: 0.6,
	clampMax: 1.0,
	blur: true,
	kernelSize: 1 as KernelSize,
	blendFunction: 28 as BlendFunction,
	sunX: 0,
	sunY: 5,
	sunZ: 0,
	sunColor: 0xffddaa
};

export function createGodRaysActions(state: GodRaysState) {
	return {
		toggleGodRays: () => {
			state.enabled = !state.enabled;
		},
		setGodRaysSamples: (value: number) => {
			state.samples = value;
		},
		setGodRaysDensity: (value: number) => {
			state.density = value;
		},
		setGodRaysDecay: (value: number) => {
			state.decay = value;
		},
		setGodRaysWeight: (value: number) => {
			state.weight = value;
		},
		setGodRaysExposure: (value: number) => {
			state.exposure = value;
		},
		setGodRaysClampMax: (value: number) => {
			state.clampMax = value;
		},
		setGodRaysBlur: (value: boolean) => {
			state.blur = value;
		},
		setGodRaysKernelSize: (value: KernelSize) => {
			state.kernelSize = value;
		},
		setGodRaysBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		setGodRaysSunX: (value: number) => {
			state.sunX = value;
		},
		setGodRaysSunY: (value: number) => {
			state.sunY = value;
		},
		setGodRaysSunZ: (value: number) => {
			state.sunZ = value;
		},
		setGodRaysSunColor: (value: number) => {
			state.sunColor = value;
		},
		resetGodRays: () => {
			state.samples = defaultGodRaysState.samples;
			state.density = defaultGodRaysState.density;
			state.decay = defaultGodRaysState.decay;
			state.weight = defaultGodRaysState.weight;
			state.exposure = defaultGodRaysState.exposure;
			state.clampMax = defaultGodRaysState.clampMax;
			state.blur = defaultGodRaysState.blur;
			state.kernelSize = defaultGodRaysState.kernelSize;
			state.blendFunction = defaultGodRaysState.blendFunction;
			state.sunX = defaultGodRaysState.sunX;
			state.sunY = defaultGodRaysState.sunY;
			state.sunZ = defaultGodRaysState.sunZ;
			state.sunColor = defaultGodRaysState.sunColor;
		}
	};
}
