import { logEngine } from '$extensions/logger/logger.svelte';
import { soundActions } from '$core/GlobalAudio.svelte';
import type {
	SceneType,
	SceneConfig,
	ScenePresets,
	ExtensionState,
	ExtensionActions
} from './types';

export type { ExtensionState, ExtensionActions, ScenePresets } from './types';

export const SCENES: SceneConfig[] = [
	{
		id: 'mainMenu',
		label: 'Main Menu',
		icon: 'mdiHome'
		// presets: { postprocessing: 'your-preset-id', skybox: 'your-preset-id' }
	},
	{
		id: 'demoScene',
		label: 'Demo Scene',
		icon: 'mdiEarth'
		// presets: { postprocessing: 'your-preset-id', skybox: 'your-preset-id' }
	}
];

// Global presets — applied as a base layer to ALL scenes.
// Scene presets stack on top (scene wins on same effect conflict).
// Commit preset IDs here to ship defaults with the game.
export const GLOBAL_PRESETS: ScenePresets = {
	// postprocessing: 'your-global-pp-preset-id',
	// skybox: 'your-global-skybox-preset-id',
};

// --- Overrides (Studio dev overrides, stored in localStorage) ---

const SCENE_PRESETS_OVERRIDE_KEY = 'spaceplate-scene-preset-overrides';
const GLOBAL_PRESETS_OVERRIDE_KEY = 'spaceplate-global-preset-override';

type PresetOverride = {
	postprocessing?: string | null;
	skybox?: string | null;
};

const loadScenePresetOverrides = (): Partial<Record<SceneType, PresetOverride>> => {
	try {
		const raw = localStorage.getItem(SCENE_PRESETS_OVERRIDE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
};

const loadGlobalPresetsOverride = (): PresetOverride => {
	try {
		const raw = localStorage.getItem(GLOBAL_PRESETS_OVERRIDE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
};

const saveScenePresetOverrides = (overrides: Partial<Record<SceneType, PresetOverride>>) => {
	try {
		localStorage.setItem(SCENE_PRESETS_OVERRIDE_KEY, JSON.stringify(overrides));
	} catch {
		/* ignore */
	}
};

const saveGlobalPresetsOverride = (override: PresetOverride) => {
	try {
		localStorage.setItem(GLOBAL_PRESETS_OVERRIDE_KEY, JSON.stringify(override));
	} catch {
		/* ignore */
	}
};

export const scenePresetsOverrides = $state<Partial<Record<SceneType, PresetOverride>>>(
	loadScenePresetOverrides()
);

export const globalPresetsOverride = $state<PresetOverride>(loadGlobalPresetsOverride());

// Resolver functions — reactive when called inside $derived / $effect.
// Priority: localStorage studio override → committed config → null

export function resolveScenePreset(sceneId: SceneType, type: keyof ScenePresets): string | null {
	const override = scenePresetsOverrides[sceneId];
	if (override && type in override) return (override as any)[type] ?? null;
	return SCENES.find((s) => s.id === sceneId)?.presets?.[type] ?? null;
}

export function resolveGlobalPreset(type: keyof ScenePresets): string | null {
	if (type in globalPresetsOverride) return (globalPresetsOverride as any)[type] ?? null;
	return GLOBAL_PRESETS[type] ?? null;
}

// --- State & actions ---

export const sceneState = $state<ExtensionState>({
	currentScene: 'mainMenu',
	previousScene: null,
	isTransitioning: false
});

export const sceneActions: ExtensionActions = {
	setScene(scene: SceneType) {
		if (sceneState.currentScene === scene) return;

		logEngine.info(`Scene: ${sceneState.currentScene} → ${scene}`);
		soundActions.playSwoosh();

		sceneState.previousScene = sceneState.currentScene;
		sceneState.currentScene = scene;
	},

	goToMainMenu() {
		this.setScene('mainMenu');
	},

	goToDemoScene() {
		this.setScene('demoScene');
	},

	goBack() {
		if (sceneState.previousScene) {
			this.setScene(sceneState.previousScene);
		}
	},

	async transitionTo(scene: SceneType, transitionDuration = 300) {
		if (sceneState.currentScene === scene) return;

		sceneState.isTransitioning = true;

		await new Promise((r) => setTimeout(r, transitionDuration / 2));
		this.setScene(scene);
		await new Promise((r) => setTimeout(r, transitionDuration / 2));

		sceneState.isTransitioning = false;
	},

	setScenePreset(sceneId: SceneType, type: 'postprocessing' | 'skybox', presetId: string | null) {
		const current = scenePresetsOverrides[sceneId] ?? {};
		scenePresetsOverrides[sceneId] = { ...current, [type]: presetId };
		saveScenePresetOverrides(scenePresetsOverrides);
		logEngine.info(`Scene preset [${sceneId}/${type}]: ${presetId ?? 'none'}`);
	},

	clearScenePreset(sceneId: SceneType, type: 'postprocessing' | 'skybox') {
		const current = { ...(scenePresetsOverrides[sceneId] ?? {}) };
		delete current[type];
		scenePresetsOverrides[sceneId] = current;
		saveScenePresetOverrides(scenePresetsOverrides);
		logEngine.info(`Scene preset cleared [${sceneId}/${type}]`);
	},

	setGlobalPreset(type: 'postprocessing' | 'skybox', presetId: string | null) {
		(globalPresetsOverride as any)[type] = presetId;
		saveGlobalPresetsOverride(globalPresetsOverride);
		logEngine.info(`Global preset [${type}]: ${presetId ?? 'none'}`);
	},

	clearGlobalPreset(type: 'postprocessing' | 'skybox') {
		delete (globalPresetsOverride as any)[type];
		saveGlobalPresetsOverride(globalPresetsOverride);
		logEngine.info(`Global preset cleared [${type}]`);
	}
};
