# Engine utils (`src/core/utils/`)

Boot, the engine clock, the render pipeline owner, and telemetry.

```
engineClock.ts        — THE engine clock: wraps scheduler.run so one fixed step can replace
                        the frame's real delta for every stage, task, Rapier accumulator and
                        TSL `time` at once. Pass-through unless a fixed-step source is
                        installed — only capture ever does. Read its header before touching
                        anything that integrates a delta
EngineClock.svelte    — Installs the clock AND the frame-rate cap (Settings ▸ General ▸ maxFps;
                        0 = VSync, the default — no gate installed). Renders nothing, registers no
                        task: the clock wraps scheduler.run, the cap wraps the animation-loop
                        callback three calls every vsync, so a throttled tick never reaches the
                        scheduler at all. The cap bypasses while engineClock.fixed (a capture take)
capabilities.svelte.ts — Boot probe (WebGPU adapter / WebGL2 / WASM) awaited in main.ts before
                        mount, so the verdict is synchronous everywhere: capabilityState.tier
                        'webgpu' | 'webgl' | 'none' (+ adapter info, features, dGPU guess,
                        CPU/memory). Also seeds the graphics preset
Loader.svelte         — Asset loading screen (useProgress) + sound-enable prompt (autoplay
                        unlock), armed once assets settle. Owns every full-screen cover:
                        the blocking unsupported screen, the dismissible WebGL-fallback
                        badge, and the scene-transition veil (sceneState.isTransitioning),
                        which shows the same bar/status when a scene entry is loading
assetGate.ts          — waitForAssetsIdle(): "the loading queue has drained", awaited by
                        the scene transition so a scene's own assets land under the veil
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

## The asset gate (`assetGate.ts`)

`waitForAssetsIdle()` is "has the app stopped loading yet?", callable. The scene
transition awaits it after the swap (`$extensions/scene`), which is what makes the veil
cover a scene's OWN assets — the boot Loader only ever covered the boot scene's, so every
later entry used to run on a fixed budget and pop its GLBs in afterwards.

- **Idle means QUIET FOR A GRACE PERIOD, not `loaded === total`.** three's LoadingManager
  has no drain event worth latching: `loaded` catches up with `total` transiently BETWEEN
  items. Same rule as `Loader.svelte`'s boot `settled`, and the nothing-to-load case falls
  out of it for free.
- **It watches the DEFAULT loading manager**, which is where every loader in this app ends
  up — `useGltf`/`useLoader`, the bare `TextureLoader`s, the audio buffers. That is why a
  scene declares nothing: mounting it starts its loads and the gate sees them.
- **A promise that never touches the manager is invisible to it.** The escape hatch for
  one is `@threlte/extras`' `<Suspense>` + `useSuspense()` around that scene's subtree.
  Nothing needs it today, which is why no per-scene declaration API exists — an empty
  layer is the mistake the deleted scene-preset system made.
- **It can delay an entry, never block one:** a timeout caps the wait and logs, and the
  transition proceeds either way.
- Wall-clock (`Date.now`), deliberately. The engine clock's ban covers things ANIMATED off
  a delta; a download takes as long as it takes and a below-realtime capture take must not
  stretch the timeout with it.

## Renderer.svelte — pipeline ownership

- Owns exactly one `THREE.RenderPipeline` for its lifetime and swaps its `outputNode` as the
  **structural key** changes; param drags never rebuild (uniform writes via
  `$core/postprocessing`). See `src/core/postprocessing/CLAUDE.md`.
- Registered `{ after: autoRenderTask, autoInvalidate: false }` per the Studio
  task-ordering rules (`DOCS/webgpu-notes.md §2`), and must stay the **first** child
  inside `<Canvas>` so it draws before the Gizmo.
- **Its render task also arms the key light's shadow** (`armKeyShadow()`, first line),
  because it owns the main draw and the shadow cascades are fitted to whichever camera
  renders them. That is the only reason a renderer file imports from `core/skybox/`;
  `core/skybox/keyShadow.ts` has the full argument.

## The frame-rate cap (EngineClock.svelte)

The loop chain is `three Animation.update` (rAF, every vsync) → Threlte's loop closure
(`scheduler.run(time)` + `frameInvalidated = false`) → stages. The cap wraps THAT closure:
`renderer.getAnimationLoop()` hands back exactly what Threlte installed, and a gate in
front of it drops ticks that come sooner than `1000 / maxFps`. It lives in EngineClock.svelte
beside the clock install — same mount, same "upstream of everything" level, different wrap
point.

- **The gate level is the whole design.** Vetoing further down (`scheduler.run`, or
  `shouldRender()`) would still let the closure clear `frameInvalidated` on a skipped
  tick — an invalidation that landed in that window would be swallowed without a render,
  so one-shot invalidators (a settings drag, a toggle) could drop frames. At the loop
  level, pending invalidations simply wait for the next accepted tick.
- Everything downstream follows the cap — stages, tasks, Rapier sync, the render — so
  the per-tick CPU saves as well as the GPU. three still wakes us every vsync (one
  early-returned call) and still advances `nodeFrame.time` on the wall clock, which is
  exactly the semantics a cap should have: scene time real, accepted deltas bigger,
  every integrator delta-driven, physics catching up in fixed substeps.
- **Effective rates snap to whole refresh intervals** (rAF only ticks on vsyncs): 60 on
  a 144 Hz panel lands at every 3rd vsync (~48); on 60 Hz, 60 is a no-op and 30 exact.
  rAF timestamps are ALSO quantized (commonly to 1 ms — on a 60 Hz panel deltas arrive
  as alternating 16/17 instead of 16.67), which a naive `delta < interval` gate turns
  into dropped frames: measured 60 → ~40 (2 of 3 ticks) and 30 → ~20 (1 of 3). The
  gate therefore takes a 1 ms tolerance and advances a DRIFT-FREE virtual deadline
  (`max(schedule, now) + interval`) — an early-accepted frame pulls the next deadline
  sooner, quantization never compounds, and a stall resyncs instead of bursting.
- Capture takes bypass the gate while `engineClock.fixed` — an offline take paces
  itself.

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
