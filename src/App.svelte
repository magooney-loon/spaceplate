<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';
	import Renderer from '$core/Renderer.svelte';
	import Loader from '$core/Loader.svelte';
	import Keymapper from '$core/Keymapper.svelte';
	import { World } from '@threlte/rapier';
	import { physicsState } from '$extensions/physics/physics.svelte';
	import PhysicsWorldLogger from '$extensions/physics/PhysicsWorldLogger.svelte';
	import * as THREE from 'three';
	import { HTML } from '@threlte/extras';
	import { settingsState } from '$extensions/settings/settings.svelte';
	import { planetDemoState } from '$lib/PlanetDemo/planetDemoState.svelte';

	// Create custom renderer — antialias disabled in favour of SMAA post-processing
	const createRenderer = (canvas: HTMLCanvasElement): THREE.WebGLRenderer => {
		const powerPreference =
			settingsState.graphics.quality === 'low' ? 'low-power' : 'high-performance';

		return new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			powerPreference
		});
	};

	const dpr = $derived.by(() => {
		if (typeof window === 'undefined') return 1;
		const deviceDPR = window.devicePixelRatio || 1;

		switch (settingsState.graphics.quality) {
			case 'low':
				return 1;
			case 'high':
				return deviceDPR;
			default:
				return deviceDPR;
		}
	});
</script>

<Keymapper />

<svelte:head>
	{#if planetDemoState.faviconUri}
		<link rel="icon" type="image/svg+xml" href={planetDemoState.faviconUri} />
	{/if}
</svelte:head>

<Loader />

<Canvas {createRenderer} {dpr}>
	<Renderer />
	<World
		gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
		framerate={physicsState.framerate}
	>
		<PhysicsWorldLogger />
		{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
			{#await import('@threlte/extras') then { PerfMonitor }}
				<PerfMonitor anchorX="right" anchorY="bottom" logsPerSecond={30} backgroundOpacity={0.2} />
			{/await}
			{#await Promise.all( [import('@threlte/studio'), import('./extensions/scene/SceneExtension.svelte'), import('./extensions/postprocessing/PostProcessingExtension.svelte'), import('./extensions/sound/SoundExtension.svelte'), import('./extensions/logger/LoggerExtension.svelte'), import('./extensions/skybox/SkyboxExtension.svelte'), import('./extensions/gltf-viewer/GltfViewerExtension.svelte'), import('./extensions/physics/PhysicsExtension.svelte')] ) then [{ Studio }, { default: SceneExtension }, { default: PostProcessingExtension }, { default: SoundExtension }, { default: LoggerExtension }, { default: SkyboxExtension }, { default: GltfViewerExtension }, { default: PhysicsExtension }]}
				<Studio
					extensions={[
						SceneExtension,
						PostProcessingExtension,
						SkyboxExtension,
						SoundExtension,
						LoggerExtension,
						GltfViewerExtension,
						PhysicsExtension
					]}
				>
					<Scene />
				</Studio>
			{/await}
		{:else}
			<Scene />
		{/if}
		{#snippet fallback()}
			<HTML transform>
				<p>
					It seems your browser<br />
					doesn't support WASM.<br />
					I'm sorry.
				</p>
			</HTML>
		{/snippet}
	</World>
</Canvas>

<SceneHud />
