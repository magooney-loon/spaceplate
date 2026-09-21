# Capture (`capture/`)

Screenshots and video recordings of the rendered scene.

## Files

```
types.ts                 — extensionScope, CaptureImageFormat, CaptureContainer,
                           CAPTURE_RESOLUTIONS, CaptureState, CaptureActions, CaptureDriver
capture.svelte.ts        — $state + captureActions + the driver slot + captureRuntime
resolution.ts            — the renderer-size override: reference-counted acquire/release,
                           hold() re-claiming, and the prime-frame counter
still.ts                 — the still: arm, the blit into its own 2D canvas, toBlob, download
take.ts                  — the offline take: the engine clock's fixed-step source, the
                           encoder lifecycle, the duration cap, and arming/rendering the
                           audio layer's take recorder (see the audio section)
encoder.ts               — the take's WebCodecs half (mediabunny): Output + VideoSampleSource
                           for the video, AudioBufferSource for the offline-rendered audio
Capture.svelte           — the driver: renders nothing, owns the ONE task all of the above
                           run in, and wires them to the Threlte context
CaptureExtension.svelte  — Studio toolbar panel (UI only)
index.ts                 — barrel
```

`resolution.ts`, `still.ts` and `take.ts` are plain closures over the Threlte context
(`renderer`, `camera.current`, `invalidate`) rather than components — nothing in them is
Svelte-shaped, and keeping them out of the component is what lets `Capture.svelte` be
assembly only. They must still be _constructed_ inside `<Canvas>`, because that is where
that context exists.

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
**refused rather than queued**: `isFinalizing` and `status` are single fields, so a second
take's `stop()` would raise a flag the first take's `finally` then lowers underneath it, and
the first take's "Saved …" line would land on top of the second take's progress. (It is no
longer a canvas-ownership problem — the resolution override is reference counted and the
audio recorder is disarmed synchronously inside `stop()` — but one take at a time is still
the only state these two fields can describe.)

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

**Not built: a `realtime` mode** (`MediaRecorder` off `canvas.captureStream(0)`). MediaRecorder
timestamps each frame by the wall-clock moment `requestFrame()` ran, so its timeline **is** the
wall clock: making the frame cheaper reduces how _often_ a take hitches and cannot stop it
hitching — every hitch goes into the file as a long frame. On top of the worse file it would
mean a mode switch, a second encoder, a second finalize path and a branch in the task. Reviving
it is a `MediaRecorder` + `captureStream(0)` + `track.requestFrame()` job, and it would have
to bring its own canvas: the take's 2D one is gone (see "Video goes straight off the live
canvas"), and `captureStream` off the live WebGPU canvas is not the same thing. It would also
have to pin the render loop with `invalidate()` per frame, which the take does not need because
the engine clock invalidates every frame it releases.

**A take owns the engine clock.** `take.ts`'s `start()` installs its `step` as
the fixed-step source (`core/utils/engineClock.ts` — read its header), and from that moment
every task in the app, plus Rapier's substep accumulator and TSL `time`, advances by exactly
one encoded frame per encoded frame. The camera, the sky driver, the cloud scroll, the rain
and the physics are on the same clock as the timestamps by construction, so a take that renders
at 8fps is not slow-motion in anything.

**The advance decision is latched, once per frame, by the clock source.** This is the important
invariant — get it wrong and the take twitches. `take.ts`'s `step()`
runs before any stage, decides the frame and writes `captureRuntime.posed`; the capture task
runs `{ after: autoRenderTask }` and encodes **iff** that latch is set, then clears it. It must
never re-derive the decision from the encoder's state, because `saturated` is asynchronous and
can flip _between_ the two within one frame — which meant a frame the clock held got encoded
anyway, as a duplicate pose. With `motionBlur` on (it is `defaultEnabled: true`) the first copy
carries a full frame of velocity and the duplicate carries none, so the take alternated blurred
and sharp frames, intermittently, and worst at the start where the encoder is cold.

