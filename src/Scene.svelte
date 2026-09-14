<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { sceneState } from '$extensions/scene';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';
	import TestGame from '$scenes/TestGame/TestGame.svelte';
</script>

{#if sceneState.currentScene === 'mainMenu'}
	<T.Group name="MainMenu">
		<MainMenu />
	</T.Group>
{/if}

{#if sceneState.currentScene === 'demoScene'}
	<T.Group name="DemoScene">
		<DemoScene />
	</T.Group>
{/if}

{#if sceneState.currentScene === 'testGame'}
	<T.Group name="TestGame" position={[0, -0.7572, 0]}>
		<TestGame />
	</T.Group>
{/if}
