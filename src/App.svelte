<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';
	import Skybox from '$core/Skybox.svelte';
	import Camera from '$core/Camera.svelte';
	import Renderer from '$core/Renderer.svelte';
	import Sound from '$core/Sound.svelte';
	import Loader from '$core/Loader.svelte';
	import * as THREE from 'three';
	import { settingsState, generalActions } from '$core/settings.svelte.js';

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

<Canvas {createRenderer} {dpr}>
	{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
		{#await import('@threlte/extras') then { PerfMonitor }}
			<PerfMonitor anchorX="left" anchorY="bottom" logsPerSecond={30} />
		{/await}
		{#await Promise.all( [import('@threlte/studio'), import('./extensions/StageExtension.svelte'), import('./extensions/postprocessing/PostProcessingExtension.svelte'), import('./extensions/camera/CameraControlsExtension.svelte')] ) then [{ Studio }, { default: StageExtension }, { default: PostProcessingExtension }, { default: CameraControlsExtension }]}
			<Studio extensions={[StageExtension, PostProcessingExtension, CameraControlsExtension]}>
				<Camera />
				<Sound />
				<Skybox />
				<Renderer />
				<Scene />
			</Studio>
		{/await}
	{:else}
		<Camera />
		<Sound />
		<Skybox />
		<Renderer />
		<Scene />
	{/if}
</Canvas>

<SceneHud />
<Loader />
