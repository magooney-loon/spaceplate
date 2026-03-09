<script lang="ts">
	import { isSettingsStage, isHomeStage, isGalaxyStage } from './stage.svelte.js';
	import { settingsState } from './settings.svelte.js';
	import HomeHud from '$lib/HomeHud.svelte';
	import GalaxyHud from '$lib/GalaxyHud.svelte';
	import Settings from '$lib/Settings.svelte';
</script>

<!-- HTML overlay — rendered as a sibling to <Canvas> in App.svelte -->
{#if settingsState.general.uiVisible}
	<div style="position: absolute; inset: 0; pointer-events: none;">
		<div style="position: relative; width: 100%; height: 100%; pointer-events: none;">
			{#if isSettingsStage()}
				<div style="pointer-events: auto;"><Settings /></div>
			{:else if isHomeStage()}
				<div style="pointer-events: auto;"><HomeHud /></div>
			{:else if isGalaxyStage()}
				<div style="pointer-events: auto;"><GalaxyHud /></div>
			{/if}
		</div>
	</div>
{/if}
