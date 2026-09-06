import { logEngine } from '$extensions/logger';
// Direct path on purpose (not the '$core' barrel): Loader.svelte imports this module
// for the scene-transition veil, and the barrel exports Loader — a module cycle.
// globalAudio is a leaf, so importing it directly breaks the ring.
import { soundActions } from '$core/audio/globalAudio.svelte';
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
	/** Instant swap — boot, the Studio panel and other programmatic callers. */
	setScene(scene: SceneType) {
		if (sceneState.currentScene === scene) return;

		logEngine.info(`Scene: ${sceneState.currentScene} → ${scene}`);
		soundActions.playSwoosh();

		sceneState.previousScene = sceneState.currentScene;
		sceneState.currentScene = scene;
	},

	goToMainMenu() {
		void this.transitionTo('mainMenu');
	},

	goToDemoScene() {
		void this.transitionTo('demoScene');
	},

	goToTestGame() {
		void this.transitionTo('testGame');
	},

	goBack() {
		if (sceneState.previousScene) {
			void this.transitionTo(sceneState.previousScene);
		}
	},

	/**
	 * Warm scene transition — the per-scene "bootloader". Every user-facing switch
	 * goes through here (the goTo* actions); the swap happens under a full-screen veil
	 * (Loader.svelte, driven by isTransitioning) so the entry cost is never on screen:
	 *
	 *   1. veil drops — two rAFs so it has actually painted before anything moves
	 *   2. setScene swaps the scene ({#if} routing: old unmounts, new mounts — the
	 *      swoosh fires here, under the cover)
	 *   3. two more rAFs: one for the Svelte mount effects to flush (T attachments),
	 *      one for the new scene to be rendered — that first frame is the warm frame:
	 *      it goes through the real pipeline, kicking three's async pipeline
	 *      compilation (createRenderPipelineAsync) for every material variant of the
	 *      new scene, MRT contextNode included — the variants renderer.compileAsync
	 *      cannot produce (postprocessing/CLAUDE.md's shader-cache trap)
	 *   4. a grace budget while the compiles land in the background, then the veil lifts
	 *
	 * The grace is a fixed budget, not a completion signal: three exposes no awaitable
	 * handle for passes it compiles internally, so there is nothing to await. Anything
	 * not compiled when the veil lifts finishes off-screen-ish, same as before this
	 * existed — the veil only moves the bulk of the stall somewhere invisible.
	 *
	 * No warm frame is forced by hand: mounting a scene's T.* attachments invalidate,
	 * and on-demand rendering draws the frame by itself — forcing one from here would
	 * need Threlte context this module (outside the Canvas) does not have.
	 */
	async transitionTo(scene: SceneType) {
		if (sceneState.currentScene === scene || sceneState.isTransitioning) return;

		sceneState.isTransitioning = true;

		try {
			// Cover first — the veil must be on screen before the old scene disappears.
			await nextFrame();
			await nextFrame();

			this.setScene(scene);

			// Warm: mount flush, then the first rendered frame of the new scene.
			await nextFrame();
			await nextFrame();
			await delay(WARM_GRACE_MS);
		} finally {
			sceneState.isTransitioning = false;
		}
	}
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Post-swap budget for background pipeline compilation, under the veil. */
const WARM_GRACE_MS = 450;
