<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useRapier } from '@threlte/rapier';
	import { sceneState } from '$extensions/scene';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';
	import TestGame from '$scenes/TestGame/TestGame.svelte';

	// Keep-alive means demoScene's Rapier bodies exist while other scenes are current,
	// and the world's own simulation task is not scene-gated. Freeze the world when no
	// physics scene (demoScene, testGame) is current.
	const { pause, resume } = useRapier();
	$effect(() => {
		if (sceneState.currentScene === 'demoScene' || sceneState.currentScene === 'testGame') {
			resume();
		} else {
			pause();
		}
	});
</script>

<!-- Keep-alive scene routing — deliberately NOT a plain {#if} on currentScene:
     unmounting destroys the scene (DemoScene disposes its floor material, evicting
     three's compiled-pipeline caches, and tears down its Rapier bodies), so every
     switch re-pays mount + compilation. Each scene mounts ONCE — the first time it
     becomes current (sceneState.visited latch, also armed by the boot warmup sweep) —
     and switching only toggles the group's `visible`, which three's render-list
     projection skips whole-subtree. Caveats of "mounted but hidden": hidden meshes
     still RAYCAST (three checks layers, not visible — gate registered pointer handlers
     on the scene being current), and a hidden scene's tasks still run whenever a frame
     flows (gate per-frame work on sceneState.currentScene). -->
{#if sceneState.visited.mainMenu}
	<T.Group name="MainMenu" visible={sceneState.currentScene === 'mainMenu'}>
		<MainMenu />
	</T.Group>
{/if}

{#if sceneState.visited.demoScene}
	<T.Group name="DemoScene" visible={sceneState.currentScene === 'demoScene'}>
		<DemoScene />
	</T.Group>
{/if}

{#if sceneState.visited.testGame}
	<T.Group name="TestGame" visible={sceneState.currentScene === 'testGame'}>
		<TestGame />
	</T.Group>
{/if}
