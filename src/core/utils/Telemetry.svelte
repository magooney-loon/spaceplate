<script lang="ts">
	// Samples renderer.info into telemetryState for the Settings ▸ System tab. Draws
	// nothing. Mount it right after <Renderer /> so its task registers after the draw
	// task and therefore runs after it (same constraint, registration order decides —
	// DOCS/weather-system.md §18).
	//
	// Two things this has to get right, both learned in extensions/stats:
	//   1. three zeroes info.render.* at the START of every frame (info.reset() inside
	//      Threlte's setAnimationLoop callback, before the scheduler), so per-frame
	//      counters must be read AFTER the render task or they are always 0.
	//   2. renderMode is 'on-demand', so tasks run on frames where nothing rendered.
	//      info.render.calls is a LIFETIME count reset() never touches — unchanged
	//      since the last tick means no render happened, which is exactly what makes
	//      this an FPS counter for rendered frames rather than a rAF/display-Hz meter.
	import { useThrelte, useTask } from '@threlte/core/webgpu';
	import { Vector2 } from 'three/webgpu';
	import { telemetryState } from './telemetry.svelte';

	const { renderer, autoRenderTask } = useThrelte();

	/** Fold window. Long enough to be stable and to keep HUD invalidations rare. */
	const SAMPLE_MS = 500;

	const size = new Vector2();
	let renderedFrames = 0;
	let lastRenderCalls = -1;
	let windowStart = performance.now();

	useTask(
		() => {
			const info = renderer.info;
			if (info.render.calls !== lastRenderCalls) {
				lastRenderCalls = info.render.calls;
				renderedFrames++;
			}

			const now = performance.now();
			const elapsed = now - windowStart;
			if (elapsed < SAMPLE_MS) return;

			telemetryState.fps = Math.round((renderedFrames * 1000) / elapsed);
			telemetryState.frameMs =
				renderedFrames === 0 ? 0 : Math.round((elapsed / renderedFrames) * 10) / 10;
			// Per-frame counters: whatever the last rendered frame left behind. On a
			// window that rendered nothing these hold their previous value, which reads
			// better than dipping to the freshly-reset zeros.
			if (renderedFrames > 0) {
				telemetryState.drawCalls = info.render.drawCalls;
				telemetryState.triangles = info.render.triangles;
			}
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
			windowStart = now;
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);
</script>
