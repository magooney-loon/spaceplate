<script lang="ts">
	import { stageState } from './stage.svelte.js';
	import HomeStage from '$lib/HomeStage.svelte';
	import GalaxyStage from '$lib/GalaxyStage.svelte';
</script>

<!-- 3D stage content only — HTML overlays live in App.svelte -->
{#if stageState.currentStage === 'home' || stageState.currentStage === 'settings'}
	<HomeStage />
{/if}

{#if stageState.currentStage === 'galaxy'}
	<GalaxyStage />
{/if}
