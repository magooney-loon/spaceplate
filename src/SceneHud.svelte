<script lang="ts">
	// Routes on `visibleScene`, not `currentScene` (src/CLAUDE.md). The fade is the
	// second half: mounting early isn't the same as SHOWING early — the container tracks
	// the transition phase so the outgoing HUD dissolves with the plate during the dip,
	// stays mounted (DOM cost paid under the cover) through the hold, and returns with
	// the reveal.
	import { sceneState } from '$extensions/scene';
	import { transitionFxState } from '$core';
	import { settingsState, overlayState } from '$extensions/settings';
	import MainMenuHud from '$scenes/MainMenu/MainMenuHud.svelte';
	import DemoSceneHud from '$scenes/DemoScene/DemoSceneHud.svelte';
	import TestGameHud from '$scenes/TestGame/HUD/TestGameHud.svelte';
	import SettingsHud from '$scenes/MainMenu/SettingsHud.svelte';

	/**
	 * Up when nothing is covering, and again from the moment the reveal starts — never
	 * during the dip or the hold. The `reveal` arm is what makes the HUD arrive WITH the
	 * scene rather than after it: `isTransitioning` only drops when the dissolve is
	 * finished, so waiting on that alone would pop the overlay in a beat late.
	 *
	 * The no-composite fallback (quality low, the effect off, a failed build) has no
	 * phase to read, so it holds the HUD down for the whole transition — which is right
	 * there anyway: that path's cover is an opaque black veil with nothing behind it.
	 */
	const hudUp = $derived(!sceneState.isTransitioning || transitionFxState.phase === 'reveal');
</script>

{#if settingsState.general.uiVisible && !overlayState.settingsOpen}
	<div class="hud-layer" class:up={hudUp}>
		{#if sceneState.visibleScene === 'mainMenu'}
			<MainMenuHud />
		{/if}

		{#if sceneState.visibleScene === 'demoScene'}
			<DemoSceneHud />
		{/if}

		{#if sceneState.visibleScene === 'testGame'}
			<TestGameHud />
		{/if}
	</div>
{/if}

{#if overlayState.settingsOpen}
	<!-- Not scene content: a global overlay, so it never waits on a transition. -->
	<SettingsHud onBack={() => (overlayState.settingsOpen = false)} />
{/if}

<style>
	/* `visibility`, not `pointer-events`: every HUD sets `pointer-events: auto` on its
	   own root, which would override a `none` here — a faded-out overlay would stay a
	   live click target. `visibility` inherits the same way, but nothing re-declares it,
	   and it removes the layer from hit-testing and the accessibility tree together. Its
	   transition is a zero-length step DELAYED to the end of the fade, so opacity still
	   animates. */
	.hud-layer {
		opacity: 0;
		visibility: hidden;
		/* Out with the dip (`veilSeconds`, default 0.4s). */
		transition:
			opacity 340ms ease-out,
			visibility 0s linear 340ms;
	}

	.hud-layer.up {
		opacity: 1;
		visibility: visible;
		/* In with the reveal (`revealSeconds`, default 0.7s), trailing it slightly so the
		   scene is established before its overlay lands on top. */
		transition:
			opacity 600ms ease-in,
			visibility 0s;
	}
</style>
