export const extensionScope = 'scene';

export type SceneType = 'mainMenu' | 'demoScene' | 'testGame';

export type SceneConfig = {
	id: SceneType;
	label: string;
	icon: string;
};

export type SceneState = {
	/** The MOUNTED 3D scene — what `Scene.svelte`'s `{#if}` routing follows. */
	currentScene: SceneType;
	/**
	 * The scene the player can actually SEE, which lags `currentScene` for the whole
	 * covered part of a transition: the swap happens at the start of the load and the
	 * reveal is at the end of it, so between the two a scene is mounted but hidden. HUDs
	 * route on this — see `src/SceneHud.svelte`.
	 */
	visibleScene: SceneType;
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
