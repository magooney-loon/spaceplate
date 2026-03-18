import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';

export const extensionScope = 'postprocessing';

export type BloomState = {
	enabled: boolean;
	intensity: number;
	luminanceThreshold: number;
	luminanceSmoothing: number;
	kernelSize: KernelSize;
	[key: string]: unknown;
};

export type SMAAState = {
	enabled: boolean;
	preset: 0 | 1 | 2;
	[key: string]: unknown;
};

export type FXAAState = {
	enabled: boolean;
	minEdgeThreshold: number;
	maxEdgeThreshold: number;
	subpixelQuality: number;
	[key: string]: unknown;
};

export type VignetteState = {
	enabled: boolean;
	offset: number;
	darkness: number;
	[key: string]: unknown;
};

export type PixelationState = {
	enabled: boolean;
	granularity: number;
	[key: string]: unknown;
};

export type GlitchState = {
	enabled: boolean;
	delay: number;
	duration: number;
	strength: number;
	ratio: number;
	[key: string]: unknown;
};

export type NoiseState = {
	enabled: boolean;
	premultiply: boolean;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type ChromaticAberrationState = {
	enabled: boolean;
	radialModulation: boolean;
	modulationOffset: number;
	offset: number;
	[key: string]: unknown;
};

export type BrightnessContrastState = {
	enabled: boolean;
	brightness: number;
	contrast: number;
	[key: string]: unknown;
};

export type HueSaturationState = {
	enabled: boolean;
	hue: number;
	saturation: number;
	[key: string]: unknown;
};

export type SepiaState = {
	enabled: boolean;
	intensity: number;
	[key: string]: unknown;
};

export type DotScreenState = {
	enabled: boolean;
	angle: number;
	scale: number;
	[key: string]: unknown;
};

export type ScanlineState = {
	enabled: boolean;
	density: number;
	opacity: number;
	[key: string]: unknown;
};

export type ShockWaveState = {
	enabled: boolean;
	speed: number;
	maxStrength: number;
	distortion: number;
	size: number;
	[key: string]: unknown;
};

export type ASCIIState = {
	enabled: boolean;
	cellSize: number;
	inverted: boolean;
	[key: string]: unknown;
};

export type ToneMappingState = {
	enabled: boolean;
	mode: ToneMappingMode;
	whitePoint: number;
	middleGrey: number;
	[key: string]: unknown;
};

export type GridState = {
	enabled: boolean;
	scale: number;
	lineWidth: number;
	[key: string]: unknown;
};

export type TiltShiftState = {
	enabled: boolean;
	offset: number;
	rotation: number;
	focusArea: number;
	feather: number;
	kernelSize: KernelSize;
	[key: string]: unknown;
};

export type LensDistortionState = {
	enabled: boolean;
	distortionX: number;
	distortionY: number;
	principalX: number;
	principalY: number;
	focalLengthX: number;
	focalLengthY: number;
	skew: number;
	[key: string]: unknown;
};

export type ExtensionState = {
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
	[key: string]: unknown;
};

export type ExtensionActions = {
	toggleBloom: () => void;
	setBloomIntensity: (value: number) => void;
	setBloomThreshold: (value: number) => void;
	setBloomSmoothing: (value: number) => void;
	setBloomKernelSize: (value: KernelSize) => void;
	toggleSMAA: () => void;
	setSMAAPreset: (value: 0 | 1 | 2) => void;
	toggleFXAA: () => void;
	setFXAAEdgeThreshold: (min: number, max: number, quality: number) => void;
	toggleVignette: () => void;
	setVignetteOffset: (value: number) => void;
	setVignetteDarkness: (value: number) => void;
	togglePixelation: () => void;
	setPixelationGranularity: (value: number) => void;
	toggleGlitch: () => void;
	setGlitchDelay: (value: number) => void;
	setGlitchDuration: (value: number) => void;
	setGlitchStrength: (value: number) => void;
	toggleNoise: () => void;
	toggleChromaticAberration: () => void;
	setChromaticAberrationOffset: (value: number) => void;
	setChromaticAberrationModulation: (radial: boolean, offset: number) => void;
	toggleBrightnessContrast: () => void;
	setBrightness: (value: number) => void;
	setContrast: (value: number) => void;
	toggleHueSaturation: () => void;
	setHue: (value: number) => void;
	setSaturation: (value: number) => void;
	toggleSepia: () => void;
	setSepiaIntensity: (value: number) => void;
	toggleDotScreen: () => void;
	setDotScreenAngle: (value: number) => void;
	setDotScreenScale: (value: number) => void;
	toggleScanline: () => void;
	setScanlineDensity: (value: number) => void;
	setScanlineOpacity: (value: number) => void;
	toggleShockWave: () => void;
	toggleASCII: () => void;
	setASCIICellSize: (value: number) => void;
	setASCIIInverted: (value: boolean) => void;
	toggleToneMapping: () => void;
	setToneMappingMode: (value: ToneMappingMode) => void;
	setToneMappingWhitePoint: (value: number) => void;
	toggleGrid: () => void;
	setGridScale: (value: number) => void;
	setGridLineWidth: (value: number) => void;
	toggleTiltShift: () => void;
	setTiltShiftOffset: (value: number) => void;
	setTiltShiftFocusArea: (value: number) => void;
	toggleLensDistortion: () => void;
	setLensDistortionX: (value: number) => void;
	setLensDistortionY: (value: number) => void;
	resetAll: () => void;
};
