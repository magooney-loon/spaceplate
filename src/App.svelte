<script lang="ts">
	import { Canvas } from '@threlte/core/webgpu';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';
	import { Renderer, Loader, Keymapper } from '$core';
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

		return new WebGPURenderer({
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

<Loader />

<Canvas {createRenderer} {dpr}>
	<Renderer />
	<World
		gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
		framerate={physicsState.framerate}
	>
		<PhysicsWorldLogger />
		{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
			{#await Promise.all( [import('@threlte/studio'), import('./extensions/scene/SceneExtension.svelte'), import('./extensions/postprocessing/PostProcessingExtension.svelte'), import('./extensions/sound/SoundExtension.svelte'), import('./extensions/logger/LoggerExtension.svelte'), import('./extensions/skybox/SkyboxExtension.svelte'), import('./extensions/gltf-viewer/GltfViewerExtension.svelte'), import('./extensions/physics/PhysicsExtension.svelte'), import('./extensions/stats/StatsExtension.svelte')] ) then [{ Studio }, { default: SceneExtension }, { default: PostProcessingExtension }, { default: SoundExtension }, { default: LoggerExtension }, { default: SkyboxExtension }, { default: GltfViewerExtension }, { default: PhysicsExtension }, { default: StatsExtension }]}
				<Studio
					extensions={[
						SceneExtension,
						PostProcessingExtension,
						SkyboxExtension,
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
