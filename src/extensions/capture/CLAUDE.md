# Capture (`capture/`)

Screenshots and video recordings of the rendered scene.

## Files

```
types.ts                 — extensionScope, CaptureImageFormat, CaptureContainer,
                           CaptureVideoMode, CaptureState, CaptureActions, CaptureDriver
capture.svelte.ts        — $state + captureActions + the driver slot + captureRuntime
encoder.ts               — the offline (WebCodecs) take: mediabunny Output + CanvasSource
Capture.svelte           — the driver: renders nothing, owns the grab task, both video paths
                           and the engine clock's fixed-step source for an offline take
CaptureExtension.svelte  — Studio toolbar panel (UI only)
index.ts                 — barrel
```

Dev-only (`VITE_GAME_ENGINE=true`). A production build (`VITE_GAME_ENGINE` unset or `false`)
emits no capture chunk at all — verified: no `mediabunny`, no `MediaRecorder`, no reference.

## State shape

`imageFormat` ('png'|'jpeg'|'webp'), `imageQuality` (0.92, lossy formats only),
`resolution` ('viewport'|'720p'|'1080p'|'1440p'|'2160p'), `videoMode` ('realtime'|'offline'),
`container` ('webm'|'mp4'), `fps` (30), `bitrateMbps` (16), `maxDurationSec` (60), plus
driver-written `isRecording`, `isFinalizing`, `elapsedSec`, `status`.

**`isFinalizing` is the gap between stopping and having a file**, and both modes have one:
offline still has to drain its encode queue, mux and build the Blob; realtime is waiting on
`MediaRecorder.onstop` to flush the last timeslice and assemble the chunks. Neither is instant
at 4K. Without it the UI reads "done" and the download prompt turns up seconds later. Panels
gate on it (`captureActions.isBusy()` = `isRecording || isFinalizing`), and starting a new take
is **refused rather than queued** — it would resize the shared recording canvas out from under
the take still being written.

`captureRuntime` is a separate **plain** (not `$state`) object — the per-frame verdict shared
between the clock source and the capture task. Both sides touch it every frame, and a reactive
write there would wake the Studio panel at frame rate; same reasoning as the sky descriptor
(`core/skybox/CLAUDE.md` §14.1). Fields: `offline`, `posed`, `saturated`, `frameStep` — one
writer per field, everyone reads from their own task.

## The two video modes

|                 | `realtime`                          | `offline`                                     |
| --------------- | ----------------------------------- | --------------------------------------------- |
| Encoder         | `MediaRecorder` off `captureStream` | WebCodecs via mediabunny (`encoder.ts`)       |
| Frame timestamp | wall clock, when `requestFrame` ran | `frameIndex / fps` — a counter, never a clock |
| Viewport        | live, realtime                      | crawls; it is an offline render               |
| A 400ms frame   | encoded as a 400ms frame            | still exactly 1/fps in the output             |
| Engine clock    | wall clock, untouched               | fixed step, owned for the take                |

**This is the reason offline exists.** Making the frame cheaper reduces how _often_ a realtime
take hitches; it cannot make it not hitch, because MediaRecorder's timeline _is_ the wall
clock. Offline is exactly-spaced by construction and stays that way on a machine rendering the
scene at 8fps.

**An offline take owns the engine clock.** `startOfflineRecording()` installs `offlineStep` as
the fixed-step source (`core/utils/engineClock.ts` — read its header), and from that moment
every task in the app, plus Rapier's substep accumulator and TSL `time`, advances by exactly
one encoded frame per encoded frame. The camera, the sky driver, the cloud scroll, the rain
and the physics are on the same clock as the timestamps by construction, so a take that renders
at 8fps is not slow-motion in anything.

**The advance decision is latched, once per frame, by the clock source.** This is the important
invariant and getting it wrong is what made the first offline takes twitchy. `offlineStep()`
runs before any stage, decides the frame and writes `captureRuntime.posed`; the capture task
runs `{ after: autoRenderTask }` and encodes **iff** that latch is set, then clears it. It must
never re-derive the decision from the encoder's state, because `saturated` is asynchronous and
can flip _between_ the two within one frame — which meant a frame the clock held got encoded
anyway, as a duplicate pose. With `motionBlur` on (it is `defaultEnabled: true`) the first copy
carries a full frame of velocity and the duplicate carries none, so the take alternated blurred
and sharp frames, intermittently, and worst at the start where the encoder is cold.

