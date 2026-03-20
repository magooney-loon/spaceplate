import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';
import { logPostprocessing } from '$extensions/logger/logger.svelte';
import type {
	PostProcessingState,
	PostProcessingPreset,
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
} from './types';

export type {
	PostProcessingPreset,
	PostProcessingState,
	ExtensionState,
	ExtensionActions
} from './types';

const PRESETS_KEY = 'spaceplate-postprocessing-presets';

const defaultBloom = (): BloomState => ({
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
});

const defaultSMAA = (): SMAAState => ({
	enabled: false,
	preset: 2,
	edgeDetectionMode: 2,
	predicationMode: 0
});

const defaultFXAA = (): FXAAState => ({
	enabled: false,
	minEdgeThreshold: 0.05,
	maxEdgeThreshold: 0.12,
	subpixelQuality: 0.75
});

const defaultVignette = (): VignetteState => ({
	enabled: false,
	offset: 0.5,
	darkness: 0.5,
	technique: 0
});

const defaultPixelation = (): PixelationState => ({
	enabled: false,
	granularity: 30.0
});

const defaultGlitch = (): GlitchState => ({
	enabled: false,
	delay: 2.5,
	duration: 0.8,
	strength: 0.65,
	ratio: 0.85,
	columns: 0.05,
	mode: 1,
	blendFunction: 23 as BlendFunction,
	dtSize: 64
});

const defaultNoise = (): NoiseState => ({
	enabled: false,
	premultiply: false,
	blendFunction: 28 as BlendFunction
});

const defaultChromaticAberration = (): ChromaticAberrationState => ({
	enabled: false,
	radialModulation: false,
	modulationOffset: 0.15,
	offsetX: 0.01,
	offsetY: 0.01,
	blendFunction: 23 as BlendFunction
});

const defaultBrightnessContrast = (): BrightnessContrastState => ({
	enabled: false,
	brightness: 0,
	contrast: 0,
	blendFunction: 23 as BlendFunction
});

const defaultHueSaturation = (): HueSaturationState => ({
	enabled: false,
	hue: 0,
	saturation: 0,
	blendFunction: 23 as BlendFunction
});

const defaultSepia = (): SepiaState => ({
	enabled: false,
	intensity: 1.0,
	blendFunction: 23 as BlendFunction
});

const defaultDotScreen = (): DotScreenState => ({
	enabled: false,
	angle: 1.57,
	scale: 1.0,
	blendFunction: 23 as BlendFunction
});

const defaultScanline = (): ScanlineState => ({
	enabled: false,
	density: 1.25,
	opacity: 0.5,
	scrollSpeed: 0,
	blendFunction: 25 as BlendFunction
});

const defaultShockWave = (): ShockWaveState => ({
	enabled: false,
	speed: 1.25,
	maxRadius: 0.5,
	waveSize: 0.2,
	amplitude: 0.05,
	epicenterX: 0,
	epicenterY: 0,
	epicenterZ: 0,
	triggered: false
});

const defaultASCII = (): ASCIIState => ({
	enabled: false,
	cellSize: 16,
	inverted: false
});

const defaultToneMapping = (): ToneMappingState => ({
	enabled: false,
	mode: 7 as ToneMappingMode, // ToneMappingMode.ACES_FILMIC
	whitePoint: 4.0,
	middleGrey: 0.6,
	blendFunction: 23 as BlendFunction,
	resolution: 256,
	minLuminance: 0.01,
	averageLuminance: 1.0,
	adaptationRate: 1.0
});

const defaultGrid = (): GridState => ({
	enabled: false,
	scale: 1.0,
	lineWidth: 0.0,
	blendFunction: 25 as BlendFunction
});

const defaultTiltShift = (): TiltShiftState => ({
	enabled: false,
	offset: 0.0,
	rotation: 0.0,
	focusArea: 0.4,
	feather: 0.3,
	kernelSize: 3 as KernelSize,
	blendFunction: 23 as BlendFunction
});

const defaultLensDistortion = (): LensDistortionState => ({
	enabled: false,
	distortionX: 0.0,
	distortionY: 0.0,
	principalX: 0.0,
	principalY: 0.0,
	focalLengthX: 1.0,
	focalLengthY: 1.0,
	skew: 0.0
});

const defaultColorDepth = (): ColorDepthState => ({
	enabled: false,
	bits: 16,
	blendFunction: 23 as BlendFunction
});

const defaultDepthOfField = (): DepthOfFieldState => ({
	enabled: false,
	focusDistance: 3.0,
	focusRange: 2.0,
	bokehScale: 1.0,
	blendFunction: 23 as BlendFunction,
	resolutionScale: 0.5
});

const defaultGodRays = (): GodRaysState => ({
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
	sunColor: 0xffddaa,
	resolutionScale: 0.5
});

