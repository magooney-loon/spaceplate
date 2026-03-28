<script lang="ts">
	import { fade } from 'svelte/transition';
	import { sceneState } from '$extensions/scene/scene.svelte';
	import { settingsState } from '$extensions/settings/settings.svelte';
	import MainMenuHud from '$scenes/MainMenu/MainMenuHud.svelte';
	import DemoSceneHud from '$scenes/DemoScene/DemoSceneHud.svelte';
</script>

<!-- HTML overlay — rendered as a sibling to <Canvas> in App.svelte -->
{#if settingsState.general.uiVisible}
	<div transition:fade={{ duration: 150 }}>
		{#if sceneState.currentScene === 'mainMenu'}
			<MainMenuHud />
		{/if}

		{#if sceneState.currentScene === 'demoScene'}
			<DemoSceneHud />
		{/if}
	</div>
{/if}
