<script lang="ts">
	// HTML overlay router — a sibling to <Canvas> in App.svelte.
	//
	// IT ROUTES ON `visibleScene`, NOT `currentScene`, AND THAT IS THE WHOLE POINT.
	// `currentScene` flips at the SWAP, which is the start of a transition's load; the
	// reveal is at the end of it. Routing the HUD on the swap put the incoming scene's
	// overlay on screen for the entire hold — the composite's cover is inside the canvas
	// and the loading veil is transparent over it, so an HTML sibling shows straight
	// through both — and started its effects against a scene that was still downloading.
	// `sceneState.visibleScene` is published one statement before the reveal, so a HUD
	// only ever mounts to a scene that is loaded, warmed and drawing.
	//
	// The fade is the second half: mounting early is not the same as SHOWING early. The
	// container tracks the transition phase so the outgoing HUD dissolves with the plate
	// during the dip, stays down through the hold (mounted, so its DOM cost is paid under
	// the cover) and comes back with the reveal.
	import { sceneState } from '$extensions/scene';
	import { transitionFxState } from '$core';
	import { settingsState, overlayState } from '$extensions/settings';
	import MainMenuHud from '$scenes/MainMenu/MainMenuHud.svelte';
	import DemoSceneHud from '$scenes/DemoScene/DemoSceneHud.svelte';
	import TestGameHud from '$scenes/TestGame/TestGameHud.svelte';
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

<!-- HTML overlay — rendered as a sibling to <Canvas> in App.svelte -->
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
	/* A `transition` rather than the keyframes Loader.svelte's veil needs: this
	   container is mounted for the whole session, so there is no insertion frame to
	   miss.

	   `visibility`, NOT `pointer-events`, and that is forced rather than chosen: every
	   HUD in this app sets `pointer-events: auto` on its own root, which overrides a
	   `none` on this parent — a faded-out overlay would still be a live click target,
	   with its Back button sitting invisibly under the loading veil. `visibility` is
	   inherited the same way but nothing here re-declares it, and it takes the layer out
	   of hit-testing and the accessibility tree together. Its transition is a zero-length
	   step DELAYED to the end of the fade-out, so the opacity still animates. */
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