const defaultSSAO = (): SSAOState => ({
	enabled: false,
	samples: 9,
	rings: 7,
	radius: 0.1825,
	intensity: 1.0,
	bias: 0.025,
	fade: 0.01,
	luminanceInfluence: 0.7,
	blendFunction: 7 as BlendFunction,
	worldDistanceThreshold: 0.97,
	worldDistanceFalloff: 0.03,
	worldProximityThreshold: 0.0005,
	worldProximityFalloff: 0.001,
	minRadiusScale: 0.1,
	color: 0x000000,
	depthAwareUpsampling: true,
	resolutionScale: 1.0
});

const defaultOutline = (): OutlineState => ({
	enabled: false,
	edgeStrength: 1.0,
	visibleEdgeColor: 0xffffff,
	hiddenEdgeColor: 0x22090a,
	pulseSpeed: 0.0,
	xRay: true,
	blur: false,
	kernelSize: 1 as KernelSize,
	blendFunction: 22 as BlendFunction,
	patternScale: 1.0,
	multisampling: 0,
	resolutionScale: 0.5
});

const defaultDepthEffect = (): DepthEffectState => ({
	enabled: false,
	inverted: false,
	blendFunction: 23 as BlendFunction
});

const defaultState = (): PostProcessingState => ({
	bloom: defaultBloom(),
	smaa: defaultSMAA(),
	fxaa: defaultFXAA(),
	vignette: defaultVignette(),
	pixelation: defaultPixelation(),
	glitch: defaultGlitch(),
	noise: defaultNoise(),
	chromaticAberration: defaultChromaticAberration(),
	brightnessContrast: defaultBrightnessContrast(),
	hueSaturation: defaultHueSaturation(),
	sepia: defaultSepia(),
	dotScreen: defaultDotScreen(),
	scanline: defaultScanline(),
	shockWave: defaultShockWave(),
	ascii: defaultASCII(),
	toneMapping: defaultToneMapping(),
	grid: defaultGrid(),
	tiltShift: defaultTiltShift(),
	lensDistortion: defaultLensDistortion(),
	colorDepth: defaultColorDepth(),
	depthOfField: defaultDepthOfField(),
	godRays: defaultGodRays(),
	ssao: defaultSSAO(),
	outline: defaultOutline(),
	depthEffect: defaultDepthEffect()
});

