<script lang="ts">
	import { fade } from 'svelte/transition';
	import { isSettingsStage, isHomeStage, isGalaxyStage } from './stage.svelte.js';
	import { settingsState } from './settings.svelte.js';
	import HomeHud from '$lib/HomeHud.svelte';
	import GalaxyHud from '$lib/GalaxyHud.svelte';
	import Settings from '$lib/Settings.svelte';
	import WelcomeModal from '$lib/WelcomeModal.svelte';
</script>

<!-- HTML overlay — rendered as a sibling to <Canvas> in App.svelte -->
<WelcomeModal />

{#if settingsState.general.uiVisible}
	<div
		transition:fade={{ duration: 150 }}
		style="position: absolute; inset: 0; pointer-events: none;"
	>
		<div style="position: relative; width: 100%; height: 100%; pointer-events: none;">
			{#if isSettingsStage()}
				<div style="pointer-events: auto;"><Settings /></div>
			{/if}
			{#if isHomeStage()}
				<div style="pointer-events: auto;"><HomeHud /></div>
			{/if}
			{#if isGalaxyStage()}
				<div style="pointer-events: auto;"><GalaxyHud /></div>
			{/if}
		</div>
	</div>
{/if}
