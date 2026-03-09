<script lang="ts">
	import { isSettingsStage, isHomeStage, isGalaxyStage } from './stage.svelte.js';
	import HomeStage from '$lib/HomeStage.svelte';
	import GalaxyStage from '$lib/GalaxyStage.svelte';
</script>

<!-- 3D stage content only — HTML overlays live in App.svelte -->
{#if isSettingsStage() || isHomeStage()}
	<HomeStage />
{:else if isGalaxyStage()}
	<GalaxyStage />
{/if}
