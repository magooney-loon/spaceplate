# Capture (`capture/`)

Screenshots and video recordings of the rendered scene.

## Files

```
types.ts                 — extensionScope, CaptureImageFormat, CaptureState, CaptureActions, CaptureDriver
capture.svelte.ts        — $state + captureActions + the driver slot
Capture.svelte           — the driver: renders nothing, owns the grab task and the MediaRecorder
CaptureExtension.svelte  — Studio toolbar panel (UI only)
index.ts                 — barrel
```

Dev-only (`VITE_GAME_ENGINE=true`).

## State shape

`imageFormat` ('png'|'jpeg'|'webp'), `imageQuality` (0.92, lossy formats only), `fps` (30),
`bitrateMbps` (16), `maxDurationSec` (60), plus driver-written `isRecording`, `elapsedSec`,
`status`.

## What ends up in the output

1. **The toolbar, its panes and the scene HUD are HTML**, siblings of the canvas. Nothing HTML is ever composited into the canvas, so reading the canvas back excludes them for free.
2. **Studio's 3D content is in the canvas, and is captured** — grid, axes/light/group helpers, transform controls, the selection-outline quad. That is deliberate: each has its own toolbar toggle (and deselecting clears the outline), so it is a per-shot decision by the user, and sometimes the grid is exactly what you want in frame. An earlier version auto-hid all of them via Studio's `studio-objects-registry`; it was removed as unwanted policy, not as dead code — that registry is still the handle to use if per-capture hiding is ever wanted back.
3. **The corner navigation Gizmo is the exception.** It has no useful toggle short of disabling the editor camera, and is never wanted in an image. It is a `@threlte/extras` component mounted by Studio's `CameraControls`, rendering from its own task registered `{ after: autoRenderTask }`, and among tasks sharing a constraint the DAG falls back to registration order (`DOCS/webgpu-notes.md` §2) — so the grab runs after the pipeline draws the frame but **before** the Gizmo composites on top.

## Key behavior

- **Mount position in `App.svelte` is load-bearing.** `<Capture />` is in the same `{#await Promise.all([...])}` as `<Studio>` and immediately before it. One Promise.all resolving into one fragment means both mount in the same tick in document order, so the grab task registers ahead of the Gizmo's and stays there (the Gizmo re-registers when the editor camera is toggled, which only pushes it later). Two separate dynamic imports racing for task order would not be a guarantee. Being in that block also keeps it out of the production bundle — a static import does **not** get tree-shaken here; it leaked `MediaRecorder`/`captureStream` into `index.js` when tried.
- **The grab task only runs on frames that rendered.** Tasks constrained `{ after: autoRenderTask }` inherit the renderStage, whose callback gates the whole stage on `shouldRender()` (threlte core `scheduler.svelte.js`). That is exactly the guarantee a canvas read-back needs — the WebGPU canvas is `COPY_SRC` and a valid `drawImage` source (`webgpu-notes.md` §5.2), but only while the frame is current.
- **Screenshots are armed, not taken, by the action.** Outside the render loop the canvas holds the last frame's *final* composite — Gizmo included — so only a grab from inside the task, on a frame that actually rendered, lands in the pre-Gizmo window. The action sets a pending flag and `invalidate()`s; the next rendered frame is grabbed. Output is at canvas resolution, which already includes DPR — at `high` on a 2× display a 1920px CSS canvas yields a 3840px PNG. Going beyond that would need a re-render at a larger backing size, i.e. a render hook out of `Renderer.svelte`; deliberately not done.
- **Recording pins the render loop.** `renderMode` is `'on-demand'`, so the task `invalidate()`s every frame while recording — otherwise the stream is fed only when something else happens to invalidate, giving a variable, mostly-empty video. This is the one place that is intentional (cf. the guarded auto-rotate task in `gltf-viewer/`), and it is bounded by `maxDurationSec`, which auto-stops so a forgotten recording cannot pin the loop indefinitely.
- **Video is recorded off a second 2D canvas**, not the live one: the task blits into it (pre-Gizmo, as above) and `captureStream(0)` + `track.requestFrame()` puts frame timing under the task's control rather than the browser's sampler. Frames are throttled to `fps` against the task delta. Canvas size is fixed at recording start, so a mid-recording window resize is absorbed by `drawImage` scaling instead of breaking the stream.
- Mime type is probed in order: vp9 → vp8 → webm → mp4.
- `capture.svelte.ts` holds one register/unregister slot (same shape as `scenes/DemoScene/mirrorFloor.ts`): the **driver**, because the renderer, the task and the MediaRecorder must all live inside `<Canvas>` while the panel does not.
