<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';

	import Loader from '$core/Loader.svelte';

	import * as THREE from 'three';
	import { settingsState, generalActions } from '$extensions/settings/settings.svelte';
	import { planetDemoState } from '$lib/PlanetDemo/planetDemoState.svelte';
	import './app.css';

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl+H — toggle HUD visibility
		if (e.ctrlKey && e.key === 'h') {
			e.preventDefault();
			generalActions.toggleUiVisible();
		}
	}

	// Create custom renderer — antialias disabled in favour of SMAA post-processing
	const createRenderer = (canvas: HTMLCanvasElement): THREE.WebGLRenderer => {
		const powerPreference =
			settingsState.graphics.quality === 'low' ? 'low-power' : 'high-performance';

		return new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference });
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

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	{#if planetDemoState.faviconUri}
		<link rel="icon" type="image/svg+xml" href={planetDemoState.faviconUri} />
	{/if}
</svelte:head>

<Loader />

<Canvas {createRenderer} {dpr}>
	{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
		{#await import('@threlte/extras') then { PerfMonitor }}
			<PerfMonitor anchorX="left" anchorY="bottom" logsPerSecond={30} backgroundOpacity={0.2} />
		{/await}
		{#await Promise.all( [import('@threlte/studio'), import('./extensions/scene/SceneExtension.svelte'), import('./extensions/postprocessing/PostProcessingExtension.svelte'), import('./extensions/sound/SoundExtension.svelte'), import('./extensions/logger/LoggerExtension.svelte'), import('./extensions/skybox/SkyboxExtension.svelte'), import('./extensions/gltf-viewer/GltfViewerExtension.svelte')] ) then [{ Studio }, { default: SceneExtension }, { default: PostProcessingExtension }, { default: SoundExtension }, { default: LoggerExtension }, { default: SkyboxExtension }, { default: GltfViewerExtension }]}
			<Studio
				extensions={[
					SceneExtension,
					PostProcessingExtension,
					SkyboxExtension,
					SoundExtension,
					LoggerExtension,
					GltfViewerExtension
				]}
			>
				<Scene />
			</Studio>
		{/await}
	{:else}
		<Scene />
	{/if}
</Canvas>

<SceneHud />
