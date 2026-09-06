import { logEngine } from '$extensions/logger';
import { soundActions } from '$core';
import type { SceneType, SceneConfig, ExtensionState, ExtensionActions } from './types';

export type { ExtensionState, ExtensionActions } from './types';

export const SCENES: SceneConfig[] = [
	{ id: 'mainMenu', label: 'Main Menu', icon: 'mdiHome' },
	{ id: 'demoScene', label: 'Demo Scene', icon: 'mdiEarth' },
	{ id: 'testGame', label: 'Test Game', icon: 'mdiCar' }
];

// Per-scene look (post-processing / time / weather) is NOT configured here — the old
// preset layer was deleted (it resolved to null for every input and served zero
// presets). Its replacement is a declarative `environment` block on each SCENES entry,
// applied imperatively from setScene() and never from an $effect — see the plan in
// src/extensions/scene/CLAUDE.md.

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

	goToTestGame() {
		this.setScene('testGame');
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
