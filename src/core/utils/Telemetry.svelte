<script lang="ts">
	// Samples renderer.info into telemetryState for the Settings ▸ System tab. Draws
	// nothing. Mount right after <Renderer /> so its sampling task registers after the
	// draw task and runs after it (registration order decides).
	//
	// TWO TASKS: a render-stage task (`{ after: autoRenderTask }`) ticks once per
	// RENDERED frame, a default (main-stage) task every animation frame, rendered or
	// not — counting both is what lets the fps/loopHz pair tell "on-demand skipped
	// the render" apart from "the frame got slower" (utils/CLAUDE.md).
	//
	// Both `autoInvalidate: false` — invalidating would force a render every frame
	// and destroy the on-demand behaviour being measured. Per-frame counters are read
	// in the render-stage task because three zeroes them at frame start;
	// `info.render.calls` is a LIFETIME count — unchanged since the last tick means
	// no render happened.
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

			// Read here, not at mount: WebGPURenderer only swaps in the WebGL backend
			// inside its async init() (three's Renderer.js) — at mount it would claim
			// WebGPU everywhere. By the first sample the renderer has drawn.
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
