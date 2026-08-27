<script lang="ts">
	import { sceneState } from '$extensions/scene/scene.svelte';
	import { settingsState } from '$extensions/settings/settings.svelte';
	import { overlayState } from '$lib/stores/overlayState.svelte';
	import MainMenuHud from '$scenes/MainMenu/MainMenuHud.svelte';
	import DemoSceneHud from '$scenes/DemoScene/DemoSceneHud.svelte';
	import SettingsHud from '$scenes/SettingsHud.svelte';
</script>

<!-- HTML overlay — rendered as a sibling to <Canvas> in App.svelte -->
{#if settingsState.general.uiVisible && !overlayState.settingsOpen}
	<div>
		{#if sceneState.currentScene === 'mainMenu'}
			<MainMenuHud />
		{/if}

		{#if sceneState.currentScene === 'demoScene'}
			<DemoSceneHud />
		{/if}
	</div>
{/if}

{#if overlayState.settingsOpen}
	<SettingsHud onBack={() => (overlayState.settingsOpen = false)} />
{/if}
