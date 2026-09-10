import { logEngine } from '$extensions/logger';
// Direct path on purpose (not the '$core' barrel): Loader.svelte imports this module
// for the scene-transition veil, and the barrel exports Loader — a module cycle.
// globalAudio is a leaf, so importing it directly breaks the ring.
import { soundActions } from '$core/audio/globalAudio.svelte';
// Same reason for the direct paths: both gates are leaves (loading manager / renderer
// info + logger), so importing them cannot close the ring back through Loader.
import { waitForAssetsIdle } from '$core/utils/assetGate';
import { warmScene } from '$core/utils/warmup.svelte';
import { coverWithSnapshot, revealScene } from '$core/postprocessing/transitionState.svelte';
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
	 *   1. THE COVER — the pipeline freezes the outgoing scene's last frame and pins it
	 *      over the screen (core/postprocessing/transitionState.svelte.ts). The player
	 *      keeps looking at the world they were in, not at black. When there is no
	 *      pipeline to do it with, Loader.svelte's black veil covers instead and this
	 *      waits two rAFs for it to paint
	 *   2. setScene swaps the scene ({#if} routing: old unmounts, new mounts — the
	 *      swoosh fires here, under the cover)
	 *   3. one rAF for the mount to flush: component init is where every useGltf /
	 *      TextureLoader call in the new scene fires, so the loading queue is filled
	 *      by the end of it
	 *   4. THE ASSET GATE — hold the veil until that queue drains
	 *      (core/utils/assetGate.ts). The boot Loader only ever covered the BOOT
	 *      scene's assets; every later scene used to enter on a fixed budget and
	 *      pop its track/car in afterwards. Capped by a timeout, so this can delay
	 *      an entry but never block one
	 *   5. one rAF for the Svelte mount effects to flush — the subtrees gated on those
	 *      assets (`{#if $carModel}` and friends) mount here
	 *   6. THE WARM GATE — `warmScene()` (core/utils/warmup.svelte.ts) forces real
	 *      frames of the real pipeline until three stops building shader programs.
	 *      Warming AFTER the asset gate is the point: a material's pipeline is built on
	 *      its first DRAW, so a frame drawn before the textures land warms the wrong
	 *      thing. Those frames are drawn UNDER the frozen one, which is what makes them
	 *      free to look at
	 *   7. THE REVEAL — the frozen frame dissolves into the live scene
	 *
	 * The warm used to be a fixed grace budget on the theory that three compiled in the
	 * background. It does not: outside `compileAsync` every pipeline is created
	 * synchronously on the frame that first draws it, which is exactly why entering a
	 * scene hitched. So the veil now waits on a real signal — the live program count
	 * holding still across several drawn frames — and a light scene leaves sooner than
	 * the old budget while a heavy one gets as long as it needs, capped.
	 *
	 * No warm frame is forced from HERE: this module lives outside the Canvas and has
	 * no Threlte context. `warmScene()` is the handshake with the component that does
	 * (Warmup.svelte), and it resolves immediately when there is no Canvas at all.
	 */
	async transitionTo(scene: SceneType) {
		if (sceneState.currentScene === scene || busy) return;
		busy = true;

		try {
			// Cover first — something must be over the old scene before it disappears.
			// The pipeline composite freezes its last frame; when it cannot (post-
			// processing bypassed at low quality, the effect switched off, a failed
			// build) this returns false and Loader.svelte's black veil covers instead.
			//
			// `isTransitioning` is raised AFTER this, and the ordering is the difference
			// between a clean freeze and a black flash: the capture needs two frames of
			// the LIVE scene to grab, and the flag is what puts the black veil on screen.
			// The re-entrancy guard is the plain `busy` below precisely so this flag is
			// free to mean "a cover is warranted" rather than "a call is in flight".
			const frozen = await coverWithSnapshot();
			sceneState.isTransitioning = true;

			if (!frozen) {
				await nextFrame();
				await nextFrame();
			}

			this.setScene(scene);

			// Mount flush — the new scene's component init fills the loading queue.
			await nextFrame();
			// The scene's own assets, under the same cover as the swap.
			await waitForAssetsIdle();

			// Mount flush for what those assets gated, then warm the complete scene.
			await nextFrame();
			await warmScene();

			// Reveal — the frozen frame dissolves into the scene that is now loaded,
			// warmed and drawing. A no-op when nothing froze.
			await revealScene();
		} finally {
			sceneState.isTransitioning = false;
			busy = false;
		}
	}
};

/** Re-entrancy guard — see the note in transitionTo for why it is not `isTransitioning`. */
let busy = false;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
