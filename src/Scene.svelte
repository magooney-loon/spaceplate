<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useRapier } from '@threlte/rapier';
	import { sceneState } from '$extensions/scene';
	import MainMenu from '$scenes/MainMenu/MainMenu.svelte';
	import DemoScene from '$scenes/DemoScene/DemoScene.svelte';

	// Keep-alive means demoScene's Rapier bodies exist while other scenes are current,
	// and the world's own simulation task is not scene-gated (tasks.ts only gates app
	// tasks). Freeze the world when the physics scene is not current — same condition
	// as the physicsStage gate in core/utils/tasks.ts.
	const { pause, resume } = useRapier();
	$effect(() => {
		if (sceneState.currentScene === 'demoScene') resume();
		else pause();
	});
</script>

<!-- Keep-alive scene routing — deliberately NOT a plain {#if} on currentScene.
     An {#if} unmount destroys the scene: DemoScene's onDestroy disposes its floor
     material (evicting three's compiled-pipeline caches) and tears down all Rapier
     bodies, so every switch re-pays mount + compilation. Instead each scene mounts
     ONCE — the first time it becomes current (sceneState.visited latch, also armed
     by the boot warmup sweep) — and switching only toggles the group's `visible`,
     which three's render-list projection skips whole-subtree.

     Two caveats of "mounted but hidden":
     - Hidden meshes still RAYCAST (three's Raycaster checks layers, not visible;
       Threlte's interactivity only tests objects with pointer handlers). If a scene
       registers pointer handlers, gate them on the scene being current.
     - Tasks registered by a hidden scene's components still run whenever a frame
       flows — per-frame work inside a keep-alive scene must gate itself on
       sceneState.currentScene (see DemoPhysicsBodies' capture tasks). -->
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
