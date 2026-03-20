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

// --- Scene preset overrides (Studio dev overrides, stored in localStorage) ---

const SCENE_PRESETS_OVERRIDE_KEY = 'spaceplate-scene-preset-overrides';

type ScenePresetOverride = {
	postprocessing?: string | null;
	skybox?: string | null;
};

const loadScenePresetOverrides = (): Partial<Record<SceneType, ScenePresetOverride>> => {
	try {
		const raw = localStorage.getItem(SCENE_PRESETS_OVERRIDE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
};

const saveScenePresetOverrides = (overrides: Partial<Record<SceneType, ScenePresetOverride>>) => {
	try {
		localStorage.setItem(SCENE_PRESETS_OVERRIDE_KEY, JSON.stringify(overrides));
	} catch {
		/* ignore */
	}
};

export const scenePresetsOverrides = $state<Partial<Record<SceneType, ScenePresetOverride>>>(
	loadScenePresetOverrides()
);

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
	}
};
