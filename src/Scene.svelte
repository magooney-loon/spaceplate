<script lang="ts">
	import { Skybox, Camera, GlobalAudio } from '$core';
	import { T } from '@threlte/core/webgpu';
	import { sceneState } from '$extensions/scene';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';

</script>

<Camera />
<GlobalAudio />
<Skybox />

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
