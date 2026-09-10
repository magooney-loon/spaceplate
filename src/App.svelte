<script lang="ts">
	import { Canvas } from '@threlte/core/webgpu';
	import Scene from './Scene.svelte';
	import SceneHud from './SceneHud.svelte';
	import {
		EngineClock,
		Renderer,
		Loader,
		Keymapper,
		InputRuntime,
		Camera,
		Skybox,
		GlobalAudio,
		Telemetry,
		Warmup,
		TransitionDriver,
		PhysicsWorld,
		capabilityState
	} from '$core';
	import { Debug } from '@threlte/rapier';
	import { physicsState } from '$extensions/physics';
	import PhysicsWorldLogger from '$extensions/physics/PhysicsWorldLogger.svelte';
	import { WebGPURenderer } from 'three/webgpu';
	import { SunLight } from 'three/addons/lights/SunLight.js';
	import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
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
		const renderer = new WebGPURenderer({
			canvas,
			antialias: false,
			powerPreference: 'high-performance'
		});
		// The key light is a SunLight (cascaded shadows — core/skybox/SkyLight.svelte).
		// It is an ADDON light, so it has no entry in the renderer's node library and
		// renders unlit until one is added; this is the whole of its setup cost, and it
		// has to happen before the light is ever drawn. Cast because @types/three
		// declares NodeLibrary as an empty `@private` class — the method is real and
		// public, the typings simply do not describe it.
		(renderer.library as unknown as { addLight(node: unknown, light: unknown): void }).addLight(
			SunLightNode,
			SunLight
		);
		return renderer;
	};

	// THE BACKBUFFER SIZE, AND THEREFORE THE FILL BILL. Everything fill-rate-bound in this
	// engine — the precipitation fields above all, but also the mirror floor's
	// full-resolution reflection pass and every post-processing pass — scales with the
	// square of this number. It is the cheapest lever there is, and the only one that
	// costs sharpness rather than content.
	//
	// The preset picks the BASE: full device pixel ratio on 'high' (uncapped on purpose —
	// a Retina panel that can afford it should get it), 1 on 'low'. `renderScale` is then
	// a plain multiplier on top, so it composes with the preset instead of fighting it and
	// its default of 1 reproduces the old behaviour exactly on both.
	const dpr = $derived.by(() => {
		if (typeof window === 'undefined') return 1;
		const deviceDPR = window.devicePixelRatio || 1;
		const base = settingsState.graphics.quality === 'low' ? 1 : deviceDPR;
		return base * settingsState.graphics.renderScale;
	});
</script>

<Keymapper />

<Loader />

<!-- autoRender is OFF: the RenderPipeline in core/utils/Renderer.svelte drives
     rendering via its own task ({ after: autoRenderTask }, webgpu-notes.md §2). A
     Canvas option on purpose — toggling it from an $effect self-invalidates (§3.1). -->
{#if capabilityState.tier !== 'none'}
	<Canvas {createRenderer} {dpr} autoRender={false}>
		<!-- The engine clock + frame-rate cap (core/utils/engineClock.ts) — wraps
		     scheduler.run and, when a cap is set, the animation-loop callback too;
		     registers no task, so the render-task order below is undisturbed. -->
		<EngineClock />
		<Renderer />
		<!-- Samples renderer.info after the pipeline draws — feeds the Settings ▸ System tab. -->
		<Telemetry />
		<!-- Draws nothing until asked: forces real frames behind the loading cover until
		     three stops building shader programs, so a scene's pipelines compile under the
		     veil instead of hitching on entry (core/utils/warmup.svelte.ts). Same slot rule
		     as Telemetry — after <Renderer /> so it samples the frame that was just drawn. -->
		<Warmup />
		<!-- Captures the outgoing scene's last frame and dissolves it into the incoming
		     one (core/postprocessing/transitionState.svelte.ts). Renders nothing itself;
		     the composite lives in the effect chain like any other effect. -->
		<TransitionDriver />
		<Camera />
		<GlobalAudio />
		<Skybox />
		<!-- `<World>` with Rapier's synchronization stage pinned ahead of the main
		     stage, so main-stage tasks read THIS frame's interpolated body poses
		     instead of last frame's — see core/utils/PhysicsWorld.svelte. -->
		<PhysicsWorld
			gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
			framerate={physicsState.framerate}
		>
			<PhysicsWorldLogger />
			<!-- Draws nothing: advances the input frame stamp in its own stage, pinned
			     ahead of simulation so physics and render tasks observe the same input
			     edge. Inside <PhysicsWorld> because that is where the stage it pins
			     itself against exists — see core/input/InputRuntime.svelte. -->
			<InputRuntime />
			<!-- Global physics debug overlay — one mount instead of per-scene copies. Draws
			     every collider in the world; only the current scene's bodies exist (scenes
			     unmount with their Rapier bodies). Gated on Studio mode like the panel that
			     toggles it. -->
			{#if import.meta.env.VITE_GAME_ENGINE === 'true' && physicsState.debug}
				<Debug />
			{/if}
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
		</PhysicsWorld>
	</Canvas>
{/if}

<SceneHud />
