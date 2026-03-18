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
	[key: string]: unknown;
};

export type SMAAState = {
	enabled: boolean;
	preset: 0 | 1 | 2 | 3;
	edgeDetectionMode: 0 | 1 | 2;
	predicationMode: 0 | 1 | 2;
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
	technique: 0 | 1;
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
	columns: number;
	mode: 0 | 1 | 2 | 3;
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
	offsetX: number;
	offsetY: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type BrightnessContrastState = {
	enabled: boolean;
	brightness: number;
	contrast: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type HueSaturationState = {
	enabled: boolean;
	hue: number;
	saturation: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type SepiaState = {
	enabled: boolean;
	intensity: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type DotScreenState = {
	enabled: boolean;
	angle: number;
	scale: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type ScanlineState = {
	enabled: boolean;
	density: number;
	opacity: number;
	scrollSpeed: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
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
	blendFunction: BlendFunction;
	resolution: number;
	minLuminance: number;
	averageLuminance: number;
	adaptationRate: number;
	[key: string]: unknown;
};

export type GridState = {
	enabled: boolean;
	scale: number;
	lineWidth: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type TiltShiftState = {
	enabled: boolean;
	offset: number;
	rotation: number;
	focusArea: number;
	feather: number;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
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

export type ColorDepthState = {
	enabled: boolean;
	bits: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
};

export type DepthOfFieldState = {
	enabled: boolean;
	focusDistance: number;
	focusRange: number;
	bokehScale: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
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
	[key: string]: unknown;
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
	[key: string]: unknown;
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
	[key: string]: unknown;
};

export type DepthEffectState = {
	enabled: boolean;
	inverted: boolean;
	blendFunction: BlendFunction;
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
	colorDepth: ColorDepthState;
	depthOfField: DepthOfFieldState;
	godRays: GodRaysState;
	ssao: SSAOState;
	outline: OutlineState;
	depthEffect: DepthEffectState;
	[key: string]: unknown;
};

export type ExtensionActions = {
	toggleBloom: () => void;
	setBloomIntensity: (value: number) => void;
	setBloomThreshold: (value: number) => void;
	setBloomSmoothing: (value: number) => void;
	setBloomKernelSize: (value: KernelSize) => void;
	setBloomBlendFunction: (value: BlendFunction) => void;
	setBloomMipmapBlur: (value: boolean) => void;
	setBloomRadius: (value: number) => void;
	setBloomLevels: (value: number) => void;
	toggleSMAA: () => void;
	setSMAAPreset: (value: 0 | 1 | 2 | 3) => void;
	setSMAEEdgeDetectionMode: (value: 0 | 1 | 2) => void;
	setSMAAPredicationMode: (value: 0 | 1 | 2) => void;
	toggleFXAA: () => void;
	setFXAAEdgeThreshold: (min: number, max: number, quality: number) => void;
	toggleVignette: () => void;
	setVignetteOffset: (value: number) => void;
	setVignetteDarkness: (value: number) => void;
	setVignetteTechnique: (value: 0 | 1) => void;
	togglePixelation: () => void;
	setPixelationGranularity: (value: number) => void;
	toggleGlitch: () => void;
	setGlitchDelay: (value: number) => void;
	setGlitchDuration: (value: number) => void;
	setGlitchStrength: (value: number) => void;
	setGlitchRatio: (value: number) => void;
	setGlitchColumns: (value: number) => void;
	setGlitchMode: (value: 0 | 1 | 2 | 3) => void;
	toggleNoise: () => void;
	toggleChromaticAberration: () => void;
	setChromaticAberrationOffset: (value: number) => void;
	setChromaticAberrationOffsetX: (value: number) => void;
	setChromaticAberrationOffsetY: (value: number) => void;
	setChromaticAberrationModulation: (radial: boolean, offset: number) => void;
	setChromaticAberrationBlendFunction: (value: BlendFunction) => void;
	toggleBrightnessContrast: () => void;
	setBrightness: (value: number) => void;
	setContrast: (value: number) => void;
	setBrightnessContrastBlendFunction: (value: BlendFunction) => void;
	toggleHueSaturation: () => void;
	setHue: (value: number) => void;
	setSaturation: (value: number) => void;
	setHueSaturationBlendFunction: (value: BlendFunction) => void;
	toggleSepia: () => void;
	setSepiaIntensity: (value: number) => void;
	setSepiaBlendFunction: (value: BlendFunction) => void;
	toggleDotScreen: () => void;
	setDotScreenAngle: (value: number) => void;
	setDotScreenScale: (value: number) => void;
	setDotScreenBlendFunction: (value: BlendFunction) => void;
	toggleScanline: () => void;
	setScanlineDensity: (value: number) => void;
	setScanlineOpacity: (value: number) => void;
	setScanlineScrollSpeed: (value: number) => void;
	setScanlineBlendFunction: (value: BlendFunction) => void;
	toggleShockWave: () => void;
	setShockWaveSpeed: (value: number) => void;
	setShockWaveMaxRadius: (value: number) => void;
	setShockWaveWaveSize: (value: number) => void;
	setShockWaveAmplitude: (value: number) => void;
	setShockWaveEpicenter: (x: number, y: number, z: number) => void;
	triggerShockWave: () => void;
	toggleASCII: () => void;
	setASCIICellSize: (value: number) => void;
	setASCIIInverted: (value: boolean) => void;
	toggleToneMapping: () => void;
	setToneMappingMode: (value: ToneMappingMode) => void;
	setToneMappingWhitePoint: (value: number) => void;
	setToneMappingMiddleGrey: (value: number) => void;
	setToneMappingResolution: (value: number) => void;
	setToneMappingMinLuminance: (value: number) => void;
	setToneMappingAverageLuminance: (value: number) => void;
	setToneMappingAdaptationRate: (value: number) => void;
	setToneMappingBlendFunction: (value: BlendFunction) => void;
	toggleGrid: () => void;
	setGridScale: (value: number) => void;
	setGridLineWidth: (value: number) => void;
	setGridBlendFunction: (value: BlendFunction) => void;
	toggleTiltShift: () => void;
	setTiltShiftOffset: (value: number) => void;
	setTiltShiftFocusArea: (value: number) => void;
	setTiltShiftFeather: (value: number) => void;
	setTiltShiftKernelSize: (value: KernelSize) => void;
	setTiltShiftBlendFunction: (value: BlendFunction) => void;
	toggleLensDistortion: () => void;
	setLensDistortionX: (value: number) => void;
	setLensDistortionY: (value: number) => void;
	setLensPrincipalX: (value: number) => void;
	setLensPrincipalY: (value: number) => void;
	setLensFocalLengthX: (value: number) => void;
	setLensFocalLengthY: (value: number) => void;
	setLensSkew: (value: number) => void;
	toggleColorDepth: () => void;
	setColorDepthBits: (value: number) => void;
	setColorDepthBlendFunction: (value: BlendFunction) => void;
	toggleDepthOfField: () => void;
	setDepthOfFieldFocusDistance: (value: number) => void;
	setDepthOfFieldFocusRange: (value: number) => void;
	setDepthOfFieldBokehScale: (value: number) => void;
	setDepthOfFieldBlendFunction: (value: BlendFunction) => void;
	toggleGodRays: () => void;
	setGodRaysSamples: (value: number) => void;
	setGodRaysDensity: (value: number) => void;
	setGodRaysDecay: (value: number) => void;
	setGodRaysWeight: (value: number) => void;
	setGodRaysExposure: (value: number) => void;
	setGodRaysClampMax: (value: number) => void;
	setGodRaysBlur: (value: boolean) => void;
	setGodRaysKernelSize: (value: KernelSize) => void;
	setGodRaysBlendFunction: (value: BlendFunction) => void;
	toggleSSAO: () => void;
	setSSAOSamples: (value: number) => void;
	setSSAORings: (value: number) => void;
	setSSAORadius: (value: number) => void;
	setSSAOIntensity: (value: number) => void;
	setSSAOBias: (value: number) => void;
	setSSAOFade: (value: number) => void;
	setSSAOLuminanceInfluence: (value: number) => void;
	setSSAOBlendFunction: (value: BlendFunction) => void;
	toggleOutline: () => void;
	setOutlineEdgeStrength: (value: number) => void;
	setOutlineVisibleEdgeColor: (value: number) => void;
	setOutlineHiddenEdgeColor: (value: number) => void;
	setOutlinePulseSpeed: (value: number) => void;
	setOutlineXRay: (value: boolean) => void;
	setOutlineBlur: (value: boolean) => void;
	setOutlineKernelSize: (value: KernelSize) => void;
	setOutlineBlendFunction: (value: BlendFunction) => void;
	toggleDepthEffect: () => void;
	setDepthEffectInverted: (value: boolean) => void;
	setDepthEffectBlendFunction: (value: BlendFunction) => void;
	resetAll: () => void;
};
