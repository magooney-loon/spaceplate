<script lang="ts">
	import { fade } from 'svelte/transition';
	import { sceneState } from '$core/SceneManager.svelte.ts';
	import { settingsState } from '$core/settings.svelte.js';
	import MainMenuHud from '$scenes/MainMenuHud.svelte';
	import DemoSceneHud from '$scenes/DemoSceneHud.svelte';
	import SettingsHud from '$scenes/SettingsHud.svelte';
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

		{#if sceneState.currentScene === 'settings'}
			<SettingsHud />
		{/if}
	</div>
{/if}
