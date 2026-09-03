<script lang="ts">
	// Samples renderer.info into telemetryState for the Settings ▸ System tab. Draws
	// nothing. Mount it right after <Renderer /> so its sampling task registers after
	// the draw task and therefore runs after it (same constraint, registration order
	// decides).
	//
	// TWO TASKS, because Threlte's two stages answer two different questions.
	// `{ after: autoRenderTask }` puts a task in the RENDER stage, whose callback only
	// runs its tasks when `shouldRender()` is true (Threlte's scheduler fragment) — so
	// it ticks once per RENDERED frame. A default task is in the main stage, which the
	// animation loop runs on every frame, rendered or not. Counting both is what makes
	// the fps/loopHz pair able to tell "on-demand skipped the render" apart from "the
	// frame itself got slower".
	//
	// Both are `autoInvalidate: false`. A sampler that invalidates would force a render
	// every frame and destroy the very on-demand behaviour it is here to measure.
	//
	// Per-frame counters (`info.render.*`) are read in the render-stage task on purpose:
	// three zeroes them at the START of every frame (`info.reset()` inside Threlte's
	// setAnimationLoop callback, before the scheduler), so anywhere earlier reads zeros.
	// `info.render.calls` is a LIFETIME count `reset()` never touches — unchanged since
	// the last tick means no render happened.
	import { useThrelte, useTask } from '@threlte/core/webgpu';
	import { Vector2 } from 'three/webgpu';
	import { telemetryState } from './telemetry.svelte';

	const { renderer, autoRenderTask } = useThrelte();

	/** Fold window. Long enough to be stable and to keep HUD invalidations rare. */
	const SAMPLE_MS = 500;

	const size = new Vector2();
	let renderedFrames = 0;
	let loopTicks = 0;
	let lastRenderCalls = -1;
	let lastDrawCalls = 0;
	let lastTriangles = 0;
	let windowStart = performance.now();

	// Render stage — once per rendered frame.
	useTask(
		() => {
			const info = renderer.info;
			if (info.render.calls === lastRenderCalls) return;
			lastRenderCalls = info.render.calls;
			renderedFrames += 1;
			lastDrawCalls = info.render.drawCalls;
			lastTriangles = info.render.triangles;
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	// Main stage — every animation frame. Owns the window, so the readout keeps
	// updating (and drops to 0 fps) even when nothing is rendering at all.
	useTask(
		() => {
			loopTicks += 1;

			const now = performance.now();
			const elapsed = now - windowStart;
			if (elapsed < SAMPLE_MS) return;

			const info = renderer.info;
			telemetryState.fps = Math.round((renderedFrames * 1000) / elapsed);
			telemetryState.loopHz = Math.round((loopTicks * 1000) / elapsed);
			telemetryState.frameMs =
				renderedFrames === 0 ? 0 : Math.round((elapsed / renderedFrames) * 10) / 10;
			// Last rendered frame's counters — they hold through windows that rendered
			// nothing, which reads better than dipping to the freshly-reset zeros.
			telemetryState.drawCalls = lastDrawCalls;
			telemetryState.triangles = lastTriangles;
			telemetryState.geometries = info.memory.geometries;
			telemetryState.textures = info.memory.textures;
			// WebGPU's info has no `programs` array (that is WebGL's shape) — the count
			// lives in memory.programs.
			telemetryState.programs = info.memory.programs;

			// Read here, not at mount: WebGPURenderer is CONSTRUCTED with a WebGPUBackend
			// either way and only swaps in the WebGL one from getFallback() inside its
			// async init() (three's Renderer.js). At mount it would claim WebGPU on every
			// machine. By the first sample the renderer has drawn, so this is settled.
			telemetryState.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl';

			renderer.getDrawingBufferSize(size);
			telemetryState.bufferWidth = size.x;
			telemetryState.bufferHeight = size.y;
			telemetryState.pixelRatio = renderer.getPixelRatio();

			renderedFrames = 0;
			loopTicks = 0;
			windowStart = now;
		},
		{ autoInvalidate: false }
	);
</script>