**The head frame is released with a step of 0.** A pose driver rewinds and poses before arming
(flypath's `armTake`), so the first frame the source releases must encode the scene where it
already is; advancing first would make frame 0 of the video the scene at 1/fps and leave the
take a frame short at the head. `takeFrames === 0` is the whole test.

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

## What ends up in the output

1. **The toolbar, its panes and the scene HUD are HTML**, siblings of the canvas. Nothing HTML is ever composited into the canvas, so reading the canvas back excludes them for free.
2. **Studio's 3D content is in the canvas, and is captured** — grid, axes/light/group helpers, transform controls, the selection-outline quad. That is deliberate: each has its own toolbar toggle (and deselecting clears the outline), so it is a per-shot decision by the user, and sometimes the grid is exactly what you want in frame. An earlier version auto-hid all of them via Studio's `studio-objects-registry`; it was removed as unwanted policy, not as dead code — that registry is still the handle to use if per-capture hiding is ever wanted back.
3. **The corner navigation Gizmo is the exception.** It has no useful toggle short of disabling the editor camera, and is never wanted in an image. It is a `@threlte/extras` component mounted by Studio's `CameraControls`, rendering from its own task registered `{ after: autoRenderTask }`, and among tasks sharing a constraint the DAG falls back to registration order (`DOCS/webgpu-notes.md` §2) — so the grab runs after the pipeline draws the frame but **before** the Gizmo composites on top.

## Key behavior

- **Mount position in `App.svelte` is load-bearing.** `<Capture />` is in the same `{#await Promise.all([...])}` as `<Studio>` and immediately before it. One Promise.all resolving into one fragment means both mount in the same tick in document order, so the grab task registers ahead of the Gizmo's and stays there (the Gizmo re-registers when the editor camera is toggled, which only pushes it later). Two separate dynamic imports racing for task order would not be a guarantee. Being in that block also keeps it out of the production bundle — a static import does **not** get tree-shaken here; it leaked `MediaRecorder`/`captureStream` into `index.js` when tried.
- **The grab task only runs on frames that rendered.** Tasks constrained `{ after: autoRenderTask }` inherit the renderStage, whose callback gates the whole stage on `shouldRender()` (threlte core `scheduler.svelte.js`). That is exactly the guarantee a canvas read-back needs — the WebGPU canvas is `COPY_SRC` and a valid `drawImage` source (`webgpu-notes.md` §5.2), but only while the frame is current.
- **Screenshots are armed, not taken, by the action.** Outside the render loop the canvas holds the last frame's _final_ composite — Gizmo included — so only a grab from inside the task, on a frame that actually rendered, lands in the pre-Gizmo window. The action sets a pending flag and `invalidate()`s; the next rendered frame is grabbed. Output is at canvas resolution, which already includes DPR — at `high` on a 2× display a 1920px CSS canvas yields a 3840px PNG. Going beyond that would need a re-render at a larger backing size, i.e. a render hook out of `Renderer.svelte`; deliberately not done.
- **A realtime recording pins the render loop.** `renderMode` is `'on-demand'`, so the task `invalidate()`s every frame while recording — otherwise the stream is fed only when something else happens to invalidate, giving a variable, mostly-empty video. This is the one place that is intentional (cf. the guarded auto-rotate task in `gltf-viewer/`), and it is bounded by `maxDurationSec`, which auto-stops so a forgotten recording cannot pin the loop indefinitely. An offline take does not invalidate from the capture task — the engine clock invalidates every frame it releases, and holds deliberately render nothing.
- **The duration cap is checked before pushing a frame, not after**, so a take never finalizes in the same tick it queued a frame. `finish()` awaits **all** outstanding `add()` promises — `Output.finalize()` is documented as "call after all samples have been added" and says nothing about samples still being digested, and this is not the guarantee to leave to undocumented behaviour.
- **Video is recorded off a second 2D canvas**, not the live one — both modes. The task blits into it (pre-Gizmo, as above); realtime then uses `captureStream(0)` + `track.requestFrame()`, offline hands the same canvas to a mediabunny `CanvasSource`. Canvas size is fixed at recording start, so a mid-recording resize is absorbed by scaling instead of breaking the take, and is rounded **down to even** because H.264 and most hardware encoders reject odd dimensions.
- **The blit is the most expensive thing capture does per frame**, and it scales with the _backing store_: at `high` on a 2× display a 1920px canvas is a 3840×2160 copy. Two things keep it as cheap as it can be — each 2D context is acquired **once** at module scope (getContext options only apply on the first call, and the video one needs `alpha: false`), and the opaque video context lets `blitVideo()` skip a full-canvas `fillRect` that used to run immediately before `drawImage` overwrote every pixel of it. Do not move the `getContext` call back inside the blit.
- Mime type is probed in container order, but deliberately falls through to the other container: a machine with no mp4 encoder still produces a file, and the extension is derived from the mime type that actually won. Offline probes codecs the same way via `getFirstEncodableVideoCodec` (webm: vp9 → av1 → vp8; mp4: avc → hevc → av1).
- **`recorder.start(1000)`, not `start()`.** Without a timeslice MediaRecorder holds the whole take in one growing buffer and hands it over as a single Blob at stop — ~120 MB at 16 Mbps for 60s, and growing an allocation that size mid-take buys a GC pause in the middle of a shot.
- **`stats/` pauses itself while `isRecording`** (task skipped _and_ `backend.trackTimestamp` cleared). It is ~10 canvas repaints plus per-pass timestamp queries per frame, none of which is in the output anyway — the panels are HTML siblings of the canvas.
- `captureActions` exposes explicit `startRecording()` / `stopRecording()` alongside `toggleRecording()`, so another extension can bracket a recording around its own playback — `flypath/` does exactly that for **🎬 Record Flythrough**.
- `capture.svelte.ts` holds one register/unregister slot (same shape as `scenes/DemoScene/mirrorFloor.ts`): the **driver**, because the renderer, the task and the MediaRecorder must all live inside `<Canvas>` while the panel does not.
