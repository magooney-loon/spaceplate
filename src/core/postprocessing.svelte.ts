import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';
import { logPostprocessing } from './logger.svelte.js';

const PRESETS_KEY = 'spaceplate-postprocessing-presets';

export interface PostProcessingPreset {
	id: string;
	name: string;
	createdAt: number;
	settings: PostProcessingState;
}

export interface PostProcessingState {
	bloom: {
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
	smaa: {
		enabled: boolean;
		preset: number;
		edgeDetectionMode: number;
		predicationMode: number;
	};
	fxaa: {
		enabled: boolean;
		minEdgeThreshold: number;
		maxEdgeThreshold: number;
		subpixelQuality: number;
	};
	vignette: {
		enabled: boolean;
		offset: number;
		darkness: number;
		technique: number;
	};
	pixelation: {
		enabled: boolean;
		granularity: number;
	};
	glitch: {
		enabled: boolean;
		delay: number;
		duration: number;
		strength: number;
		ratio: number;
		columns: number;
		mode: number;
		blendFunction: BlendFunction;
		dtSize: number;
	};
	noise: {
		enabled: boolean;
		premultiply: boolean;
		blendFunction: BlendFunction;
	};
	chromaticAberration: {
		enabled: boolean;
		radialModulation: boolean;
		modulationOffset: number;
		offsetX: number;
		offsetY: number;
		blendFunction: BlendFunction;
	};
	brightnessContrast: {
		enabled: boolean;
		brightness: number;
		contrast: number;
		blendFunction: BlendFunction;
	};
	hueSaturation: {
		enabled: boolean;
		hue: number;
		saturation: number;
		blendFunction: BlendFunction;
	};
	sepia: {
		enabled: boolean;
		intensity: number;
		blendFunction: BlendFunction;
	};
	dotScreen: {
		enabled: boolean;
		angle: number;
		scale: number;
		blendFunction: BlendFunction;
	};
	scanline: {
		enabled: boolean;
		density: number;
		opacity: number;
		scrollSpeed: number;
		blendFunction: BlendFunction;
	};
	shockWave: {
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
	ascii: {
		enabled: boolean;
		cellSize: number;
		inverted: boolean;
	};
	toneMapping: {
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
	grid: {
		enabled: boolean;
		scale: number;
		lineWidth: number;
		blendFunction: BlendFunction;
	};
	tiltShift: {
		enabled: boolean;
		offset: number;
		rotation: number;
		focusArea: number;
		feather: number;
		kernelSize: KernelSize;
		blendFunction: BlendFunction;
	};
	lensDistortion: {
		enabled: boolean;
		distortionX: number;
		distortionY: number;
		principalX: number;
		principalY: number;
		focalLengthX: number;
		focalLengthY: number;
		skew: number;
	};
	colorDepth: {
		enabled: boolean;
		bits: number;
		blendFunction: BlendFunction;
	};
	depthOfField: {
		enabled: boolean;
		focusDistance: number;
		focusRange: number;
		bokehScale: number;
		blendFunction: BlendFunction;
		resolutionScale: number;
	};
	godRays: {
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
	ssao: {
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
	outline: {
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
	depthEffect: {
		enabled: boolean;
		inverted: boolean;
		blendFunction: BlendFunction;
	};
}

const defaultState = (): PostProcessingState => ({
	bloom: {
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
	},
	smaa: {
		enabled: false,
		preset: 2,
		edgeDetectionMode: 2,
		predicationMode: 0
	},
	fxaa: {
		enabled: false,
		minEdgeThreshold: 0.05,
		maxEdgeThreshold: 0.12,
		subpixelQuality: 0.75
	},
	vignette: {
		enabled: false,
		offset: 0.5,
		darkness: 0.5,
		technique: 0
	},
	pixelation: {
		enabled: false,
		granularity: 30.0
	},
	glitch: {
		enabled: false,
		delay: 2.5,
		duration: 0.8,
		strength: 0.65,
		ratio: 0.85,
		columns: 0.05,
		mode: 1,
		blendFunction: 23 as BlendFunction,
		dtSize: 64
	},
	noise: {
		enabled: false,
		premultiply: false,
		blendFunction: 28 as BlendFunction
	},
	chromaticAberration: {
		enabled: false,
		radialModulation: false,
		modulationOffset: 0.15,
		offsetX: 0.01,
		offsetY: 0.01,
		blendFunction: 23 as BlendFunction
	},
	brightnessContrast: {
		enabled: false,
		brightness: 0,
		contrast: 0,
		blendFunction: 23 as BlendFunction
	},
	hueSaturation: {
		enabled: false,
		hue: 0,
		saturation: 0,
		blendFunction: 23 as BlendFunction
	},
	sepia: {
		enabled: false,
		intensity: 1.0,
		blendFunction: 23 as BlendFunction
	},
	dotScreen: {
		enabled: false,
		angle: 1.57,
		scale: 1.0,
		blendFunction: 23 as BlendFunction
	},
	scanline: {
		enabled: false,
		density: 1.25,
		opacity: 0.5,
		scrollSpeed: 0,
		blendFunction: 25 as BlendFunction
	},
	shockWave: {
		enabled: false,
		speed: 1.25,
		maxRadius: 0.5,
		waveSize: 0.2,
		amplitude: 0.05,
		epicenterX: 0,
		epicenterY: 0,
		epicenterZ: 0,
		triggered: false
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
		middleGrey: 0.6,
		blendFunction: 23 as BlendFunction,
		resolution: 256,
		minLuminance: 0.01,
		averageLuminance: 1.0,
		adaptationRate: 1.0
	},
	grid: {
		enabled: false,
		scale: 1.0,
		lineWidth: 0.0,
		blendFunction: 25 as BlendFunction
	},
	tiltShift: {
		enabled: false,
		offset: 0.0,
		rotation: 0.0,
		focusArea: 0.4,
		feather: 0.3,
		kernelSize: 3 as KernelSize,
		blendFunction: 23 as BlendFunction
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
	},
	colorDepth: {
		enabled: false,
		bits: 16,
		blendFunction: 23 as BlendFunction
	},
	depthOfField: {
		enabled: false,
		focusDistance: 3.0,
		focusRange: 2.0,
		bokehScale: 1.0,
		blendFunction: 23 as BlendFunction,
		resolutionScale: 0.5
	},
	godRays: {
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
	},
	ssao: {
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
	},
	outline: {
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
	},
	depthEffect: {
		enabled: false,
		inverted: false,
		blendFunction: 23 as BlendFunction
	}
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
		for (const key of Object.keys(defaults)) {
			(postprocessingState as any)[key] = defaults[key as keyof PostProcessingState];
		}
		postprocessingPresetsState.currentPresetId = null;
		logPostprocessing.info('All effects reset to defaults');
	},

	savePreset(name: string): { success: boolean; error?: string } {
		const trimmedName = name.trim();
		if (!trimmedName) {
			return { success: false, error: 'Name cannot be empty' };
		}
		const stateAny = postprocessingState as any;
		const hasEnabledEffect =
			stateAny.bloom?.enabled ||
			stateAny.smaa?.enabled ||
			stateAny.fxaa?.enabled ||
			stateAny.vignette?.enabled ||
			stateAny.pixelation?.enabled ||
			stateAny.glitch?.enabled ||
			stateAny.noise?.enabled ||
			stateAny.chromaticAberration?.enabled ||
			stateAny.brightnessContrast?.enabled ||
			stateAny.hueSaturation?.enabled ||
			stateAny.sepia?.enabled ||
			stateAny.dotScreen?.enabled ||
			stateAny.scanline?.enabled ||
			stateAny.shockWave?.enabled ||
			stateAny.ascii?.enabled ||
			stateAny.toneMapping?.enabled ||
			stateAny.grid?.enabled ||
			stateAny.tiltShift?.enabled ||
			stateAny.lensDistortion?.enabled ||
			stateAny.colorDepth?.enabled ||
			stateAny.depthOfField?.enabled ||
			stateAny.godRays?.enabled ||
			stateAny.ssao?.enabled ||
			stateAny.outline?.enabled ||
			stateAny.depthEffect?.enabled;
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
		const settings = preset.settings;
		for (const key of Object.keys(settings)) {
			(postprocessingState as any)[key] = JSON.parse(JSON.stringify((settings as any)[key]));
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
			postprocessingState.bloom.enabled = false;
			postprocessingState.smaa.enabled = false;
			postprocessingState.fxaa.enabled = false;
			postprocessingState.vignette.enabled = false;
			postprocessingState.pixelation.enabled = false;
			postprocessingState.glitch.enabled = false;
			postprocessingState.noise.enabled = false;
			postprocessingState.chromaticAberration.enabled = false;
			postprocessingState.brightnessContrast.enabled = false;
			postprocessingState.hueSaturation.enabled = false;
			postprocessingState.sepia.enabled = false;
			postprocessingState.dotScreen.enabled = false;
			postprocessingState.scanline.enabled = false;
			postprocessingState.shockWave.enabled = false;
			postprocessingState.ascii.enabled = false;
			postprocessingState.toneMapping.enabled = false;
			postprocessingState.grid.enabled = false;
			postprocessingState.tiltShift.enabled = false;
			postprocessingState.lensDistortion.enabled = false;
			postprocessingState.colorDepth.enabled = false;
			postprocessingState.depthOfField.enabled = false;
			postprocessingState.godRays.enabled = false;
			postprocessingState.ssao.enabled = false;
			postprocessingState.outline.enabled = false;
			postprocessingState.depthEffect.enabled = false;
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
