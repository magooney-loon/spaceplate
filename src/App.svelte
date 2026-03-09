<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import Skybox from './Skybox.svelte';
	import Camera from './Camera.svelte';
	import Renderer from './Renderer.svelte';
	import * as THREE from 'three';
	import { settingsState } from './settings.svelte.js';


	// Create custom renderer with anti-aliasing disabled for better performance
	// We use SMAA post-processing anti-aliasing instead
	const createRenderer = (canvas: HTMLCanvasElement): THREE.WebGLRenderer => {
		// Use low-power mode for low quality (battery saving), high-performance for mid/high
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
				// Fixed low DPR for maximum performance (25% of pixels on 2x displays)
				return 1;
			case 'mid':
				// Capped DPR for balanced performance (prevents excessive resolution on high-DPI)
				return Math.min(deviceDPR, 1.5);
			case 'high':
				// Native DPR for maximum visual quality
				return deviceDPR;
			default:
				return Math.min(deviceDPR, 1.5);
		}
	});
</script>

<div class="h-dvh max-w-screen">
	<Canvas {createRenderer} {dpr}>
		{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
			{#await import('@threlte/extras') then { PerfMonitor }}
				<PerfMonitor anchorX="left" anchorY="bottom" logsPerSecond={30} />
			{/await}
			{#await import('@threlte/studio') then { Studio }}
				<Studio>
					<Camera />
					<Skybox />
					<Renderer />
					<Scene />
				</Studio>
			{/await}
		{:else}
			<Camera />
			<Skybox />
			<Renderer />
			<Scene />
		{/if}
	</Canvas>
</div>
