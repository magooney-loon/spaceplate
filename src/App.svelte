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

	// WebGPURenderer auto-falls back to WebGL2 when WebGPU isn't available; the boot
	// probe (capabilities.svelte.ts) decides which, and Loader.svelte badges the
	// fallback. Tier 'none' = neither backend, so the Canvas is never constructed —
	// WebGPURenderer would throw asynchronously inside its own init. antialias is
	// disabled in favour of post-processing anti-aliasing.
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
     rendering via its own task ({ after: autoRenderTask }, webgpu-notes.md §2). A
     Canvas option on purpose — toggling it from an $effect self-invalidates (§3.1). -->
{#if capabilityState.tier !== 'none'}
	<Canvas {createRenderer} {dpr} autoRender={false}>
		<!-- The engine clock (core/utils/engineClock.ts) — wraps scheduler.run, registers
		     no task, so the render-task order below is undisturbed. -->
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
					<!-- Renders nothing; sits before <Studio> in the same await block on purpose:
					     among `after: autoRenderTask` tasks registration order wins, and its render
					     task must register ahead of Studio's Gizmo so a capture grabs the frame
					     before the Gizmo composites (DOCS/webgpu-notes.md §2). -->
					<Capture />
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
						<!-- Drives camera.current along the authored path. INSIDE <Studio>, and
						     that is load-bearing twice over: it needs the extension context to
						     switch the editor camera off before a flythrough (the two write the
						     same camera and Studio's CameraControls would win), and Studio
						     renders `children` after every extension, so its main-stage task
						     registers after CameraControls' and runs after it either way.
						     See extensions/flypath/CLAUDE.md. -->
						<FlyPath />
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
