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
	<!-- NOT keyed on the garage's chosen car: the car-specific subtree is
	     TestGame's own <PlayerCar />, and the key that remounts it on a pick
	     lives there, so a car switch leaves the track (and its colliders and
	     minimap) standing. See TestGame/cars/garage.svelte.ts. -->
	<T.Group name="TestGame" position={[0, -0.7572, 0]}>
		<TestGame />
	</T.Group>
{/if}
