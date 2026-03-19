<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { sceneState } from '$core/SceneManager.svelte.ts';
	import MainMenu from '$scenes/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene.svelte';

	let introT = $state(0);
	let prevScene = $state(sceneState.currentScene);

	const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

	useTask((delta) => {
		if (sceneState.currentScene !== prevScene) {
			prevScene = sceneState.currentScene;
			introT = 0;
		}
		if (introT < 1) introT = Math.min(1, introT + delta * 2.0);
	});

	const eased = $derived(easeOutExpo(introT));
	const scale = $derived(0.85 + eased * 0.15);
	const posY = $derived((1 - eased) * 0.5);
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

{#if sceneState.currentScene === 'demoScene'}
	<T.Group {scale}>
		<DemoScene />
	</T.Group>
{/if}
