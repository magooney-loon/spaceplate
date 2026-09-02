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
	/**
	 * Keep-alive latch: a scene component mounts the first time it becomes current
	 * (or is visited by the boot warmup) and then stays mounted forever — Scene.svelte
	 * only toggles its group's `visible`. This is what makes scene switches cheap and
	 * what lets the boot warmup's compiled pipelines survive: an `{#if}` unmount runs
	 * `dispose()` on materials (evicting three's caches) and tears down Rapier bodies.
	 */
	visited: Record<SceneType, boolean>;
};

export type ExtensionState = SceneState;

export type ExtensionActions = {
	setScene: (scene: SceneType) => void;
	goToMainMenu: () => void;
	goToDemoScene: () => void;
	goBack: () => void;
	transitionTo: (scene: SceneType, transitionDuration?: number) => Promise<void>;
	/** Boot-only sweep: briefly visits every scene so it mounts + warm-renders. */
	warmupScenes: () => Promise<void>;
};
