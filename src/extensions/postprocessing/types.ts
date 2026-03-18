import type {
	BloomState,
	SMAAState,
	FXAAState,
	VignetteState,
	PixelationState,
	GlitchState,
	NoiseState,
	ChromaticAberrationState,
	BrightnessContrastState,
	HueSaturationState,
	SepiaState,
	DotScreenState,
	ScanlineState,
	ShockWaveState,
	ASCIIState,
	ToneMappingState,
	GridState,
	TiltShiftState,
	LensDistortionState,
	ColorDepthState,
	DepthOfFieldState,
	GodRaysState,
	SSAOState,
	OutlineState,
	DepthEffectState
} from './effects';

export const extensionScope = 'postprocessing';

// Re-export all state types from effects
export type {
	BloomState,
	SMAAState,
	FXAAState,
	VignetteState,
	PixelationState,
	GlitchState,
	NoiseState,
	ChromaticAberrationState,
	BrightnessContrastState,
	HueSaturationState,
	SepiaState,
	DotScreenState,
	ScanlineState,
	ShockWaveState,
	ASCIIState,
	ToneMappingState,
	GridState,
	TiltShiftState,
	LensDistortionState,
	ColorDepthState,
	DepthOfFieldState,
	GodRaysState,
	SSAOState,
	OutlineState,
	DepthEffectState
};

// Composite state type
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

