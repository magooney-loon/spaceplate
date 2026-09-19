<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { sceneState } from '$extensions/scene';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';
	import TestGame from '$scenes/TestGame/TestGame.svelte';
	import { carGarage } from '$scenes/TestGame/cars';
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
		<!-- Keyed on the garage's chosen car (TestGame/cars/CLAUDE.md's "Garage"
		     section) — everything car-specific builds once at TestGame's mount,
		     so switching cars from the Garage shop remounts this subtree fresh. -->
		{#key carGarage.currentId}
			<TestGame />
		{/key}
	</T.Group>
{/if}
