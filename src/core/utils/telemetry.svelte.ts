// Live renderer figures for the Settings ▸ System tab. Written by Telemetry.svelte
// (inside the Canvas, where the renderer lives), read by HUD components outside it —
// the same split boot.svelte.ts exists for.
//
// Deliberately NOT per-frame reactive: the sampler folds a window of frames and writes
// here at SAMPLE_MS intervals, so an open settings panel re-renders a few times a
// second instead of once per frame. Static device facts live in capabilities.svelte.ts.

export type Backend = 'webgpu' | 'webgl' | 'unknown';

export const telemetryState = $state({
	/** What the renderer actually built — not what the probe predicted. */
	backend: 'unknown' as Backend,
	/** Rendered frames per second. On-demand rendering means this is NOT the display Hz. */
	fps: 0,
	/**
	 * Animation-loop ticks per second — frames the scheduler ran, rendered or skipped.
	 * The pair (fps, loopHz) is the diagnostic: loopHz high with fps low means
	 * on-demand skipped renders (nothing invalidated); both falling together means the
	 * frames themselves got slower (GPU load, thermal/power throttling, tab throttling).
	 */
	loopHz: 0,
	/** Mean ms between rendered frames over the last window. */
	frameMs: 0,
	drawCalls: 0,
	triangles: 0,
	geometries: 0,
	textures: 0,
	programs: 0,
	/** Backbuffer size in device pixels (canvas CSS size × pixel ratio). */
	bufferWidth: 0,
	bufferHeight: 0,
	pixelRatio: 0
});
