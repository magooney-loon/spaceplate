import { logPostprocessing } from '$extensions/logger';
import { BUNDLED_PP_PRESETS } from './bundledPresets';
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
	strength: 1,
	radius: 0,
	threshold: 0
});

const defaultSMAA = (): SMAAState => ({
	enabled: false
});

const defaultFXAA = (): FXAAState => ({
	enabled: false
});

const defaultVignette = (): VignetteState => ({
	enabled: false,
	intensity: 0.4,
	smoothness: 0.5
});

const defaultPixelation = (): PixelationState => ({
	enabled: false,
	pixelSize: 6,
	normalEdgeStrength: 0.3,
	depthEdgeStrength: 0.4
});

const defaultGlitch = (): GlitchState => ({
	enabled: false,
	delay: 2.5,
	duration: 0.8,
	strength: 0.65,
	ratio: 0.85,
	columns: 0.05,
	mode: 1,
	dtSize: 64
});

const defaultNoise = (): NoiseState => ({
	enabled: false,
	intensity: 0.35
});

const defaultChromaticAberration = (): ChromaticAberrationState => ({
	enabled: false,
	strength: 0.5,
	scale: 1.1
});

const defaultBrightnessContrast = (): BrightnessContrastState => ({
	enabled: false,
	brightness: 0,
	contrast: 0
});

const defaultHueSaturation = (): HueSaturationState => ({
	enabled: false,
	hue: 0,
	saturation: 1
});

const defaultSepia = (): SepiaState => ({
	enabled: false,
	intensity: 1.0
});

const defaultDotScreen = (): DotScreenState => ({
	enabled: false,
	angle: 1.57,
	scale: 1.0
});

const defaultScanline = (): ScanlineState => ({
	enabled: false,
	intensity: 0.3,
	count: 240,
	speed: 0
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
	mode: 4, // THREE.ACESFilmicToneMapping
	exposure: 1.0
});

const defaultGrid = (): GridState => ({
	enabled: false,
	scale: 1.0,
	lineWidth: 0.02
});

const defaultTiltShift = (): TiltShiftState => ({
	enabled: false,
	offset: 0.0,
	rotation: 0.0,
	focusArea: 0.4,
	feather: 0.3
});

const defaultLensDistortion = (): LensDistortionState => ({
	enabled: false,
	curvature: 0.1
});

const defaultColorDepth = (): ColorDepthState => ({
	enabled: false,
	steps: 16
});

const defaultDepthOfField = (): DepthOfFieldState => ({
	enabled: false,
	focusDistance: 1,
	focalLength: 1,
	bokehScale: 1
});

const defaultGodRays = (): GodRaysState => ({
	enabled: false,
	samples: 60,
	density: 0.7,
	maxDensity: 0.5,
	distanceAttenuation: 2,
	resolutionScale: 0.5,
	sunX: 0,
	sunY: 5,
	sunZ: 0,
	sunColor: 0xffddaa
});

const defaultSSAO = (): SSAOState => ({
	enabled: false,
	radius: 0.25,
	thickness: 1,
	scale: 1,
	samples: 16
});

const defaultOutline = (): OutlineState => ({
	enabled: false,
	edgeStrength: 3.0,
	edgeGlow: 0.0,
	edgeThickness: 1.0,
	pulseSpeed: 0.0,
	visibleEdgeColor: 0xffffff,
	hiddenEdgeColor: 0x22090a
});

const defaultDepthEffect = (): DepthEffectState => ({
	enabled: false,
	inverted: false
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
	let stored: PostProcessingPreset[] = [];
	try {
		const raw = localStorage.getItem(PRESETS_KEY);
		stored = raw ? JSON.parse(raw) : [];
	} catch {
		/* ignore */
	}
	// Merge: bundled first, then localStorage additions (localStorage wins on id conflict)
	const merged = [...BUNDLED_PP_PRESETS];
	for (const preset of stored) {
		if (!merged.find((p) => p.id === preset.id)) {
			merged.push(preset);
		}
	}
	return merged;
};

const savePresets = (presets: PostProcessingPreset[]) => {
	try {
		const toStore = presets.filter((p) => !BUNDLED_PP_PRESETS.find((b) => b.id === p.id));
		localStorage.setItem(PRESETS_KEY, JSON.stringify(toStore));
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

		const wasEnabled = (state as any)[effectName]?.enabled ?? false;
		(state as any)[effectName] = { ...defaultFn(), enabled: wasEnabled };
		logPostprocessing.info(`Reset effect: ${effectName}`);
	},

	explodeShockWave() {
		postprocessingState.shockWave.triggered = true;
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
		if (BUNDLED_PP_PRESETS.find((p) => p.id === presetId)) {
			logPostprocessing.warn(`Cannot delete bundled preset`);
			return;
		}
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
	},

	updatePreset(presetId: string): { success: boolean; error?: string } {
		if (BUNDLED_PP_PRESETS.find((p) => p.id === presetId)) {
			return { success: false, error: 'Cannot update a bundled preset' };
		}
		const preset = postprocessingPresetsState.presets.find((p) => p.id === presetId);
		if (!preset) {
			return { success: false, error: 'Preset not found' };
		}
		preset.settings = JSON.parse(JSON.stringify(postprocessingState));
		postprocessingPresetsState.presets = [...postprocessingPresetsState.presets];
		savePresets(postprocessingPresetsState.presets);
		logPostprocessing.info(`Preset updated: "${preset.name}"`);
		return { success: true };
	}
};
