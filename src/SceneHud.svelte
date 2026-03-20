<script lang="ts">
	import { fade } from 'svelte/transition';
	import { sceneState } from '$extensions/scene/scene.svelte';
	import { settingsState } from '$extensions/settings/settings.svelte';
	import MainMenuHud from '$scenes/MainMenuHud.svelte';
	import DemoSceneHud from '$scenes/DemoSceneHud.svelte';
</script>

<!-- HTML overlay — rendered as a sibling to <Canvas> in App.svelte -->
{#if settingsState.general.uiVisible}
	<div>
		{#if sceneState.currentScene === 'mainMenu'}
			<div transition:fade={{ duration: 150 }}>
				<MainMenuHud />
			</div>
		{/if}

		{#if sceneState.currentScene === 'demoScene'}
			<div transition:fade={{ duration: 150 }}>
				<DemoSceneHud />
			</div>
		{/if}
	</div>
{/if}
