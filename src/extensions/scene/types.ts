export const extensionScope = 'scene';

export type SceneType = 'mainMenu' | 'demoScene';

export type SceneConfig = {
	id: SceneType;
	label: string;
	icon: string;
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
};
