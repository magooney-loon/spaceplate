<script lang="ts">
	import { sceneState } from '$core/SceneManager.svelte.ts';
	import MainMenu from '$scenes/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene.svelte';
</script>

<!-- 3D scene content based on current scene -->
{#if sceneState.currentScene === 'mainMenu'}
	<MainMenu />
{/if}

{#if sceneState.currentScene === 'demoScene'}
	<DemoScene />
{/if}
