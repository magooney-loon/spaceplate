<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { backOut, cubicOut } from 'svelte/easing';
	import { sceneState } from '$extensions/scene/scene.svelte';
	import MainMenu from '$scenes/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene.svelte';

	let introT = $state(0);
	let prevScene = $state(sceneState.currentScene);

	useTask((delta) => {
		if (sceneState.currentScene !== prevScene) {
			prevScene = sceneState.currentScene;
			introT = 0;
		}
		if (introT < 1) introT = Math.min(1, introT + delta * 2.5);
	});

	const scale = $derived(0.85 + backOut(introT) * 0.15);
	const posY = $derived((1 - cubicOut(introT)) * 0.5);
</script>

{#if sceneState.currentScene === 'mainMenu'}
	<T.Group position={[0, posY, 0]} {scale}>
		<MainMenu />
	</T.Group>
{/if}

{#if sceneState.currentScene === 'demoScene'}
	<T.Group position={[0, posY, 0]} {scale}>
		<DemoScene />
	</T.Group>
{/if}
