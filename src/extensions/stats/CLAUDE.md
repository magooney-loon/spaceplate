# GPU Stats (`stats/`)

## Files

```
index.ts              — barrel (2-line comment, no exports)
StatsExtension.svelte — GPU stats overlay (stats-gl)
```

Dev-only. Panel-only extension with no state module.

## What it displays

Draw calls, triangles, points, lines, geometries, textures, programs — in a multi-panel graph overlay. Also resolves GPU timestamp queries for accurate GPU timing.

## Key behavior

- Uses `stats-gl` with `trackGPU: true`, `trackCPT: true`, `trackHz: true`.
- Creates 7 custom panels (DC, TRI, PTS, LINE, GEO, TEX, PRG) and appends to `document.body`.
- Repositioned from default top-left to right-edge centered (avoids overlapping Studio toolbar).
- `useTask()`: calls `stats.update()` and `updateCustomPanels()` each frame.
- `resolveGpuTimestamps()`: calls `renderer.resolveTimestampsAsync(TimestampQuery.RENDER)` — fire-and-forget, non-blocking. Required because stats-gl enables `renderer.backend.trackTimestamp` but never resolves the queries itself.
- Rolling history arrays (max 40 samples) for per-panel graph scaling.
- No `createExtension` call — does not register with Studio at all. Directly reads from Threlte's renderer context.
