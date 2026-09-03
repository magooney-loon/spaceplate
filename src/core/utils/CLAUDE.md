# Engine utils (`src/core/utils/`)

Boot, the engine clock, the render pipeline owner, and telemetry.

```
engineClock.ts        — THE engine clock: wraps scheduler.run so one fixed step can replace
                        the frame's real delta for every stage, task, Rapier accumulator and
                        TSL `time` at once. Pass-through unless a fixed-step source is
                        installed — only capture ever does. Read its header before touching
                        anything that integrates a delta
EngineClock.svelte    — Installs the clock. Renders nothing, registers no task
boot.svelte.ts        — bootState: loader↔engine boot flags (warmVersion bumps → Renderer
                        warm-renders; scenesWarmed gates the sound prompt)
capabilities.svelte.ts — Boot probe (WebGPU adapter / WebGL2 / WASM) awaited in main.ts before
                        mount, so the verdict is synchronous everywhere: capabilityState.tier
                        'webgpu' | 'webgl' | 'none' (+ adapter info, features, dGPU guess,
                        CPU/memory). Also seeds the graphics preset
Loader.svelte         — Asset loading screen (useProgress) + sound-enable prompt (autoplay
                        unlock); after assets settle it runs the scene warmup sweep before
                        arming the prompt. Owns the two capability screens: the blocking
                        unsupported screen and the dismissible WebGL-fallback badge
Renderer.svelte       — RenderPipeline owner: structural rebuild + hot uniform effects + render
                        task + warm frames on bootState.warmVersion bumps
Telemetry.svelte      — Draws nothing: samples renderer.info at 2 Hz into telemetryState.
                        Mount right after <Renderer />
telemetry.svelte.ts   — telemetryState: the live half of Settings ▸ System (the static half is
                        capabilityState)
```

## The engine clock (`engineClock.ts`)

**A task's `delta` is SCENE time, not wall-clock time.** Integrate it and nothing else,
and new code is capture-correct for free. The clock wraps `Scheduler.run`, so a
fixed-step source (an offline capture take, and nothing else today) can substitute one
step for the frame's real delta upstream of every stage, task and Rapier accumulator in
the app. It also pins TSL `time`, which the scheduler cannot reach.

- **Do not read `performance.now()` / `Date.now()` to animate anything** — it bypasses
  the clock and drifts slow in a below-realtime take. (`core/audio/weatherAudio.ts`
  does, deliberately — audio is never captured.)
- **A `delta` of 0 is legal** — a held frame. No divisions by it.
- `engineClock.elapsed` / `.delta` / `.fixed` are readable from outside a task.
- **A per-frame quantity that is not a delta still has to be normalised by one.** three's
  `velocity` MRT is the live case: it is an NDC delta per *frame*, so motion blur was 2–5×
  wider in a below-realtime take than in the viewport. `Renderer.svelte`'s render task feeds
  `engineClock.delta` to `build.setShutterScale()` for exactly that
  (`core/postprocessing/CLAUDE.md`).
- Scene time is **continuous across handovers** (wall clock ↔ fixed-step source): every
  TSL layer's motion is a function of absolute elapsed time, so a jump either way
  teleports the cloud deck, re-phases every star and relocates the rain — on frame 0 of
  a take, the one frame that must not do that.

## Renderer.svelte — pipeline ownership

- Owns exactly one `THREE.RenderPipeline` for its lifetime and swaps its `outputNode` as
  the **structural key** changes; param drags never rebuild (uniform writes via
  `$core/postprocessing`). See `src/core/postprocessing/CLAUDE.md`.
- Registered `{ after: autoRenderTask, autoInvalidate: false }` per the Studio
  task-ordering rules (`DOCS/webgpu-notes.md` §2), and must stay the **first** child
  inside `<Canvas>` so it draws before the Gizmo.
- Warm frames (boot + `warmVersion` bumps) must go **through the pipeline itself**, not
  a plain `renderer.render()` — the renderer's default context has no MRT, the wrong
  variants for this graph whose scene pass lives in a private contextNode namespace.

## Telemetry — two tasks, two questions

`{ after: autoRenderTask }` puts a task in the RENDER stage, whose callback only runs
when a frame is actually rendered; a default task is in the main stage, which runs every
animation frame, rendered or not. Telemetry registers one of each — counting both is
what lets the fps/loopHz pair tell "on-demand skipped the render" apart from "the loop
stalled".
