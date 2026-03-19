import { logEngine } from './logger.svelte.js';

// ============================================================================
// Scene Configuration
// ============================================================================

export type SceneType = 'mainMenu' | 'demoScene';

export type SceneConfig = {
	id: SceneType;
	label: string;
	icon: string;
};

export const SCENES: SceneConfig[] = [
	{
		id: 'mainMenu',
		label: 'Main Menu',
		icon: 'mdiHome'
	},
	{
		id: 'demoScene',
		label: 'Demo Scene',
		icon: 'mdiEarth'
	}
];

// ============================================================================
// Scene State
// ============================================================================

export interface SceneState {
	currentScene: SceneType;
	previousScene: SceneType | null;
	isTransitioning: boolean;
}

export const sceneState = $state<SceneState>({
	currentScene: 'mainMenu',
	previousScene: null,
	isTransitioning: false
});

// ============================================================================
// Scene Actions
// ============================================================================

export const sceneActions = {
	setScene(scene: SceneType) {
		if (sceneState.currentScene === scene) return;

		logEngine.info(`Scene: ${sceneState.currentScene} → ${scene}`);

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

// ============================================================================
// Hook for accessing scene manager (Svelte 5 rune pattern)
// ============================================================================

export const useSceneManager = () => {
	return {
		state: sceneState,
		actions: sceneActions,
		scenes: SCENES
	};
};
