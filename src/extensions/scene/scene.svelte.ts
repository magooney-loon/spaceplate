import { logEngine } from '$extensions/logger';
import { soundActions } from '$core';
import type { SceneType, SceneConfig, ExtensionState, ExtensionActions } from './types';

export type { ExtensionState, ExtensionActions } from './types';

export const SCENES: SceneConfig[] = [
	{ id: 'mainMenu', label: 'Main Menu', icon: 'mdiHome' },
	{ id: 'demoScene', label: 'Demo Scene', icon: 'mdiEarth' }
];

// Per-scene look (post-processing / time / weather) is NOT configured here. The old
// preset-assignment layer that used to live in this file -- bundled global + per-scene
// preset IDs, localStorage overrides, and two resolvers -- was deleted: it resolved to
// null for every input and served zero presets. Its replacement is a declarative
// `environment` block on each SCENES entry, applied imperatively from setScene() and
// never from an $effect. See DOCS/scene-environment.md.

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
	}
};
