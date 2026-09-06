export const extensionScope = 'scene';

export type SceneType = 'mainMenu' | 'demoScene' | 'testGame';

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
	goToTestGame: () => void;
	goBack: () => void;
	/** Warm swap under the veil: cover → setScene → first rendered frame → grace. */
	transitionTo: (scene: SceneType) => Promise<void>;
};
