# Capture (`capture/`)

Screenshots and video recordings of the rendered scene.

## Files

```
types.ts                 — extensionScope, CaptureImageFormat, CaptureContainer,
                           CAPTURE_RESOLUTIONS, CaptureState, CaptureActions, CaptureDriver
capture.svelte.ts        — $state + captureActions + the driver slot + captureRuntime
encoder.ts               — the take (WebCodecs): mediabunny Output + CanvasSource
Capture.svelte           — the driver: renders nothing, owns the grab task, the encode path
                           and the engine clock's fixed-step source for a take
CaptureExtension.svelte  — Studio toolbar panel (UI only)
index.ts                 — barrel
```

Dev-only (`VITE_GAME_ENGINE=true`). Nothing here is reachable from a production build — the
whole extension is behind the dynamic import in `App.svelte`.

## State shape

`imageFormat` ('png'|'jpeg'|'webp'), `imageQuality` (0.92, lossy formats only),
`resolution` ('720p'|'1080p'|'1440p'|'2160p', default 1080p), `container` ('webm'|'mp4'),
`fps` (30), `bitrateMbps` (16), `maxDurationSec` (60), plus driver-written `isRecording`,
`isFinalizing`, `elapsedSec`, `status`.

**`isFinalizing` is the gap between stopping and having a file**: the encode queue still has
to drain, mux and build the Blob, none of which is instant at 4K. Without it the UI reads
"done" and the download prompt turns up seconds later. Panels gate on it
(`captureActions.isBusy()` = `isRecording || isFinalizing`), and starting a new take is
**refused rather than queued** — it would resize the shared recording canvas out from under
the take still being written.

`captureRuntime` is a separate **plain** (not `$state`) object — the per-frame verdict shared
between the clock source and the capture task. Both sides touch it every frame, and a reactive
write there would wake the Studio panel at frame rate; same reasoning as the sky descriptor
(`core/skybox/CLAUDE.md`, the descriptor contract). Fields: `posed`, `saturated`,
`frameStep` — one writer per field, everyone reads from their own task.

## One video path: the offline render

Frames go through WebCodecs via mediabunny (`encoder.ts`) and are timestamped
`frameIndex / fps` — **a counter, never a clock**. A frame that took 400 ms to draw is still
exactly `1/fps` in the output, so the video is exactly-spaced on a machine rendering the scene
at 8 fps. The viewport crawls while a take runs; that is the take working, not a stall.

**There was a second, `realtime` mode** (`MediaRecorder` off `canvas.captureStream(0)`), and
it is gone rather than deprecated. MediaRecorder timestamps each frame by the wall-clock
moment `requestFrame()` ran, so its timeline **is** the wall clock: making the frame cheaper
reduces how _often_ a take hitches and cannot stop it hitching. Every hitch went into the file
as a long frame. Keeping it meant a mode switch, a second encoder, a second finalize path and
a branch in the task, all to produce the worse file. Reviving it is a `MediaRecorder` +
`captureStream(0)` + `track.requestFrame()` job against the same `videoCanvas`; note it must
also pin the render loop with `invalidate()` per frame, which the take does not need because
the engine clock invalidates every frame it releases.

**A take owns the engine clock.** `startOfflineRecording()` installs `takeStep` as
the fixed-step source (`core/utils/engineClock.ts` — read its header), and from that moment
every task in the app, plus Rapier's substep accumulator and TSL `time`, advances by exactly
one encoded frame per encoded frame. The camera, the sky driver, the cloud scroll, the rain
and the physics are on the same clock as the timestamps by construction, so a take that renders
at 8fps is not slow-motion in anything.

**The advance decision is latched, once per frame, by the clock source.** This is the important
invariant and getting it wrong is what made the first takes twitchy. `takeStep()`
runs before any stage, decides the frame and writes `captureRuntime.posed`; the capture task
runs `{ after: autoRenderTask }` and encodes **iff** that latch is set, then clears it. It must
never re-derive the decision from the encoder's state, because `saturated` is asynchronous and
can flip _between_ the two within one frame — which meant a frame the clock held got encoded
anyway, as a duplicate pose. With `motionBlur` on (it is `defaultEnabled: true`) the first copy
carries a full frame of velocity and the duplicate carries none, so the take alternated blurred
and sharp frames, intermittently, and worst at the start where the encoder is cold.

