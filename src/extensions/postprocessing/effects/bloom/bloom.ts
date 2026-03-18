import type { KernelSize, BlendFunction } from 'postprocessing';

export interface BloomState {
	enabled: boolean;
	intensity: number;
	luminanceThreshold: number;
	luminanceSmoothing: number;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
	mipmapBlur: boolean;
	radius: number;
	levels: number;
	resolutionScale: number;
	[key: string]: unknown;
}

export const defaultBloomState: BloomState = {
	enabled: false,
	intensity: 1.0,
	luminanceThreshold: 1.0,
	luminanceSmoothing: 0.03,
	kernelSize: 4 as KernelSize,
	blendFunction: 28 as BlendFunction,
	mipmapBlur: true,
	radius: 0.85,
	levels: 8,
	resolutionScale: 0.5
};

export function createBloomActions(state: BloomState) {
	return {
		toggleBloom: () => {
			state.enabled = !state.enabled;
		},
		setBloomIntensity: (value: number) => {
			state.intensity = value;
		},
		setBloomThreshold: (value: number) => {
			state.luminanceThreshold = value;
		},
		setBloomSmoothing: (value: number) => {
			state.luminanceSmoothing = value;
		},
		setBloomKernelSize: (value: KernelSize) => {
			state.kernelSize = value;
		},
		setBloomBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		setBloomMipmapBlur: (value: boolean) => {
			state.mipmapBlur = value;
		},
		setBloomRadius: (value: number) => {
			state.radius = value;
		},
		setBloomLevels: (value: number) => {
			state.levels = value;
		},
		setBloomResolutionScale: (value: number) => {
			state.resolutionScale = value;
		},
		resetBloom: () => {
			state.intensity = defaultBloomState.intensity;
			state.luminanceThreshold = defaultBloomState.luminanceThreshold;
			state.luminanceSmoothing = defaultBloomState.luminanceSmoothing;
			state.kernelSize = defaultBloomState.kernelSize;
			state.blendFunction = defaultBloomState.blendFunction;
			state.mipmapBlur = defaultBloomState.mipmapBlur;
			state.radius = defaultBloomState.radius;
			state.levels = defaultBloomState.levels;
			state.resolutionScale = defaultBloomState.resolutionScale;
		}
	};
}
