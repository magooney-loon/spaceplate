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

export interface ChromaticAberrationState {
	enabled: boolean;
	offset: number;
}

export interface BrightnessContrastState {
	enabled: boolean;
	brightness: number;
	contrast: number;
}

export interface HueSaturationState {
	enabled: boolean;
	hue: number;
	saturation: number;
}

export interface SepiaState {
	enabled: boolean;
	intensity: number;
}

export interface DotScreenState {
	enabled: boolean;
	angle: number;
	scale: number;
}

export interface ScanlineState {
	enabled: boolean;
	density: number;
	opacity: number;
}

export interface ShockWaveState {
	enabled: boolean;
	speed: number;
	maxStrength: number;
	distortion: number;
	size: number;
}

export interface ASCIIState {
	enabled: boolean;
	cellSize: number;
	inverted: boolean;
}

export interface PostProcessingState {
	bloom: BloomState;
	smaa: SMAAState;
	vignette: VignetteState;
	pixelation: PixelationState;
	glitch: GlitchState;
	noise: NoiseState;
	chromaticAberration: ChromaticAberrationState;
	brightnessContrast: BrightnessContrastState;
	hueSaturation: HueSaturationState;
	sepia: SepiaState;
	dotScreen: DotScreenState;
	scanline: ScanlineState;
	shockWave: ShockWaveState;
	ascii: ASCIIState;
}

export const postProcessingState = $state<PostProcessingState>({
	bloom: {
		enabled: false,
		intensity: 6,
		luminanceThreshold: 0.01,
		luminanceSmoothing: 0.08,
		kernelSize: 4 as KernelSize
	},
	smaa: {
		enabled: false,
		preset: 2
	},
	vignette: {
		enabled: false,
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
	},
	chromaticAberration: {
		enabled: false,
		offset: 0.005
	},
	brightnessContrast: {
		enabled: false,
		brightness: 0,
		contrast: 0
	},
	hueSaturation: {
		enabled: false,
		hue: 0,
		saturation: 0
	},
	sepia: {
		enabled: false,
		intensity: 1
	},
	dotScreen: {
		enabled: false,
		angle: 1.57,
		scale: 1
	},
	scanline: {
		enabled: false,
		density: 1.5,
		opacity: 0.5
	},
	shockWave: {
		enabled: false,
		speed: 5,
		maxStrength: 1.5,
		distortion: 0.5,
		size: 0.5
	},
	ascii: {
		enabled: false,
		cellSize: 16,
		inverted: false
	}
});
