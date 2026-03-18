import type { KernelSize, BlendFunction } from 'postprocessing';

export interface BloomState {
	enabled: boolean;
	intensity: number;
	luminanceThreshold: number;
	luminanceSmoothing: number;
	kernelSize: KernelSize;
}

export interface SMAAState {
	enabled: boolean;
	preset: 0 | 1 | 2;
}

export interface VignetteState {
	enabled: boolean;
	offset: number;
	darkness: number;
}

export interface PixelationState {
	enabled: boolean;
	granularity: number;
}

export interface GlitchState {
	enabled: boolean;
	delay: number;
	duration: number;
	strength: number;
	ratio: number;
}

export interface NoiseState {
	enabled: boolean;
	premultiply: boolean;
	blendFunction: BlendFunction;
}

export interface PostProcessingState {
	bloom: BloomState;
	smaa: SMAAState;
	vignette: VignetteState;
	pixelation: PixelationState;
	glitch: GlitchState;
	noise: NoiseState;
}

export const postProcessingState = $state<PostProcessingState>({
	bloom: {
		enabled: true,
		intensity: 6,
		luminanceThreshold: 0.01,
		luminanceSmoothing: 0.08,
		kernelSize: 4 as KernelSize
	},
	smaa: {
		enabled: true,
		preset: 2
	},
	vignette: {
		enabled: true,
		offset: 0.2,
		darkness: 0.75
	},
	pixelation: {
		enabled: false,
		granularity: 4.5
	},
	glitch: {
		enabled: false,
		delay: 2.5,
		duration: 0.8,
		strength: 0.65,
		ratio: 0.85
	},
	noise: {
		enabled: false,
		premultiply: true,
		blendFunction: 28 as BlendFunction
	}
});
