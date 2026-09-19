import { logEngine } from '$extensions/logger';
// Direct path on purpose (not the '$core' barrel): Loader.svelte imports this module
// for the scene-transition veil, and the barrel exports Loader — a module cycle.
// globalAudio is a leaf, so importing it directly breaks the ring.
import { engineSounds } from '$core/audio/engineSounds';
// Same reason for the direct paths: both gates are leaves (loading manager / renderer
// info + logger), so importing them cannot close the ring back through Loader.
import { waitForAssetsIdle } from '$core/utils/assetGate';
import { warmScene } from '$core/utils/warmup.svelte';
import {
	coverWithSnapshot,
	revealScene,
	waitForCoverSettled
} from '$core/postprocessing/transitionState.svelte';
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
	visibleScene: 'mainMenu',
	previousScene: null,
	isTransitioning: false
});

export const sceneActions: ExtensionActions = {
	/** Instant swap — boot, the Studio panel and other programmatic callers. */
	setScene(scene: SceneType) {
		if (sceneState.currentScene === scene) return;

		logEngine.info(`Scene: ${sceneState.currentScene} → ${scene}`);
		engineSounds.swoosh.play();

		sceneState.previousScene = sceneState.currentScene;
		sceneState.currentScene = scene;
		// An INSTANT swap shows immediately by definition — nothing is covering, so the
		// HUD has nothing to wait for. `transitionTo` is the caller that separates the
		// two, by publishing `visibleScene` itself at the reveal instead.
		if (!sceneState.isTransitioning) sceneState.visibleScene = scene;
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
	 * goes through here; the swap happens under a full-screen cover so the entry
	 * cost is never on screen:
	 *
	 *   1. capture   — freeze the outgoing scene's last frame (or the black veil
	 *                  fallback when there's no pipeline to do it with)
	 *   2. dip       — the frozen frame dissolves to flat, BEFORE the swap, while
	 *                  the outgoing scene is still mounted and nothing is blocking
	 *   3. setScene  — {#if} routing: old unmounts, new mounts, swoosh fires
	 *   4. rAF       — flushes mount, filling the loading queue
	 *   5. asset gate — hold the cover until that queue drains (capped by a timeout)
	 *   6. rAF       — flushes the subtrees those assets gated
	 *   7. warm gate  — forces real frames until three stops building shader
	 *                  programs (must run after the asset gate, or it warms the
	 *                  wrong material variants)
	 *   8. reveal    — dissolve into the live scene, after a minimum cover time
	 *
	 * No warm frame is forced from here — this module lives outside the Canvas
	 * and has no Threlte context; `warmScene()` is the handshake with the
	 * component that does (Warmup.svelte). Full rationale: scene/CLAUDE.md.
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
			// `isTransitioning` is raised AFTER the capture and BEFORE the dip, and both
			// halves of that matter: the capture needs frames of the LIVE scene to grab
			// and the flag is what puts the black veil on screen, while the dip is
			// exactly the window the loading UI should be fading in across. The
			// re-entrancy guard is the plain `busy` below precisely so this flag is free
			// to mean "a cover is warranted" rather than "a call is in flight".
			const frozen = await coverWithSnapshot();
			sceneState.isTransitioning = true;

			if (frozen) {
				// Let the dip finish before touching the scene graph. The swap and the
				// mount that follows it are the biggest main-thread stall in the whole
				// sequence, and running them under a dissolve is what made the old
				// transition judder — the dissolve is now over before they start.
				await waitForCoverSettled();
			} else {
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

			// THE HUD JOINS HERE, one statement before the reveal. `currentScene` flipped
			// at the swap, which is the START of the load — routing the HUD on that put
			// the incoming scene's overlay on screen for the whole hold (the veil is
			// transparent while the composite covers, so HTML siblings show straight
			// through it) and started its effects against a scene that was still
			// downloading. Publishing it here means a HUD mounts to a scene that is
			// loaded, warmed and drawing, and fades in WITH it.
			sceneState.visibleScene = scene;

			// Reveal — the veil dissolves into the scene that is now loaded, warmed and
			// drawing. A no-op when nothing froze. The driver holds this until the
			// minimum cover time has elapsed, so this await can outlast the work.
			await revealScene();
		} finally {
			sceneState.isTransitioning = false;
			// Belt and braces: a throw between the swap and the reveal must not strand
			// the HUD on a scene that is no longer mounted.
			sceneState.visibleScene = sceneState.currentScene;
			busy = false;
		}
	}
};

/** Re-entrancy guard — see the note in transitionTo for why it is not `isTransitioning`. */
let busy = false;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
