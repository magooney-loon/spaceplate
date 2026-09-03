# Capture (`capture/`)

Screenshots and video recordings of the rendered scene, with **no Studio UI in the output**.

## Files

```
types.ts                 — extensionScope, CaptureImageFormat, CaptureState, CaptureActions, CaptureDriver
capture.svelte.ts        — $state + captureActions + the driver / studio-objects slots
Capture.svelte           — the driver: renders nothing, owns the grab task and the MediaRecorder
CaptureExtension.svelte  — Studio toolbar panel; also publishes Studio's object registry
index.ts                 — barrel
```

Dev-only (`VITE_GAME_ENGINE=true`).

## State shape

`imageFormat` ('png'|'jpeg'|'webp'), `imageQuality` (0.92, lossy formats only), `fps` (30),
`bitrateMbps` (16), `maxDurationSec` (60), `hideStudioObjects` (true), plus driver-written
`isRecording`, `elapsedSec`, `status`.

## Keeping Studio out of the frame

Three separate problems, three different answers — this is the whole point of the extension:

1. **The toolbar, its panes and the scene HUD are HTML**, siblings of the canvas. Nothing HTML is ever composited into the canvas, so reading the canvas back excludes them for free.
2. **Studio's 3D content is in the canvas** — grid, axes/light/group helpers, transform controls, and the selection-outline quad. All of them register in Studio's `studio-objects-registry` extension (that is how Studio excludes them from raycasting), so hiding exactly that set removes Studio's contribution and nothing of the app's. `visible` is saved per object and restored to what it was, never assumed `true`.
3. **The corner navigation Gizmo is not in that registry** (it is a `@threlte/extras` component mounted by Studio's `CameraControls`). It renders from its own task registered `{ after: autoRenderTask }`, and among tasks sharing a constraint the DAG falls back to registration order (`DOCS/webgpu-notes.md` §2) — so the grab runs after the pipeline draws the frame but **before** the Gizmo composites on top.

## Key behavior

- **Mount position in `App.svelte` is load-bearing.** `<Capture />` is in the same `{#await Promise.all([...])}` as `<Studio>` and immediately before it. One Promise.all resolving into one fragment means both mount in the same tick in document order, so the grab task registers ahead of the Gizmo's and stays there (the Gizmo re-registers when the editor camera is toggled, which only pushes it later). Two separate dynamic imports racing for task order would not be a guarantee. Being in that block also keeps it out of the production bundle — a static import does **not** get tree-shaken here; it leaked `MediaRecorder`/`captureStream` into `index.js` when tried.
- **The grab task only runs on frames that rendered.** Tasks constrained `{ after: autoRenderTask }` inherit the renderStage, whose callback gates the whole stage on `shouldRender()` (threlte core `scheduler.svelte.js`). That is exactly the guarantee a canvas read-back needs — the WebGPU canvas is `COPY_SRC` and a valid `drawImage` source (`webgpu-notes.md` §5.2), but only while the frame is current.
- **Screenshots are two-phase**, because the hide has to apply to the render and the task runs *after* it: the action hides + `invalidate()`s, the next rendered frame is grabbed. Output is at canvas resolution, which already includes DPR — at `high` on a 2× display a 1920px CSS canvas yields a 3840px PNG. Going beyond that would need a re-render at a larger backing size, i.e. a render hook out of `Renderer.svelte`; deliberately not done.
- **Recording pins the render loop.** `renderMode` is `'on-demand'`, so the task `invalidate()`s every frame while recording — otherwise the stream is fed only when something else happens to invalidate, giving a variable, mostly-empty video. This is the one place that is intentional (cf. the guarded auto-rotate task in `gltf-viewer/`), and it is bounded by `maxDurationSec`, which auto-stops so a forgotten recording cannot pin the loop indefinitely.
- **Video is recorded off a second 2D canvas**, not the live one: the task blits into it (pre-Gizmo, as above) and `captureStream(0)` + `track.requestFrame()` puts frame timing under the task's control rather than the browser's sampler. Frames are throttled to `fps` against the task delta. Canvas size is fixed at recording start, so a mid-recording window resize is absorbed by `drawImage` scaling instead of breaking the stream.
- Mime type is probed in order: vp9 → vp8 → webm → mp4.
- **Hiding is refcounted** so a screenshot taken during a recording does not un-hide Studio's objects on its way out.
- `capture.svelte.ts` holds two register/unregister slots (same shape as `scenes/DemoScene/mirrorFloor.ts`): the **driver**, because the renderer, the task and the MediaRecorder must live inside `<Canvas>`; and the **studio objects**, because `useStudio()` only resolves inside `<Studio>` while the driver is deliberately outside it. `CaptureExtension.svelte` filling the second slot is wiring, not logic — it is the only place that can.
