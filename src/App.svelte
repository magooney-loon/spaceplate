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

		// @threlte/studio's WebGL assumptions are handled in patches/@threlte__studio,
		// so nothing has to be done to the renderer here.
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

<!-- autoRender is back on (the default): with post-processing removed there is no
     RenderPipeline to drive, so Threlte's autoRenderTask does the rendering.
     If a pipeline returns, set autoRender={false} here as a Canvas option -- never
     by toggling it from an $effect, which self-invalidates
     (DOCS/webgpu-notes.md §3.1). -->
<Canvas {createRenderer} {dpr}>
	<Renderer />
	<World
		gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
		framerate={physicsState.framerate}
	>
		<PhysicsWorldLogger />
		{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
			<!-- PostProcessingExtension stays unregistered: its panel was broken by the
			     WebGPU migration and awaits the DOCS/post-processing.md rebuild.
			     SkyboxExtension is registered again -- rewritten as the time + environment
			     panel for the descriptor-driven sky (DOCS/weather-system.md §10). -->
			{#await Promise.all( [import('@threlte/studio'), import('./extensions/scene/SceneExtension.svelte'), import('./extensions/sound/SoundExtension.svelte'), import('./extensions/logger/LoggerExtension.svelte'), import('./extensions/gltf-viewer/GltfViewerExtension.svelte'), import('./extensions/physics/PhysicsExtension.svelte'), import('./extensions/stats/StatsExtension.svelte'), import('./extensions/skybox/SkyboxExtension.svelte')] ) then [{ Studio }, { default: SceneExtension }, { default: SoundExtension }, { default: LoggerExtension }, { default: GltfViewerExtension }, { default: PhysicsExtension }, { default: StatsExtension }, { default: SkyboxExtension }]}
				<Studio
					extensions={[
						SceneExtension,
						SoundExtension,
						LoggerExtension,
						GltfViewerExtension,
						PhysicsExtension,
						StatsExtension,
						SkyboxExtension
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
