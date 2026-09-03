<script lang="ts">
	import { Canvas } from '@threlte/core/webgpu';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';
	import {
		EngineClock,
		Renderer,
		Loader,
		Keymapper,
		Camera,
		Skybox,
		GlobalAudio,
		Telemetry,
		capabilityState
	} from '$core';
	import { World } from '@threlte/rapier';
	import { physicsState } from '$extensions/physics';
	import PhysicsWorldLogger from '$extensions/physics/PhysicsWorldLogger.svelte';
	import { WebGPURenderer } from 'three/webgpu';
	import { HTML } from '@threlte/extras';
	import { settingsState } from '$extensions/settings';
	import './app.css';

	// WebGPURenderer auto-falls back to WebGL when WebGPU isn't available; which of the
	// two we are on is decided by the boot probe in core/utils/capabilities.svelte.ts
	// (tier 'webgpu' | 'webgl'), and Loader.svelte badges the fallback case. Tier 'none'
	// means neither backend exists, so the Canvas below is never constructed at all —
	// WebGPURenderer would otherwise throw asynchronously, from inside its own init.
	// antialias disabled in favour of post-processing anti-aliasing.
	const createRenderer = (canvas: HTMLCanvasElement): WebGPURenderer => {
		// @threlte/studio's WebGL assumptions are handled in patches/@threlte__studio,
		// so nothing has to be done to the renderer here.
		return new WebGPURenderer({
			canvas,
			antialias: false,
			powerPreference: 'high-performance'
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

<!-- autoRender is OFF: the RenderPipeline in core/utils/Renderer.svelte drives
     rendering via its own task ({ after: autoRenderTask }, webgpu-notes.md §2).
     It is a Canvas option on purpose — toggling it from an $effect self-invalidates
     (DOCS/webgpu-notes.md §3.1). -->
{#if capabilityState.tier !== 'none'}
	<Canvas {createRenderer} {dpr} autoRender={false}>
		<!-- The engine clock: one source of scene time for every task, stage and TSL `time` in
		     the app (core/utils/engineClock.ts). Registers no task — it wraps scheduler.run,
		     upstream of all of them — so it does not disturb the render-task order below. -->
		<EngineClock />
		<Renderer />
		<!-- Samples renderer.info after the pipeline draws — feeds the Settings ▸ System tab. -->
		<Telemetry />
		<Camera />
		<GlobalAudio />
		<Skybox />
		<World
			gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
			framerate={physicsState.framerate}
		>
			<PhysicsWorldLogger />
			{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
				{#await Promise.all( [import('@threlte/studio'), import('./extensions/scene/SceneExtension.svelte'), import('./extensions/capture/CaptureExtension.svelte'), import('./extensions/sound/SoundExtension.svelte'), import('./extensions/logger/LoggerExtension.svelte'), import('./extensions/gltf-viewer/GltfViewerExtension.svelte'), import('./extensions/physics/PhysicsExtension.svelte'), import('./extensions/stats/StatsExtension.svelte'), import('./extensions/skybox/SkyboxExtension.svelte'), import('./extensions/postprocessing/PostProcessingExtension.svelte'), import('./extensions/flypath/FlyPathExtension.svelte'), import('./extensions/capture/Capture.svelte'), import('./extensions/flypath/FlyPath.svelte')] ) then [{ Studio }, { default: SceneExtension }, { default: CaptureExtension }, { default: SoundExtension }, { default: LoggerExtension }, { default: GltfViewerExtension }, { default: PhysicsExtension }, { default: StatsExtension }, { default: SkyboxExtension }, { default: PostProcessingExtension }, { default: FlyPathExtension }, { default: Capture }, { default: FlyPath }]}
					<!-- Renders nothing. Sits OUTSIDE <Studio> and before it on purpose: its
					     render task must register ahead of Studio's Gizmo so a capture grabs the
					     frame before the Gizmo composites on top (DOCS/webgpu-notes.md §2 — among
					     `after: autoRenderTask` tasks, registration order wins). Same await block
					     as <Studio>, so "before it in the fragment" is the whole guarantee: both
					     mount in one tick, in document order. -->
					<Capture />
					<!-- Drives camera.current along the authored path from a
					     `{ before: autoRenderTask }` task, so within a frame the order is
					     move camera → render → Capture's grab. Outside <Studio> only because
					     it shares this await block; its own task order is constraint-based. -->
					<FlyPath />
					<Studio
						extensions={[
							SceneExtension,
							FlyPathExtension,
							CaptureExtension,
							SoundExtension,
							LoggerExtension,
							GltfViewerExtension,
							PhysicsExtension,
							StatsExtension,
							SkyboxExtension,
							PostProcessingExtension
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
{/if}

<SceneHud />
