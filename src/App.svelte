<script lang="ts">
	import { Canvas } from '@threlte/core/webgpu';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';
	import { Renderer, Loader, Keymapper } from '$core';
	import { patchRendererForStudio } from '$extensions/studio-webgpu';
	import StudioWebgpuCompat from '$extensions/studio-webgpu/StudioWebgpuCompat.svelte';
	import { World } from '@threlte/rapier';
	import { physicsState } from '$extensions/physics';
	import PhysicsWorldLogger from '$extensions/physics/PhysicsWorldLogger.svelte';
	import { WebGPURenderer } from 'three/webgpu';
	import { HTML } from '@threlte/extras';
	import { settingsState } from '$extensions/settings';
	import './app.css';

	// WebGPURenderer auto-falls back to WebGL when WebGPU isn't available.
	// antialias disabled in favour of post-processing anti-aliasing.
	const createRenderer = (canvas: HTMLCanvasElement): WebGPURenderer => {
		const powerPreference =
			settingsState.graphics.quality === 'low' ? 'low-power' : 'high-performance';

		const renderer = new WebGPURenderer({
			canvas,
			antialias: false,
			powerPreference
		});

		// @threlte/studio still assumes WebGLRenderer — see $extensions/studio-webgpu.
		patchRendererForStudio(renderer);

		return renderer;
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

<Loader />

<Canvas {createRenderer} {dpr}>
	{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
		<StudioWebgpuCompat />
	{/if}
	<Renderer />
	<World
		gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
		framerate={physicsState.framerate}
	>
		<PhysicsWorldLogger />
		{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
			<!-- PostProcessingExtension / SkyboxExtension are temporarily unregistered:
			     their Studio panels are broken post-WebGPU migration. The underlying
			     state modules still drive core/Renderer.svelte and core/Skybox.svelte,
			     so presets and effects keep working — only the toolbar UI is absent. -->
			{#await Promise.all( [import('@threlte/studio'), import('./extensions/scene/SceneExtension.svelte'), import('./extensions/sound/SoundExtension.svelte'), import('./extensions/logger/LoggerExtension.svelte'), import('./extensions/gltf-viewer/GltfViewerExtension.svelte'), import('./extensions/physics/PhysicsExtension.svelte'), import('./extensions/stats/StatsExtension.svelte')] ) then [{ Studio }, { default: SceneExtension }, { default: SoundExtension }, { default: LoggerExtension }, { default: GltfViewerExtension }, { default: PhysicsExtension }, { default: StatsExtension }]}
				<Studio
					extensions={[
						SceneExtension,
						SoundExtension,
						LoggerExtension,
						GltfViewerExtension,
						PhysicsExtension,
						StatsExtension
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
