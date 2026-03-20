export const extensionScope = 'scene';

export type SceneType = 'mainMenu' | 'demoScene';

export type ScenePresets = {
	postprocessing?: string;
	skybox?: string;
};

export type SceneConfig = {
	id: SceneType;
	label: string;
	icon: string;
	presets?: ScenePresets;
};

export type SceneState = {
	currentScene: SceneType;
	previousScene: SceneType | null;
	isTransitioning: boolean;
};

export type ExtensionState = SceneState;

export type ExtensionActions = {
	setScene: (scene: SceneType) => void;
	goToMainMenu: () => void;
	goToDemoScene: () => void;
	goBack: () => void;
	transitionTo: (scene: SceneType, transitionDuration?: number) => Promise<void>;
	setScenePreset: (sceneId: SceneType, type: 'postprocessing' | 'skybox', presetId: string | null) => void;
	clearScenePreset: (sceneId: SceneType, type: 'postprocessing' | 'skybox') => void;
};
