# Engine utils (`src/core/utils/`)

Boot, the engine clock, the render pipeline owner, and telemetry.

```
engineClock.ts        — THE engine clock: wraps scheduler.run so one fixed step can replace
                        the frame's real delta for every stage, task, Rapier accumulator and
                        TSL `time` at once. Pass-through unless a fixed-step source is
                        installed — only capture ever does. Read its header before touching
                        anything that integrates a delta
EngineClock.svelte    — Installs the clock. Renders nothing, registers no task
capabilities.svelte.ts — Boot probe (WebGPU adapter / WebGL2 / WASM) awaited in main.ts before
                        mount, so the verdict is synchronous everywhere: capabilityState.tier
                        'webgpu' | 'webgl' | 'none' (+ adapter info, features, dGPU guess,
                        CPU/memory). Also seeds the graphics preset
Loader.svelte         — Asset loading screen (useProgress) + sound-enable prompt (autoplay
                        unlock), armed once assets settle. Owns every full-screen cover:
                        the blocking unsupported screen, the dismissible WebGL-fallback
                        badge, and the scene-transition veil (sceneState.isTransitioning)
Renderer.svelte       — RenderPipeline owner: structural rebuild + hot uniform effects + render
                        task
PhysicsWorld.svelte   — <World> with Rapier's synchronization stage pinned before the MAIN
                        stage. App.svelte mounts this, never <World> directly
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
  `velocity` MRT is the live case: it is an NDC delta per _frame_, so motion blur was 2–5×
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

## PhysicsWorld.svelte — the synchronization stage runs before the main stage

`@threlte/rapier` constrains its synchronization stage `after: simulation, before:
renderStage` and **nothing else**, so it sorts after the MAIN stage and every main-stage
task reads a body transform that is a full frame stale — including `useFollow` and
`<CameraControls>`, which is the whole of TestGame's chase rig (`DOCS/testperf.md` §1.7).

**It is fixed on its own merits, not because it fixed a symptom.** It was found while
chasing the car's judder at 4K; that turned out to be fill rate (§2.6) and this changed
nothing observable about it. What it does buy is that main-stage consumers read the pose
about to be drawn rather than the previous one, for one public prop and no runtime cost.

This component is `<World>` plus one public prop —
`synchronizationStageOptions={{ before: mainStage }}` — giving `resize → simulation →
synchronization → mainStage → renderStage`. **`App.svelte` mounts this, not `<World>`.**

- It is fixed at the stage because Threlte's own hooks (`useFollow`,
  `<CameraControls>`) hard-code the main stage and expose no ordering option. Our own
  tasks should still read poses from the render stage (`{ before: autoRenderTask }`) —
  the stage fix is the safety net, not a licence to stop caring.
- Rapier's real guarantees are untouched: the option is _merged_ with the built-in
  `before: renderStage`, and `after: simulation` still holds.

## Telemetry — two tasks, two questions

`{ after: autoRenderTask }` puts a task in the RENDER stage, whose callback only runs
when a frame is actually rendered; a default task is in the main stage, which runs every
animation frame, rendered or not. Telemetry registers one of each — counting both is
what lets the fps/loopHz pair tell "on-demand skipped the render" apart from "the loop
stalled".
