<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { sceneState } from '$extensions/scene';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';
	import TestGame from '$scenes/TestGame/TestGame.svelte';
</script>

<!-- Plain {#if} scene routing: exactly one scene mounted at a time. Unmounting a
     scene destroys it — its components' teardown disposes their THREE resources and
     removes its Rapier bodies from the world — so a switch re-pays mount and shader
     compilation on the way back in. -->
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