**A projection change costs a prime frame.** `applyResolution()` writes `camera.aspect` and
resizes the drawing buffer, and three's `VelocityNode` copies current → previous projection
once per _rendered_ frame — so the first frame drawn after it reports a full-screen bogus
velocity (zero at the centre, growing horizontally towards the edges) and `motionBlur`
(`defaultEnabled: true`) smears the whole frame along it. That frame is exactly the one a
still is grabbed on and the one a take encodes as frame 0, which is why stills came out
smeared while the same shot looked sharp in the viewport.
`primeFrames` renders one frame and throws it away: the clock source returns **0, not
`null`**, because a hold would not draw it and drawing it is the whole point, and the task
decrements it in **one** place so the still, both video paths and the clock skip the same
frame. It also covers `holdResolution()` re-applying mid-capture, which _clears_ the canvas —
grabbing in that same tick read the blanked pixels.

**The head frame is released with a step of 0.** A pose driver rewinds and poses before arming
(flypath's `armTake`), so the first frame the source releases must encode the scene where it
already is; advancing first would make frame 0 of the video the scene at 1/fps and leave the
take a frame short at the head. `takeFrames === 0` is the whole test.

**A take must not look different from the viewport, and once did.** three's `velocity`
buffer is a per-FRAME delta, so motion blur scaled with the frame's duration — a 30fps
offline take smeared 2–5× wider than the same shot live, because the engine clock steps a
fixed `1/fps`. The fix is not in capture: `ctx.shutterScale` normalises velocity into a
shutter in the pipeline itself (`core/postprocessing/CLAUDE.md`). The general rule is that
a take exercises every place a per-frame quantity was quietly standing in for a per-second
one — this was the first one found, and probably not the last.

**The take paces the loop, not the other way round.** The clock `invalidate()`s every frame it
releases, so a take renders at exactly its own rate. An early version paced off `onEncoderReady`
instead, on the theory that one frame renders per frame encoded — false in this app, because
the sky layers (`Stars`, `CloudDeck`, `Rain`, `Birds`, …) call `invalidate()` every frame, so
the loop never idles. `onEncoderReady`'s `invalidate()` is still load-bearing for the opposite
reason: a **held** frame is not rendered at all now, so the encoder draining is the only thing
that can end a hold.

**Frames queue `MAX_QUEUE` (4) deep rather than stalling on every one.** `CanvasSource.add()`
snapshots the canvas synchronously and encodes asynchronously, so queueing is safe. A hold is
now **inert** rather than mildly destructive — scene time does not advance and the frame is not
even rendered — but it still costs the take a frame of wall-clock time for nothing, so holds
should be rare. The ceiling on the depth is memory: four frames of NV12 at 3840×2160 is ~50 MB.
(Before the engine clock a hold still rendered, and the sky still animated through it, which is
why the depth was tuned to make holds rare in the first place.)

`startRecording()` stays **synchronous** in the driver contract even though building an
encoder is async: `isRecording` flips optimistically and `captureRuntime.saturated` is held
until the encoder exists, so a caller checking the flag on the next line (flypath does) still
works, and scene time cannot advance into a take that has not begun. The clock is claimed in
the same synchronous call, not when the encoder lands — from that moment every frame is either
a frame of the take or a deliberate hold, and nothing animates on the wall clock in between.

## Resolution: always a preset, never "as-is"

Every capture resizes the **renderer** for its duration (`applyResolution` /
`releaseResolution` in `Capture.svelte`), so the frame is genuinely drawn at the selected size
instead of being scaled up from a window-sized one. A 4K take out of a half-screen window is
real 4K, and everything resolution-dependent follows for free: three's `PassNode` sizes the
post-processing targets from the drawing buffer every frame, and the blits read
`renderer.domElement` at its new size.

- **`updateStyle: false` is the trick.** The canvas's CSS size is left exactly as Threlte set
  it, so only the backing store changes and page layout never moves. The visible consequence
  is that the **viewport looks stretched** whenever the preset's aspect differs from the
  window's; the encoded frame is the correct one, and the panel says so.
- **The camera aspect is set by hand**, because nothing in Threlte derives it from the drawing
  buffer — the resize task and the `T` camera plugin both compute it from the CSS size, which
  is deliberately not being changed.
- **Threlte can still take the canvas back** — its resize task calls `renderer.setSize()` when
  the DOM element actually changes size, and the `dpr` effect calls `setPixelRatio()`. Neither
  fires on its own, which is why the override survives at all, but a window resize mid-take
  triggers the first, so `holdResolution()` re-claims it on the next frame.
- **There was a `viewport` ("as-is") option** meaning "whatever the canvas already is, CSS size
  × DPR". Removed: it is the one setting whose output nobody can predict from the panel (it
  depended on the window and the display's DPR), and it forced a null-target branch through
  `applyResolution`, the still path, the video sizing and the panel. Reviving it means making
  `captureResolutionSize` nullable again.

## What ends up in the output

1. **The toolbar, its panes and the scene HUD are HTML**, siblings of the canvas. Nothing HTML is ever composited into the canvas, so reading the canvas back excludes them for free.
2. **Studio's 3D content is in the canvas, and is captured** — grid, axes/light/group helpers, transform controls, the selection-outline quad. That is deliberate: each has its own toolbar toggle (and deselecting clears the outline), so it is a per-shot decision by the user, and sometimes the grid is exactly what you want in frame. An earlier version auto-hid all of them via Studio's `studio-objects-registry`; it was removed as unwanted policy, not as dead code — that registry is still the handle to use if per-capture hiding is ever wanted back.
3. **The corner navigation Gizmo is the exception.** It has no useful toggle short of disabling the editor camera, and is never wanted in an image. It is a `@threlte/extras` component mounted by Studio's `CameraControls`, rendering from its own task registered `{ after: autoRenderTask }`, and among tasks sharing a constraint the DAG falls back to registration order (`DOCS/webgpu-notes.md` §2) — so the grab runs after the pipeline draws the frame but **before** the Gizmo composites on top.

## Key behavior

- **Mount position in `App.svelte` is load-bearing.** `<Capture />` is in the same `{#await Promise.all([...])}` as `<Studio>` and immediately before it. One Promise.all resolving into one fragment means both mount in the same tick in document order, so the grab task registers ahead of the Gizmo's and stays there (the Gizmo re-registers when the editor camera is toggled, which only pushes it later). Two separate dynamic imports racing for task order would not be a guarantee. Being in that block also keeps it out of the production bundle — a static import does **not** get tree-shaken here; it leaked the whole encoder path into `index.js` when tried.
- **The grab task only runs on frames that rendered.** Tasks constrained `{ after: autoRenderTask }` inherit the renderStage, whose callback gates the whole stage on `shouldRender()` (threlte core `scheduler.svelte.js`). That is exactly the guarantee a canvas read-back needs — the WebGPU canvas is `COPY_SRC` and a valid `drawImage` source (`webgpu-notes.md` §5.2), but only while the frame is current.
- **Screenshots are armed, not taken, by the action.** Outside the render loop the canvas holds the last frame's _final_ composite — Gizmo included — so only a grab from inside the task, on a frame that actually rendered, lands in the pre-Gizmo window. The action sets a pending flag, resizes the renderer and `invalidate()`s; the frame after the prime frame is grabbed. Output is exactly the selected resolution — the still and the video share one size setting and one `applyResolution()`.
- **The capture task never invalidates for a take.** The engine clock invalidates every frame it releases, which is what makes the take's pace its own; a held frame deliberately renders nothing. `maxDurationSec` still auto-stops, so a forgotten recording cannot run forever.
- **The duration cap is checked before pushing a frame, not after**, so a take never finalizes in the same tick it queued a frame. `finish()` awaits **all** outstanding `add()` promises — `Output.finalize()` is documented as "call after all samples have been added" and says nothing about samples still being digested, and this is not the guarantee to leave to undocumented behaviour.
- **Video is recorded off a second 2D canvas**, not the live one. The task blits into it (pre-Gizmo, as above) and hands it to a mediabunny `CanvasSource`. Canvas size is fixed at recording start, so a mid-recording resize is absorbed by scaling instead of breaking the take, and is rounded **down to even** because H.264 and most hardware encoders reject odd dimensions.
- **The blit is the most expensive thing capture does per frame**, and it scales with the _backing store_: at `high` on a 2× display a 1920px canvas is a 3840×2160 copy. Two things keep it as cheap as it can be — each 2D context is acquired **once** at module scope (getContext options only apply on the first call, and the video one needs `alpha: false`), and the opaque video context lets `blitVideo()` skip a full-canvas `fillRect` that used to run immediately before `drawImage` overwrote every pixel of it. Do not move the `getContext` call back inside the blit.
- Codecs are probed in container order via `getFirstEncodableVideoCodec` (webm: vp9 → av1 → vp8; mp4: avc → hevc → av1), and the extension is derived from the codec that actually won — a machine with no mp4 encoder still produces a file.
- **`stats/` pauses itself while `isRecording`** (task skipped _and_ `backend.trackTimestamp` cleared). It is ~10 canvas repaints plus per-pass timestamp queries per frame, none of which is in the output anyway — the panels are HTML siblings of the canvas.
- `captureActions` exposes explicit `startRecording()` / `stopRecording()` alongside `toggleRecording()`, so another extension can bracket a recording around its own playback — `flypath/` does exactly that for **🎬 Record Flythrough**.
- `capture.svelte.ts` holds one register/unregister slot (same shape as `scenes/DemoScene/mirrorFloor.ts`): the **driver**, because the renderer, the task and the encoder must all live inside `<Canvas>` while the panel does not.