const loadPresets = (): PostProcessingPreset[] => {
	try {
		const stored = localStorage.getItem(PRESETS_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
};

const savePresets = (presets: PostProcessingPreset[]) => {
	try {
		localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
	} catch {
		/* ignore */
	}
};

export const postprocessingState = $state<PostProcessingState>(defaultState());

export const postprocessingPresetsState = $state<{
	presets: PostProcessingPreset[];
	currentPresetId: string | null;
}>({
	presets: loadPresets(),
	currentPresetId: null
});

export const postprocessingActions = {
	resetAll() {
		const defaults = defaultState();
		const state = postprocessingState;
		for (const key of Object.keys(defaults)) {
			(state as any)[key] = defaults[key as keyof PostProcessingState];
		}
		postprocessingPresetsState.currentPresetId = null;
		logPostprocessing.info('All effects reset to defaults');
	},

	resetEffect(effectName: string) {
		const state = postprocessingState;
		const defaults: Record<string, () => any> = {
			bloom: defaultBloom,
			smaa: defaultSMAA,
			fxaa: defaultFXAA,
			vignette: defaultVignette,
			pixelation: defaultPixelation,
			glitch: defaultGlitch,
			noise: defaultNoise,
			chromaticAberration: defaultChromaticAberration,
			brightnessContrast: defaultBrightnessContrast,
			hueSaturation: defaultHueSaturation,
			sepia: defaultSepia,
			dotScreen: defaultDotScreen,
			scanline: defaultScanline,
			shockWave: defaultShockWave,
			ascii: defaultASCII,
			toneMapping: defaultToneMapping,
			grid: defaultGrid,
			tiltShift: defaultTiltShift,
			lensDistortion: defaultLensDistortion,
			colorDepth: defaultColorDepth,
			depthOfField: defaultDepthOfField,
			godRays: defaultGodRays,
			ssao: defaultSSAO,
			outline: defaultOutline,
			depthEffect: defaultDepthEffect
		};

		const defaultFn = defaults[effectName];
		if (!defaultFn) {
			logPostprocessing.warn(`Unknown effect: ${effectName}`);
			return;
		}

		(state as any)[effectName] = defaultFn();
		logPostprocessing.info(`Reset effect: ${effectName}`);
	},

	savePreset(name: string): { success: boolean; error?: string } {
		const trimmedName = name.trim();
		if (!trimmedName) {
			return { success: false, error: 'Name cannot be empty' };
		}
		const state = postprocessingState;
		const hasEnabledEffect =
			state.bloom.enabled ||
			state.smaa.enabled ||
			state.fxaa.enabled ||
			state.vignette.enabled ||
			state.pixelation.enabled ||
			state.glitch.enabled ||
			state.noise.enabled ||
			state.chromaticAberration.enabled ||
			state.brightnessContrast.enabled ||
			state.hueSaturation.enabled ||
			state.sepia.enabled ||
			state.dotScreen.enabled ||
			state.scanline.enabled ||
			state.shockWave.enabled ||
			state.ascii.enabled ||
			state.toneMapping.enabled ||
			state.grid.enabled ||
			state.tiltShift.enabled ||
			state.lensDistortion.enabled ||
			state.colorDepth.enabled ||
			state.depthOfField.enabled ||
			state.godRays.enabled ||
			state.ssao.enabled ||
			state.outline.enabled ||
			state.depthEffect.enabled;
		if (!hasEnabledEffect) {
			return { success: false, error: 'No effects enabled' };
		}
		const duplicate = postprocessingPresetsState.presets.find(
			(p) => p.name.toLowerCase() === trimmedName.toLowerCase()
		);
		if (duplicate) {
			return { success: false, error: 'Name already exists' };
		}
		const id = crypto.randomUUID();
		const preset: PostProcessingPreset = {
			id,
			name: trimmedName,
			createdAt: Date.now(),
			settings: JSON.parse(JSON.stringify(postprocessingState))
		};
		postprocessingPresetsState.presets = [...postprocessingPresetsState.presets, preset];
		savePresets(postprocessingPresetsState.presets);
		postprocessingPresetsState.currentPresetId = id;
		logPostprocessing.info(`Preset saved: "${trimmedName}"`);
		return { success: true };
	},

	loadPreset(presetId: string) {
		const preset = postprocessingPresetsState.presets.find((p) => p.id === presetId);
		if (!preset) return;
		const state = postprocessingState;
		const settings = preset.settings;
		for (const key of Object.keys(settings)) {
			(state as any)[key] = JSON.parse(JSON.stringify((settings as any)[key]));
		}
		postprocessingPresetsState.currentPresetId = presetId;
		logPostprocessing.info(`Preset loaded: "${preset.name}"`);
	},

	deletePreset(presetId: string) {
		const isCurrentPreset = postprocessingPresetsState.currentPresetId === presetId;
		const presetName = postprocessingPresetsState.presets.find((p) => p.id === presetId)?.name;
		postprocessingPresetsState.presets = postprocessingPresetsState.presets.filter(
			(p) => p.id !== presetId
		);
		savePresets(postprocessingPresetsState.presets);
		logPostprocessing.info(
			`Preset deleted: "${presetName}"${isCurrentPreset ? ' (was active)' : ''}`
		);
		if (isCurrentPreset) {
			const state = postprocessingState;
			state.bloom.enabled = false;
			state.smaa.enabled = false;
			state.fxaa.enabled = false;
			state.vignette.enabled = false;
			state.pixelation.enabled = false;
			state.glitch.enabled = false;
			state.noise.enabled = false;
			state.chromaticAberration.enabled = false;
			state.brightnessContrast.enabled = false;
			state.hueSaturation.enabled = false;
			state.sepia.enabled = false;
			state.dotScreen.enabled = false;
			state.scanline.enabled = false;
			state.shockWave.enabled = false;
			state.ascii.enabled = false;
			state.toneMapping.enabled = false;
			state.grid.enabled = false;
			state.tiltShift.enabled = false;
			state.lensDistortion.enabled = false;
			state.colorDepth.enabled = false;
			state.depthOfField.enabled = false;
			state.godRays.enabled = false;
			state.ssao.enabled = false;
			state.outline.enabled = false;
			state.depthEffect.enabled = false;
			postprocessingPresetsState.currentPresetId = null;
		}
	},

	renamePreset(presetId: string, newName: string) {
		const preset = postprocessingPresetsState.presets.find((p) => p.id === presetId);
		if (preset) {
			const oldName = preset.name;
			preset.name = newName;
			postprocessingPresetsState.presets = [...postprocessingPresetsState.presets];
			savePresets(postprocessingPresetsState.presets);
			logPostprocessing.info(`Preset renamed: "${oldName}" -> "${newName}"`);
		}
	},

	getCurrentPresetName(): string | null {
		if (!postprocessingPresetsState.currentPresetId) return null;
		const preset = postprocessingPresetsState.presets.find(
			(p) => p.id === postprocessingPresetsState.currentPresetId
		);
		return preset?.name ?? null;
	}
};
