import { logEngine } from '$extensions/logger';
// Direct path on purpose (not the '$core' barrel): Loader.svelte imports this module
// for the boot warmup, and the barrel exports Loader — a module cycle. globalAudio
// is a leaf, so importing it directly breaks the ring.
import { soundActions } from '$core/audio/globalAudio.svelte';
import { bootState } from '$core/utils/boot.svelte';
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
// never from an $effect. See the per-scene `environment` plan in
// src/extensions/scene/CLAUDE.md.

// --- State & actions ---

export const sceneState = $state<ExtensionState>({
	currentScene: 'mainMenu',
	previousScene: null,
	isTransitioning: false,
	// The boot scene counts as visited; every other scene mounts on first visit.
	visited: { mainMenu: true, demoScene: false }
});

export const sceneActions: ExtensionActions = {
	setScene(scene: SceneType) {
		if (sceneState.currentScene === scene) return;

		logEngine.info(`Scene: ${sceneState.currentScene} → ${scene}`);
		soundActions.playSwoosh();

		sceneState.previousScene = sceneState.currentScene;
		sceneState.currentScene = scene;
		sceneState.visited[scene] = true;
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

	/**
	 * Boot-only scene warmup sweep, called by Loader.svelte once assets have settled
	 * (the loading screen is still covering the canvas). For every scene not yet
	 * current: flip to it — mounting its components via the visited latch, with no
	 * swoosh/transition log — wait for the mount to flush, then ask Renderer.svelte
	 * (bootState.warmVersion) for a warm frame through the real render pipeline so
	 * every material variant compiles while nothing is visible.
	 *
	 * Scenes STAY mounted after this (Scene.svelte only toggles `visible`), so the
	 * compiled pipelines survive — an `{#if}` unmount would dispose materials and
	 * evict three's caches, making the whole sweep worthless.
	 *
	 * The grace delay after each warm frame is a fixed budget, not a completion
	 * signal: three compiles pipelines asynchronously (createRenderPipelineAsync) and
	 * exposes no awaitable handle for passes it renders internally, so there is
	 * nothing to await — the prompt's own delay covers any stragglers.
	 *
	 * Note: flipping currentScene briefly runs scene-gated things behind the loader
	 * (the Rapier sim steps while 'demoScene' is current, Studio's panel follows the
	 * flip) — invisible to the user and over in ~WARM_GRACE_MS per scene.
	 */
	async warmupScenes() {
		if (bootState.scenesWarmed) return;

		const started = performance.now();
		const original = sceneState.currentScene;
		let step = 0;

		try {
			for (const { id } of SCENES) {
				if (sceneState.currentScene !== id) {
					sceneState.currentScene = id; // direct write: no swoosh, no transition log
					sceneState.visited[id] = true;
					// Two rAFs: one for the Svelte mount effects to flush (T attachments),
					// one for the new objects to be seen by the next render.
					await nextFrame();
					await nextFrame();
				}
				bootState.warmVersion++; // Renderer.svelte warm-renders this configuration
				// Progress feeds the Loader's second bar pass; set before the grace so the
				// climb is visible while compilation runs in the background.
				bootState.warmProgress = ++step / SCENES.length;
				await delay(WARM_GRACE_MS);
			}

			logEngine.info(
				`Scenes warmed in ${(performance.now() - started).toFixed(0)}ms — staying mounted, switches are visibility-only`
			);
		} finally {
			// Latch and restore no matter what — a failed sweep must never wedge the
			// loader (the sound prompt gates on scenesWarmed) or leave the wrong scene showing.
			sceneState.currentScene = original;
			bootState.warmProgress = 1;
			bootState.scenesWarmed = true;
		}
	}
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Per-scene budget for background pipeline compilation after a warm frame. */
const WARM_GRACE_MS = 250;
