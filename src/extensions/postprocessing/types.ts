export const extensionScope = 'postprocessing';

export type BloomState = {
	enabled: boolean;
	strength: number;
	radius: number;
	threshold: number;
};

export type SMAAState = {
	enabled: boolean;
};

export type FXAAState = {
	enabled: boolean;
};

export type VignetteState = {
	enabled: boolean;
	intensity: number;
	smoothness: number;
};

export type PixelationState = {
	enabled: boolean;
	pixelSize: number;
	normalEdgeStrength: number;
	depthEdgeStrength: number;
};

// Deferred — state kept for UI continuity, not yet wired into the TSL pipeline (see roadmap Phase 4 log)
export type GlitchState = {
	enabled: boolean;
	delay: number;
	duration: number;
	strength: number;
	ratio: number;
	columns: number;
	mode: 0 | 1 | 2 | 3;
	dtSize: number;
};

export type NoiseState = {
	enabled: boolean;
	intensity: number;
};

export type ChromaticAberrationState = {
	enabled: boolean;
	strength: number;
	scale: number;
};

export type BrightnessContrastState = {
	enabled: boolean;
	brightness: number;
	contrast: number;
};

export type HueSaturationState = {
	enabled: boolean;
	hue: number;
	saturation: number;
};

export type SepiaState = {
	enabled: boolean;
	intensity: number;
};

export type DotScreenState = {
	enabled: boolean;
	angle: number;
	scale: number;
};

export type ScanlineState = {
	enabled: boolean;
	intensity: number;
	count: number;
	speed: number;
};

// Deferred — state kept for UI continuity, not yet wired into the TSL pipeline (see roadmap Phase 4 log)
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

// Deferred — state kept for UI continuity, not yet wired into the TSL pipeline (see roadmap Phase 4 log)
export type ASCIIState = {
	enabled: boolean;
	cellSize: number;
	inverted: boolean;
};

// Native renderer property (renderer.toneMapping / .toneMappingExposure) — not a pass/node
export type ToneMappingState = {
	enabled: boolean;
	mode: number;
	exposure: number;
};

export type GridState = {
	enabled: boolean;
	scale: number;
	lineWidth: number;
};

// Deferred — state kept for UI continuity, not yet wired into the TSL pipeline (see roadmap Phase 4 log)
export type TiltShiftState = {
	enabled: boolean;
	offset: number;
	rotation: number;
	focusArea: number;
	feather: number;
};

export type LensDistortionState = {
	enabled: boolean;
	curvature: number;
};

export type ColorDepthState = {
	enabled: boolean;
	steps: number;
};

export type DepthOfFieldState = {
	enabled: boolean;
	focusDistance: number;
	focalLength: number;
	bokehScale: number;
};

export type GodRaysState = {
	enabled: boolean;
	samples: number;
	density: number;
	maxDensity: number;
	distanceAttenuation: number;
	resolutionScale: number;
	sunX: number;
	sunY: number;
	sunZ: number;
	sunColor: number;
};

// Simplified from pmndrs' N8AO-style SSAO to match GTAONode's actual param surface
export type SSAOState = {
	enabled: boolean;
	radius: number;
	thickness: number;
	scale: number;
	samples: number;
};

export type OutlineState = {
	enabled: boolean;
	edgeStrength: number;
	edgeGlow: number;
	edgeThickness: number;
	pulseSpeed: number;
	visibleEdgeColor: number;
	hiddenEdgeColor: number;
};

export type DepthEffectState = {
	enabled: boolean;
	inverted: boolean;
};

export type PostProcessingState = {
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

export type PostProcessingPreset = {
	id: string;
	name: string;
	createdAt: number;
	settings: PostProcessingState;
};

export type ExtensionState = PostProcessingState;

export type ExtensionActions = Record<string, (...args: any[]) => void>;