**A projection change costs a prime frame.** `resolution.ts`'s `install()` writes `camera.aspect`
and resizes the drawing buffer, and three's `VelocityNode` copies current → previous projection
once per _rendered_ frame — so the first frame drawn after it reports a full-screen bogus
velocity (zero at the centre, growing horizontally towards the edges) and `motionBlur`
(`defaultEnabled: true`) smears the whole frame along it. That frame is exactly the one a
still is grabbed on and the one a take encodes as frame 0, which is why stills came out
smeared while the same shot looked sharp in the viewport.
`PRIME_FRAMES` renders one frame and throws it away: the clock source returns **0, not
`null`**, because a hold would not draw it and drawing it is the whole point, and the task
calls `consumePrime()` in **one** place so the still, the take and the clock skip the same
frame. It also covers `hold()` re-applying mid-capture, which _clears_ the canvas —
grabbing in that same tick read the blanked pixels.

**The head frame is released with a step of 0.** A pose driver rewinds and poses before arming
(flypath's `armTake`), so the first frame the source releases must encode the scene where it
already is; advancing first would make frame 0 of the video the scene at 1/fps and leave the
take a frame short at the head. `frames === 0` is the whole test.

**A take must not look different from the viewport, and once did.** three's `velocity`
buffer is a per-FRAME delta, so motion blur scaled with the frame's duration — a 30fps
offline take smeared 2–5× wider than the same shot live, because the engine clock steps a
fixed `1/fps`. The fix is not in capture: `ctx.shutterScale` normalises velocity into a
shutter in the pipeline itself (`core/postprocessing/CLAUDE.md`). The general rule is that
a take exercises every place a per-frame quantity was quietly standing in for a per-second
one — this was the first one found, and probably not the last.

**The take paces the loop, not the other way round.** The clock `invalidate()`s every frame it
releases, so a take renders at exactly its own rate. An early version paced off the encoder's `onReady`
instead, on the theory that one frame renders per frame encoded — false in this app, because
the sky layers (`Stars`, `CloudDeck`, `Rain`, `Birds`, …) call `invalidate()` every frame, so
the loop never idles. `onReady`'s `invalidate()` is still load-bearing for the opposite
reason: a **held** frame is not rendered at all now, so the encoder draining is the only thing
that can end a hold.

**Frames queue `MAX_QUEUE` (4) deep rather than stalling on every one.** `new VideoSample(canvas)`
snapshots the canvas synchronously and `add()` encodes asynchronously, so queueing is safe. A hold is
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

**An encoder that lands after its own take was abandoned is identified by a `generation`
counter**, bumped by every `start()` and every `teardown()` in `take.ts`. This is
load-bearing, not defensive. Stopping a take before its encoder is built leaves
`createOfflineTake` in flight with nothing left to install itself into; if a second take is
started in that window — two fast clicks on ⏺, and codec probing plus `output.start()` is
easily long enough — the **first** encoder arrives, sees a take waiting for an encoder, and
installs itself into the second take. The second encoder then arrives to find the slot taken
and does what an abandoned encoder is supposed to do: cancels itself and `discard()`s the
armed audio recorder, which now belongs to the **live** take. The output is a silent video
written by an encoder configured for the previous frame size. Comparing `id !== generation`
is the whole fix; `stop()` also hands the recorder back itself when it stops a take that was
still pending, rather than leaving that to a `.then` which may not run for a while.

## Resolution: always a preset, never "as-is"

Every capture resizes the **renderer** for its duration (`resolution.ts`), so the frame is
genuinely drawn at the selected size instead of being scaled up from a window-sized one. A 4K
take out of a half-screen window is real 4K, and everything resolution-dependent follows for
free: three's `PassNode` sizes the post-processing targets from the drawing buffer every
frame, and both captures read `renderer.domElement` at its new size.

- **The override is REFERENCE COUNTED, and that is what keeps the two captures out of each
  other's way.** `acquire()` installs it on the first holder and hands back that holder's
  (idempotent) release; the size is restored only when the last one lets go. So a still armed
  during a take simply joins that take's override, and neither can pull the canvas out from
  under the other. The predecessor tracked this with a `stillOwnsResolution` flag plus a
  `!offlineTake && !offlinePending` re-check in the task, which had to be read in three
  places to answer one question — and still left a narrow hole where a take failing after
  it resized would release the override out from under a still armed a frame earlier.

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
  triggers the first, so `hold()` re-claims it on the next frame — and because re-claiming
  costs a prime frame that the task burns before either capture runs, a frame of the wrong
  size can never reach the encoder. That is what lets the take configure its encoder once,
  at `start()`, from `renderer.domElement`.
- **There was a `viewport` ("as-is") option** meaning "whatever the canvas already is, CSS size
  × DPR". Removed: it is the one setting whose output nobody can predict from the panel (it
  depended on the window and the display's DPR), and it forced a null-target branch through
  the override, the still path, the video sizing and the panel. Reviving it means making
  `captureResolutionSize` nullable again.

## Audio: a deterministic offline render

Audio is the one guarantee here that cannot come from the take owning the engine clock:
Web Audio has no clock to own — `AudioContext.currentTime` is wall-clock and cannot be
substituted. A **live tap** (a `MediaStreamAudioDestinationNode` fanned off the master bus,
encoded by mediabunny's pull-style `MediaStreamAudioTrackSource`) cannot work either: the
video track is `frameIndex / fps` scene-seconds no matter how long each frame took, while a
tap records whatever the `AudioContext` produced at that wall-clock moment. On a machine
sustaining the target fps the two stay close; on a heavy take — 4K, a demanding scene, a slow
GPU — the finished file's sound runs ahead of its picture by exactly how far the renderer
fell behind (`core/audio/scheduler.ts`, `schedulerDrift()`). No fix keeps a tap "live": the
only correct answer is to render the audio offline through the same scene clock. The
machinery lives in `core/audio/` (`timeline.ts` + `render.ts` — see that CLAUDE.md for the
recorder's contract); this section covers capture/'s half of it.

- **Armed at the same instant the clock is claimed.** `take.ts`'s `start()` calls
  `audio.recording.arm(sceneNow())` immediately before `setFixedStepSource(step)` — both
  synchronous in the same call — so the audio take's window and the video's first frame
  start on the same scene second. Voices already sounding (the music/ambience beds,
  typically looping since boot) are entered with their playback cursor, so the replay
  seeks into the buffer by exactly what has already been heard.
- **Rendered at stop, not tapped while running.** `take.ts`'s `finalize()` calls
  `audio.recording.render(take.encodedSec)` — `frameCount / fps`, the same counter the
  video timestamps come from — and hands the buffer to `finish()`. The buffer is exactly
  that many seconds long, so sync is exact **by construction, at any render speed**: a 4K
  take crawling at 8 fps produces the same audio as one running at 60. The offline render
  is async and lands inside `isFinalizing`, which exists for exactly this window.
- **A PUSH source, like the video's.** mediabunny's `AudioBufferSource` takes the whole
  buffer in one `add()` at finalize — after every video frame, not interleaved; the muxer
  buffers, and a 60 s stereo take at 48 kHz is ~23 MB, well inside what the video already
  holds in memory. The track itself must be added before `output.start()`, long before the
  buffer exists, so it is added whenever the machine can encode one; a take that turns out
  to have no voices simply never writes to it.
- **Every stop path disarms the recorder.** A normal stop renders; encoder-creation
  failure, mid-take encoder failure and a stop that raced encoder creation `discard()`
  instead — otherwise the layer keeps sampling automation for a take that will never
  exist.
- **The live graph during a take is a MONITOR.** Nothing in the output depends on it —
  voices still play at wall pace (slope 1, `core/audio/scheduler.ts`), so on a slow take
  the operator hears the take being made rather than the file being written. A clap may
  sound misplaced live and still land exactly right in the file.
- **Never fatal, and there are FOUR ways it can go wrong, not three.** No encodable audio
  codec for the container (probed via `getFirstEncodableAudioCodec`, same shape as the video
  codec probe: webm tries opus then vorbis, mp4 tries aac then opus), an empty take, a failed
  offline render, **and the audio encoder rejecting the rendered buffer inside `finish()`** —
  each falls back to a silent video rather than failing the take. That last one is the easy
  one to leave unguarded: the obvious `.catch()` sits around `recording.render()`
  only, and a throw from `audioSource.add()` skips `close()` and `finalize()` and
  takes **the whole video** with it. It is reachable because the codec is probed
  before the buffer exists — the channel count (2, matching `CHANNELS` in
  `core/audio/render.ts`) and the bitrate can be passed to the probe, but the sample rate
  cannot, since it is the live `AudioContext`'s and the buffer is not rendered until stop.
  `OfflineTake.hasAudio` reports which happened; the panel status line and the console log
  both say `(no audio)` when it does.
- Audio bitrate is a fixed 160 kbps, not a panel control — the video bitrate slider is the
  one dial that matters for file size.

## What ends up in the output

1. **The toolbar, its panes and the scene HUD are HTML**, siblings of the canvas. Nothing HTML is ever composited into the canvas, so reading the canvas back excludes them for free.
2. **Studio's 3D content is in the canvas, and is captured** — grid, axes/light/group helpers, transform controls, the selection-outline quad. That is deliberate: each has its own toolbar toggle (and deselecting clears the outline), so it is a per-shot decision by the user, and sometimes the grid is exactly what you want in frame. An earlier version auto-hid all of them via Studio's `studio-objects-registry`; it was removed as unwanted policy, not as dead code — that registry is still the handle to use if per-capture hiding is ever wanted back.
3. **The corner navigation Gizmo is the exception.** It has no useful toggle short of disabling the editor camera, and is never wanted in an image. It is a `@threlte/extras` component mounted by Studio's `CameraControls`, rendering from its own task registered `{ after: autoRenderTask }`, and among tasks sharing a constraint the DAG falls back to registration order (`DOCS/webgpu-notes.md` §2) — so the grab runs after the pipeline draws the frame but **before** the Gizmo composites on top.

## Key behavior

- **Mount position in `App.svelte` is load-bearing.** `<Capture />` is in the same `{#await Promise.all([...])}` as `<Studio>` and immediately before it. One Promise.all resolving into one fragment means both mount in the same tick in document order, so the grab task registers ahead of the Gizmo's and stays there (the Gizmo re-registers when the editor camera is toggled, which only pushes it later). Two separate dynamic imports racing for task order would not be a guarantee. Being in that block also keeps it out of the production bundle — a static import does **not** get tree-shaken here; it leaked the whole encoder path into `index.js` when tried.
- **There is exactly ONE task, and `Capture.svelte` owns it.** It runs `hold()` → the prime-frame check → `still.tick()` → `take.tick()`, in that order, and the order is the whole reason the pieces can stay independent: the size is re-claimed before anything reads the canvas, and a re-claim's prime frame is burned before either capture gets a frame. Adding a second task for a second capture kind would put both of those guarantees back up for grabs.
- **The grab task only runs on frames that rendered.** Tasks constrained `{ after: autoRenderTask }` inherit the renderStage, whose callback gates the whole stage on `shouldRender()` (threlte core `scheduler.svelte.js`). That is exactly the guarantee a canvas read-back needs — the WebGPU canvas is `COPY_SRC`, and a valid `drawImage` source and `VideoFrame` source (`webgpu-notes.md` §5.2), but only while the frame is current.
- **Screenshots are armed, not taken, by the action.** Outside the render loop the canvas holds the last frame's _final_ composite — Gizmo included — so only a grab from inside the task, on a frame that actually rendered, lands in the pre-Gizmo window. The action sets a pending flag, acquires the resolution override and `invalidate()`s; the frame after the prime frame is grabbed. Output is exactly the selected resolution — the still and the video share one size setting and one override.
- **The capture task never invalidates for a take.** The engine clock invalidates every frame it releases, which is what makes the take's pace its own; a held frame deliberately renders nothing. `maxDurationSec` still auto-stops, so a forgotten recording cannot run forever.
- **The duration cap is checked before pushing a frame, not after**, so a take never finalizes in the same tick it queued a frame. `finish()` awaits **all** outstanding `add()` promises — `Output.finalize()` is documented as "call after all samples have been added" and says nothing about samples still being digested, and this is not the guarantee to leave to undocumented behaviour. The cap writes its status line **before** calling `stop()`, because `stop()` starts the finalize chain and has its own progress messages to put up.
- **A failed `finish()` has to `cancel()` the take.** The output is left `'started'` or `'finalizing'` with its WebCodecs encoders alive, and nothing else will ever close them — so the error path in `finalize()` cancels, and `cancel()` tolerates the terminal states (`'canceled'`, `'finalized'`) rather than assuming it is only ever reached from a clean abort.
- **Every panel control is either refused mid-take or genuinely live, and nothing in between.** `resolution` / `container` / `fps` / `bitrateMbps` are all refused by their actions and `disabled={busy}` in the panel — `fps` and `bitrate` not because a change would break anything but because the encoder captured both at creation and `frameStep` was latched at `start()`, so a drag would move the slider and change nothing. `maxDurationSec` is deliberately live: the cap is re-read every frame, so lowering it stops a running take early.
- **Video goes STRAIGHT off the live canvas**, via `new VideoSample(renderer.domElement, { timestamp, duration })` handed to a mediabunny `VideoSampleSource`. `VideoSample` wraps `new VideoFrame(canvas)`, which snapshots synchronously exactly like `drawImage` does — so the read is legal under the same rule (inside the task, frame current, pre-Gizmo) and the queueing argument above is unchanged.
  - **There was a second 2D canvas**, blitted into per frame and handed to a `CanvasSource` — which mediabunny's own docs describe as "a convenient wrapper around `VideoSampleSource`" that does the same `new VideoSample(canvas, …)` internally, one copy later. Removing it removed the most expensive thing capture did per frame, and with it the `videoCanvas`, its `alpha: false` context, `blitVideo()`, and the even-rounding of a possibly-DPR-scaled size.
  - **The catch is ownership.** `VideoSampleSource.add()` passes `shouldClose: false` internally where `CanvasSource.add()` passes `true`, so **the caller must `close()` the sample** — and only once `add()` settles, since the encoder reads from it until then. That is what `.finally()` in `push()` is for; dropping it leaks a full frame of GPU memory per encoded frame.
  - `sizeChangeBehavior: 'fill'` is kept as the safety net it always was. The default is `'deny'`, which _throws_, and the encoder is now sized from a canvas capture does not own — so keep the net, even though `hold()`'s prime frame means a wrong-sized frame should not reach it.
- **The still still blits**, into its own 2D canvas, because `toBlob()` needs one. That copy scales with the _backing store_ — at 4K it is a 3840×2160 copy — so its context is acquired **once**, when the grabber is built, never inside the blit: `getContext` options only apply on the first call for a given canvas. Do not move it into the blit.
- Codecs are probed in container order via `getFirstEncodableVideoCodec` (webm: vp9 → av1 → vp8; mp4: avc → hevc → av1), so a machine without an H.264 encoder still gets an mp4 (av1 in an mp4 container). There is **no cross-container fallback** — a container with none of its codecs available throws and the take fails with "Offline recording failed" — which is why the file extension is always the chosen container, never derived from the codec that won.
- **`stats/` pauses itself while `isRecording`** (task skipped _and_ `backend.trackTimestamp` cleared). It is ~10 canvas repaints plus per-pass timestamp queries per frame, none of which is in the output anyway — the panels are HTML siblings of the canvas.
- `captureActions` exposes explicit `startRecording()` / `stopRecording()` alongside `toggleRecording()`, so another extension can bracket a recording around its own playback — `flypath/` does exactly that for **🎬 Record Flythrough**.
- `capture.svelte.ts` holds one register/unregister slot (same shape as `scenes/DemoScene/mirrorFloor.ts`): the **driver**, because the renderer, the task and the encoder must all live inside `<Canvas>` while the panel does not.
- **`captureActions.isBusy()` is the single definition of "busy"**, and the panel derives from it (`$derived(captureActions.isBusy())`) rather than re-spelling `isRecording || isFinalizing`. There were three copies of that expression; a fourth is how one of them ends up wrong.
