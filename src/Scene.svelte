<script lang="ts">
	import Skybox from '$core/Skybox.svelte';
	import Camera from '$core/Camera.svelte';
	import GlobalAudio from '$core/GlobalAudio.svelte';
	import { T, useTask } from '@threlte/core/webgpu';
	import { physicsActions } from '$extensions/physics/physics.svelte';
	import { sceneState } from '$extensions/scene/scene.svelte';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';

	let prevScene = $state(sceneState.currentScene);

	useTask(() => {
		if (sceneState.currentScene !== prevScene) {
			if (prevScene === 'demoScene' && sceneState.currentScene !== 'demoScene') {
				physicsActions.clearBodies();
			}
			prevScene = sceneState.currentScene;
		}
	});
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
