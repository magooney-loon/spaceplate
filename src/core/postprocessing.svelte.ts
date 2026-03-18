import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';

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

export interface FXAAState {
	enabled: boolean;
	minEdgeThreshold: number;
	maxEdgeThreshold: number;
	subpixelQuality: number;
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
	radialModulation: boolean;
	modulationOffset: number;
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

export interface ToneMappingState {
	enabled: boolean;
	mode: ToneMappingMode;
	whitePoint: number;
	middleGrey: number;
}

export interface GridState {
	enabled: boolean;
	scale: number;
	lineWidth: number;
}

export interface TiltShiftState {
	enabled: boolean;
	offset: number;
	rotation: number;
	focusArea: number;
	feather: number;
	kernelSize: KernelSize;
}

export interface LensDistortionState {
	enabled: boolean;
	distortionX: number;
	distortionY: number;
	principalX: number;
	principalY: number;
	focalLengthX: number;
	focalLengthY: number;
	skew: number;
}

export interface PostProcessingState {
	bloom: BloomState;
	smaa: SMAAState;
	fxaa: FXAAState;
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
	toneMapping: ToneMappingState;
	grid: GridState;
	tiltShift: TiltShiftState;
	lensDistortion: LensDistortionState;
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
	fxaa: {
		enabled: false,
		minEdgeThreshold: 0.05,
		maxEdgeThreshold: 0.12,
		subpixelQuality: 0.75
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
		radialModulation: false,
		modulationOffset: 0.5,
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
	},
	toneMapping: {
		enabled: false,
		mode: 11 as ToneMappingMode,
		whitePoint: 4.0,
		middleGrey: 0.6
	},
	grid: {
		enabled: false,
		scale: 1.0,
		lineWidth: 0.0
	},
	tiltShift: {
		enabled: false,
		offset: 0.0,
		rotation: 0.0,
		focusArea: 0.4,
		feather: 0.3,
		kernelSize: 3 as KernelSize
	},
	lensDistortion: {
		enabled: false,
		distortionX: 0.0,
		distortionY: 0.0,
		principalX: 0.0,
		principalY: 0.0,
		focalLengthX: 1.0,
		focalLengthY: 1.0,
		skew: 0.0
	}
});
