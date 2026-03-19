import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';

export const extensionScope = 'postprocessing';

export type BloomState = {
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
};

export type SMAAState = {
	enabled: boolean;
	preset: 0 | 1 | 2 | 3;
	edgeDetectionMode: 0 | 1 | 2;
	predicationMode: 0 | 1 | 2;
};

export type FXAAState = {
	enabled: boolean;
	minEdgeThreshold: number;
	maxEdgeThreshold: number;
	subpixelQuality: number;
};

export type VignetteState = {
	enabled: boolean;
	offset: number;
	darkness: number;
	technique: 0 | 1;
};

export type PixelationState = {
	enabled: boolean;
	granularity: number;
};

export type GlitchState = {
	enabled: boolean;
	delay: number;
	duration: number;
	strength: number;
	ratio: number;
	columns: number;
	mode: 0 | 1 | 2 | 3;
	blendFunction: BlendFunction;
	dtSize: number;
};

export type NoiseState = {
	enabled: boolean;
	premultiply: boolean;
	blendFunction: BlendFunction;
};

export type ChromaticAberrationState = {
	enabled: boolean;
	radialModulation: boolean;
	modulationOffset: number;
	offsetX: number;
	offsetY: number;
	blendFunction: BlendFunction;
};

export type BrightnessContrastState = {
	enabled: boolean;
	brightness: number;
	contrast: number;
	blendFunction: BlendFunction;
};

export type HueSaturationState = {
	enabled: boolean;
	hue: number;
	saturation: number;
	blendFunction: BlendFunction;
};

export type SepiaState = {
	enabled: boolean;
	intensity: number;
	blendFunction: BlendFunction;
};

export type DotScreenState = {
	enabled: boolean;
	angle: number;
	scale: number;
	blendFunction: BlendFunction;
};

export type ScanlineState = {
	enabled: boolean;
	density: number;
	opacity: number;
	scrollSpeed: number;
	blendFunction: BlendFunction;
};

export type ShockWaveState = {
	enabled: boolean;
	speed: number;
	maxRadius: number;
	waveSize: number;
	amplitude: number;
	epicenterX: number;
	epicenterY: number;
	epicenterZ: number;
	triggered: boolean;
};

export type ASCIIState = {
	enabled: boolean;
	cellSize: number;
	inverted: boolean;
};

export type ToneMappingState = {
	enabled: boolean;
	mode: ToneMappingMode;
	whitePoint: number;
	middleGrey: number;
	blendFunction: BlendFunction;
	resolution: number;
	minLuminance: number;
	averageLuminance: number;
	adaptationRate: number;
};

export type GridState = {
	enabled: boolean;
	scale: number;
	lineWidth: number;
	blendFunction: BlendFunction;
};

export type TiltShiftState = {
	enabled: boolean;
	offset: number;
	rotation: number;
	focusArea: number;
	feather: number;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
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
};

export type ColorDepthState = {
	enabled: boolean;
	bits: number;
	blendFunction: BlendFunction;
};

export type DepthOfFieldState = {
	enabled: boolean;
	focusDistance: number;
	focusRange: number;
	bokehScale: number;
	blendFunction: BlendFunction;
	resolutionScale: number;
};

export type GodRaysState = {
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
	resolutionScale: number;
};

export type SSAOState = {
	enabled: boolean;
	samples: number;
	rings: number;
	radius: number;
	intensity: number;
	bias: number;
	fade: number;
	luminanceInfluence: number;
	blendFunction: BlendFunction;
	worldDistanceThreshold: number;
	worldDistanceFalloff: number;
	worldProximityThreshold: number;
	worldProximityFalloff: number;
	minRadiusScale: number;
	color: number;
	depthAwareUpsampling: boolean;
	resolutionScale: number;
};

export type OutlineState = {
	enabled: boolean;
	edgeStrength: number;
	visibleEdgeColor: number;
	hiddenEdgeColor: number;
	pulseSpeed: number;
	xRay: boolean;
	blur: boolean;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
	patternScale: number;
	multisampling: number;
	resolutionScale: number;
};

export type DepthEffectState = {
	enabled: boolean;
	inverted: boolean;
	blendFunction: BlendFunction;
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
	colorDepth: ColorDepthState;
	depthOfField: DepthOfFieldState;
	godRays: GodRaysState;
	ssao: SSAOState;
	outline: OutlineState;
	depthEffect: DepthEffectState;
};

export type ExtensionActions = Record<string, (...args: any[]) => void>;