// Actions type - combining all effect actions
export type ExtensionActions = {
	// Bloom
	toggleBloom: () => void;
	setBloomIntensity: (value: number) => void;
	setBloomThreshold: (value: number) => void;
	setBloomSmoothing: (value: number) => void;
	setBloomKernelSize: (value: import('postprocessing').KernelSize) => void;
	setBloomBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	setBloomMipmapBlur: (value: boolean) => void;
	setBloomRadius: (value: number) => void;
	setBloomLevels: (value: number) => void;
	setBloomResolutionScale: (value: number) => void;
	resetBloom: () => void;

	// SMAA
	toggleSMAA: () => void;
	setSMAAPreset: (value: 0 | 1 | 2 | 3) => void;
	setSMAEEdgeDetectionMode: (value: 0 | 1 | 2) => void;
	setSMAAPredicationMode: (value: 0 | 1 | 2) => void;
	resetSMAA: () => void;

	// FXAA
	toggleFXAA: () => void;
	setFXAAEdgeThreshold: (min: number, max: number, quality: number) => void;
	resetFXAA: () => void;

	// Vignette
	toggleVignette: () => void;
	setVignetteOffset: (value: number) => void;
	setVignetteDarkness: (value: number) => void;
	setVignetteTechnique: (value: 0 | 1) => void;
	resetVignette: () => void;

	// Pixelation
	togglePixelation: () => void;
	setPixelationGranularity: (value: number) => void;
	resetPixelation: () => void;

	// Glitch
	toggleGlitch: () => void;
	setGlitchDelay: (value: number) => void;
	setGlitchDuration: (value: number) => void;
	setGlitchStrength: (value: number) => void;
	setGlitchRatio: (value: number) => void;
	setGlitchColumns: (value: number) => void;
	setGlitchMode: (value: 0 | 1 | 2 | 3) => void;
	resetGlitch: () => void;

	// Noise
	toggleNoise: () => void;
	setNoiseBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetNoise: () => void;

	// Chromatic Aberration
	toggleChromaticAberration: () => void;
	setChromaticAberrationOffset: (value: number) => void;
	setChromaticAberrationOffsetX: (value: number) => void;
	setChromaticAberrationOffsetY: (value: number) => void;
	setChromaticAberrationModulation: (radial: boolean, offset: number) => void;
	setChromaticAberrationBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetChromaticAberration: () => void;

	// Brightness & Contrast
	toggleBrightnessContrast: () => void;
	setBrightness: (value: number) => void;
	setContrast: (value: number) => void;
	setBrightnessContrastBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetBrightnessContrast: () => void;

	// Hue & Saturation
	toggleHueSaturation: () => void;
	setHue: (value: number) => void;
	setSaturation: (value: number) => void;
	setHueSaturationBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetHueSaturation: () => void;

	// Sepia
	toggleSepia: () => void;
	setSepiaIntensity: (value: number) => void;
	setSepiaBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetSepia: () => void;

	// Dot Screen
	toggleDotScreen: () => void;
	setDotScreenAngle: (value: number) => void;
	setDotScreenScale: (value: number) => void;
	setDotScreenBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetDotScreen: () => void;

	// Scanline
	toggleScanline: () => void;
	setScanlineDensity: (value: number) => void;
	setScanlineOpacity: (value: number) => void;
	setScanlineScrollSpeed: (value: number) => void;
	setScanlineBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetScanline: () => void;

	// Shock Wave
	toggleShockWave: () => void;
	setShockWaveSpeed: (value: number) => void;
	setShockWaveMaxRadius: (value: number) => void;
	setShockWaveWaveSize: (value: number) => void;
	setShockWaveAmplitude: (value: number) => void;
	setShockWaveEpicenter: (x: number, y: number, z: number) => void;
	triggerShockWave: () => void;
	resetShockWave: () => void;

	// ASCII
	toggleASCII: () => void;
	setASCIICellSize: (value: number) => void;
	setASCIIInverted: (value: boolean) => void;
	resetASCII: () => void;

	// Tone Mapping
	toggleToneMapping: () => void;
	setToneMappingMode: (value: import('postprocessing').ToneMappingMode) => void;
	setToneMappingWhitePoint: (value: number) => void;
	setToneMappingMiddleGrey: (value: number) => void;
	setToneMappingResolution: (value: number) => void;
	setToneMappingMinLuminance: (value: number) => void;
	setToneMappingAverageLuminance: (value: number) => void;
	setToneMappingAdaptationRate: (value: number) => void;
	setToneMappingBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetToneMapping: () => void;

	// Grid
	toggleGrid: () => void;
	setGridScale: (value: number) => void;
	setGridLineWidth: (value: number) => void;
	setGridBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetGrid: () => void;

	// Tilt Shift
	toggleTiltShift: () => void;
	setTiltShiftOffset: (value: number) => void;
	setTiltShiftFocusArea: (value: number) => void;
	setTiltShiftFeather: (value: number) => void;
	setTiltShiftKernelSize: (value: import('postprocessing').KernelSize) => void;
	setTiltShiftBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetTiltShift: () => void;

	// Lens Distortion
	toggleLensDistortion: () => void;
	setLensDistortionX: (value: number) => void;
	setLensDistortionY: (value: number) => void;
	setLensPrincipalX: (value: number) => void;
	setLensPrincipalY: (value: number) => void;
	setLensFocalLengthX: (value: number) => void;
	setLensFocalLengthY: (value: number) => void;
	setLensSkew: (value: number) => void;
	resetLensDistortion: () => void;

	// Color Depth
	toggleColorDepth: () => void;
	setColorDepthBits: (value: number) => void;
	setColorDepthBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetColorDepth: () => void;

	// Depth of Field
	toggleDepthOfField: () => void;
	setDepthOfFieldFocusDistance: (value: number) => void;
	setDepthOfFieldFocusRange: (value: number) => void;
	setDepthOfFieldBokehScale: (value: number) => void;
	setDepthOfFieldBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetDepthOfField: () => void;

	// God Rays
	toggleGodRays: () => void;
	setGodRaysSamples: (value: number) => void;
	setGodRaysDensity: (value: number) => void;
	setGodRaysDecay: (value: number) => void;
	setGodRaysWeight: (value: number) => void;
	setGodRaysExposure: (value: number) => void;
	setGodRaysClampMax: (value: number) => void;
	setGodRaysBlur: (value: boolean) => void;
	setGodRaysKernelSize: (value: import('postprocessing').KernelSize) => void;
	setGodRaysBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	setGodRaysSunX: (value: number) => void;
	setGodRaysSunY: (value: number) => void;
	setGodRaysSunZ: (value: number) => void;
	setGodRaysSunColor: (value: number) => void;
	resetGodRays: () => void;

	// SSAO
	toggleSSAO: () => void;
	setSSAOSamples: (value: number) => void;
	setSSAORings: (value: number) => void;
	setSSAORadius: (value: number) => void;
	setSSAOIntensity: (value: number) => void;
	setSSAOBias: (value: number) => void;
	setSSAOFade: (value: number) => void;
	setSSAOLuminanceInfluence: (value: number) => void;
	setSSAOBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetSSAO: () => void;

	// Outline
	toggleOutline: () => void;
	setOutlineEdgeStrength: (value: number) => void;
	setOutlineVisibleEdgeColor: (value: number) => void;
	setOutlineHiddenEdgeColor: (value: number) => void;
	setOutlinePulseSpeed: (value: number) => void;
	setOutlineXRay: (value: boolean) => void;
	setOutlineBlur: (value: boolean) => void;
	setOutlineKernelSize: (value: import('postprocessing').KernelSize) => void;
	setOutlineBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetOutline: () => void;

	// Depth Effect
	toggleDepthEffect: () => void;
	setDepthEffectInverted: (value: boolean) => void;
	setDepthEffectBlendFunction: (value: import('postprocessing').BlendFunction) => void;
	resetDepthEffect: () => void;

	// Global
	resetAll: () => void;
};
