# GPU Stats (`stats/`)

## Files

```
index.ts              — barrel (2-line comment, no exports)
StatsExtension.svelte — GPU stats overlay (stats-gl)
```

Dev-only. Panel-only extension with no state module.

## What it displays

Draw calls, triangles, compute passes, render targets, geometries, textures, programs — in a multi-panel graph overlay. Also resolves GPU timestamp queries for accurate GPU timing. (There are no PTS/LINE panels: this app renders zero point and zero line primitives — every layer is billboarded quads, see `Stars.svelte` / `Rain.svelte` headers — so those counters are permanently 0 and the panel slots are spent on CMP and RT instead.)

## Key behavior

- Uses `stats-gl` with `trackGPU: true`, `trackCPT: true`, `trackHz: true`.
- Creates 7 custom panels (DC, TRI, PTS, LINE, GEO, TEX, PRG) and appends to `document.body`.
- Repositioned from default top-left to right-edge centered (avoids overlapping Studio toolbar).
- `useTask()` runs `{ after: autoRenderTask, autoInvalidate: false }`: the task MUST sample after the render — three zeroes `info.render.*` at frame START (`Animation.js` calls `info.reset()` inside Threlte's `setAnimationLoop` callback, before the scheduler runs), so a default-order task always read fresh zeros and DC/TRI/PTS/LINE sat at 0. `autoInvalidate` stays off so the stats read never itself defeats on-demand rendering.
- On frames where on-demand rendering skipped the render, the panels HOLD their last value: `info.render.calls` (a lifetime count `reset()` doesn't touch) is compared against the previous sample, and unchanged means no render ran — pushing the just-reset zeros instead would make every panel dip to 0 between renders.
- PRG reads `info.memory.programs` — WebGPU's `info` has no `programs` array (that's WebGL's shape); `info.programs?.length` was always `undefined`.
- `resolveGpuTimestamps()`: calls `renderer.resolveTimestampsAsync(...)` for **both**
  `TimestampQuery.RENDER` and `TimestampQuery.COMPUTE` — fire-and-forget, non-blocking,
  tracked per queue. Required because stats-gl enables `renderer.backend.trackTimestamp`
  but never resolves the queries itself. **three keeps a separate pool per queue**, so
  resolving RENDER alone leaves the compute pool to fill until it warns
  ("Maximum number of queries exceeded") and leaves the CPT panel reading 0.00 — which is
  what `Birds.svelte`'s two `renderer.compute()` passes per frame did. Any new compute
  work is covered by this automatically; nothing needs adding per call site.
- **Pauses itself entirely while `captureState.isRecording`.** Measuring the frame is not free and all of it lands on the main thread inside the frame a recording is trying to blit and encode: `trackGPU`/`trackCPT` make stats-gl set `backend.trackTimestamp`, which writes a timestamp query around _every_ render and compute pass; `resolveGpuTimestamps()` issues two async resolves per frame; and `stats.update()` + `updateCustomPanels()` are ten small 2D canvas repaints per rendered frame. None of it is in the capture anyway — the panels are HTML siblings of the canvas. `trackTimestamp` is cleared too rather than just skipping the task, because the per-pass query writes happen inside the renderer, upstream of anything the task does. On restore the `lastRenderCalls`/`lastComputeCalls` detectors are re-armed (the lifetime counters moved on during the take, so reporting the delta would be a bogus jump). The DOM is left alone — hiding it would reflow, and it is not in the output.
- Rolling history arrays (max 40 samples) for per-panel graph scaling.
- No `createExtension` call — does not register with Studio at all. Directly reads from Threlte's renderer context.
