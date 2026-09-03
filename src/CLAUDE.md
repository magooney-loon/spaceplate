# Frontend (`src/`)

Svelte 5 + Threlte 8 on the **WebGPU** renderer. See the root `CLAUDE.md` for commands
and path aliases.

> **Import Threlte from the WebGPU entrypoints:** `@threlte/core/webgpu` (not `@threlte/core`) and
> `three/webgpu` (not `three`). Mixing entrypoints gives you two renderer contexts and silently broken materials.

Every area has its own `CLAUDE.md`: `core/` (+ `audio/`, `input/`, `skybox/`,
`postprocessing/`, `utils/`), `extensions/` (+ one per extension), `scenes/`.

## File structure

```
App.svelte          — Canvas (createRenderer → WebGPURenderer) + Rapier World + Studio boundary;
                      Keymapper / Loader / SceneHud are siblings outside the Canvas
Root.svelte         — SpacetimeDB provider wrapper (wraps App); mounted by main.ts
main.ts             — Entry point
Scene.svelte        — Keep-alive 3D scene router: scenes mount on first visit (visited latch) and stay
                      mounted; switching toggles group `visible` only — no dispose, no recompile.
                      The boot warmup sweep (Loader → sceneActions.warmupScenes) visits every scene
                      behind the loading screen and warm-renders it via bootState.warmVersion
SceneHud.svelte     — HTML overlay router (sibling to Canvas) + global settings overlay
app.css             — Global styles
module_bindings/    — Generated SpacetimeDB bindings — DO NOT EDIT
lib/                — Empty by convention; app-specific shared code goes here
__debug/            — Dev-only probes, NOT app code. Armed by uncommenting the single
                      `import './__debug'` in main.ts; commented, none of it is bundled.
                      One module per probe (→ see its index.ts before adding one)

core/               — engine core: audio, input, skybox, postprocessing, utils (→ core/CLAUDE.md)
extensions/         — extension system + per-extension docs (→ extensions/CLAUDE.md)
scenes/             — one dir per scene: 3D component + HUD component (→ scenes/CLAUDE.md)
```

### Barrels

Every extension has an `index.ts` barrel — import via `$extensions/<name>`, not deep paths:

```ts
import { settingsState } from '$extensions/settings';
import { logEngine } from '$extensions/logger';
import { soundActions, MouseLook } from '$core';
```

Exceptions that stay path imports (documented in each barrel): `*Extension.svelte` Studio panels,
`useX.ts` Studio-aware hooks, and runtime components like `PhysicsController.svelte`.
`extensions/skybox` has no barrel at all — it is panel-only since its state moved to
`core/skybox/environment/`.
Modules _inside_ an extension import each other relatively, never through their own barrel — that
would create a circular module graph.

## Architecture rules

### HUD vs 3D scene

- **3D content** (meshes, lights, cameras) lives inside `<Canvas>` — `Scene.svelte` → scene components.
- **HTML overlays** (buttons, panels, forms) cannot live inside Canvas — `SceneHud.svelte` → HUD components.
- HUD components are siblings to Canvas in a `position: relative` wrapper.
- Scene HUD routing uses separate `{#if}` blocks, not `{:else if}`.

### Graphics state (WebGPU migration)

The renderer is `WebGPURenderer`, which auto-falls back to WebGL when WebGPU is unavailable.
`App.svelte` builds it in `createRenderer` and passes `dpr` derived from `settingsState.graphics.quality`.

- **Which backend you actually got is decided by the boot probe**, `core/utils/capabilities.svelte.ts`,
  awaited in `main.ts` before `mount()` — `navigator.gpu` existing is not proof, only a successful
  `requestAdapter()` is. `capabilityState.tier` is `'webgpu'` (adapter), `'webgl'` (the renderer's
  own silent fallback — Loader shows a dismissible badge) or `'none'` (App.svelte never mounts the
  `<Canvas>`; Loader blocks with a webgpureport.org link). WASM is in the same verdict, since
  `Scene.svelte` lives inside `<World>`.

- **`core/utils/Renderer.svelte` owns the post-processing `RenderPipeline`**: a structural
  effect swaps the graph when the enabled set / quality / structural params change; a
  uniform effect writes param drags in place (no rebuild). Registry + builder rules and
  the browser-verified MRT/TSL gotchas: `core/postprocessing/CLAUDE.md`. `<Canvas
  autoRender={false}>` is a Canvas **option** — never toggled from an `$effect`
  (`webgpu-notes.md` §3.1) — and the pipeline renders from a task registered
  `{ after: autoRenderTask, autoInvalidate: false }` (`webgpu-notes.md` §2). Renderer.svelte
  must stay the **first** child inside `<Canvas>` so it draws before the Gizmo.
- **Tone mapping is owned by Threlte's renderer context** (default AgX), driven by the `<Canvas>`
  `toneMapping` option. Never also write `renderer.toneMapping` from a component — two owners for
  one property caused several of the earlier bugs. (The FXAA effect only _reads_ it, when it
  takes over the output colour transform.)

Background: `DOCS/webgpu-notes.md` — WebGPU gotchas, the Studio task-ordering rules any new
pipeline must follow, and the reactivity rules. Read it before debugging anything renderer-shaped.

### Extensions (`extensions/`)

Full rules live in `src/extensions/CLAUDE.md` — the extension system (`.svelte.ts` state + Studio
panel pattern, templates, extension inventory) and the per-extension reference. The essentials:

- **State in `.svelte.ts` modules is always reactive and works everywhere** — production,
  components, hooks. Threlte Studio is a **dev-only editor** (`VITE_GAME_ENGINE=true`) whose
  toolbar panels tweak that same state. **Never put logic in `*Extension.svelte` — UI only.**
- **Registering** — Studio and every `*Extension.svelte` are dynamically imported inside
  `{#if import.meta.env.VITE_GAME_ENGINE === 'true'}` in `App.svelte`, so none of it ships to
  production.
- **Never read and write the same reactive object in one `$effect`** — that's an unconditional
  infinite loop (`effect_update_depth_exceeded`); it caused both the render-pipeline rebuild and
  the skybox preset crash. Depend on primitives (`$derived(state.quality)`), not whole objects.
- Cross-extension access is a direct import — `settingsState.audio.sfxVolume = 0.8`; persist to
  localStorage inside actions, never `$effect`.
- Scene switching: `sceneActions.setScene(...)` / `transitionTo(...)` (`$extensions/scene`).
  Game input: `inputQueries.isPressed('player1', 'jump')` (`$extensions/input`; the window
  listeners live in `core/input/Keymapper.svelte`). Static asset paths always go through
  `BASE_URL` (`$extensions/settings`).

### Frame tasks

- **A task's `delta` is SCENE time, not wall-clock time** — integrate it and nothing else.
  `core/utils/engineClock.ts` wraps `Scheduler.run` so a fixed-step source (an offline
  capture take, and nothing else today) can substitute one step for the frame's real delta
  upstream of every stage, task, Rapier accumulator and TSL `time` node. Full rules
  (the `performance.now()` ban, `delta === 0`, handover continuity):
  `core/utils/CLAUDE.md`.
- No stage wrapper — components register plain `useTask`s from `@threlte/core/webgpu` with
  explicit ordering constraints: `{ before: autoRenderTask }` for pre-render work (the sky
  driver + layers in `core/skybox/`), `{ after: autoRenderTask }` for post-render work
  (the draw task in `Renderer.svelte`, stats, the demo capture tasks).
- Always pass `autoInvalidate: false` and call `invalidate()` only when the task actually
  moved something — Threlte's `renderMode` is 'on-demand', and a task with the default
  auto-invalidate forces a full-rate render loop forever (see `Skybox.svelte`).
- Inside a `<World>`, use `usePhysicsTask` from `@threlte/rapier` (runs before each physics
  step, respects fixed framerate). Physics is scene-gated by `Scene.svelte`'s
  `pause()/resume()` on `useRapier()`, not by task stages.
- Among tasks sharing a constraint the DAG falls back to registration (mount) order —
  parents register before children.

### Sky & weather (`core/skybox/`)

Full rules live in `src/core/skybox/CLAUDE.md` (plus `model/`, `layers/` and
`environment/` sub-docs). The essentials:

- **The descriptor is plain, not `$state`**: one writer — `Skybox.svelte`'s driver
  task — and every consumer reads it from its own task. Per-frame values are never props.
  `skyMeta` is the `$state` mirror for HUD/Studio only, epsilon-gated.
- **Weather is a modulation layer over the day curve**, never a replacement for it — a
  storm at noon is still noon under clouds. Eight channels; named weathers are target
  vectors; blends run on wall-clock ms with staggered onsets.
- Game-facing API is `skyActions` / `skyQueries` from `$core/skybox/model`:
  `setWeather('storm', { over: 30_000 })`, `setWeather({ fog: 0.9 }, { over: 0 })` (raw
  partials are first-class), `clearWeather()`, clock setters, `on('sunrise', ...)`.
- **`invalidate()` has one owner per reason**: the driver task covers the pure descriptor
  consumers (Sky, SkyFog, SkyLight, Moon — they must not invalidate themselves);
  TSL-`time`-animated layers and Lightning gate their own, on visibility.
- `extensions/skybox/` is **panel-only** (time + weather + env mode + ⚡ Strike Now via
  `requestStrike()` from `$core/skybox/layers/lightning/flashState`). The env-mode state
  itself lives in `core/skybox/environment/` — `Skybox.svelte` consumes it in every
  build, so it is engine state, and the panel is just another caller.
- Weather audio (rain bed + thunder) is `core/audio/weatherAudio.ts`, outside the layers
  on purpose: layers unmount with the environment mode, a looping bed must not.

## SpacetimeDB client

Server module docs live in `spacetimedb/CLAUDE.md`; CLI in `spacetimedb/CLI.md`.

- `Root.svelte` builds the connection and calls `createSpacetimeDBProvider(connectionBuilder)` from
  `spacetimedb/svelte` (this is a plain Vite app — the SvelteKit `+layout.svelte` examples in the
  module docs map onto `Root.svelte` here). Auth token is cached under `${HOST}/${DB_NAME}/auth_token`.
- `useTable(tables.x)` from `spacetimedb/svelte` returns `[rows, isLoading]`.
- Reducer calls take **object** args: `conn.reducers.doSomething({ value: 'test' })`.
- SpacetimeDB UI belongs in HUD components (HTML), never in 3D scene components.
- Regenerate bindings with `pnpm spacetime:generate`; never hand-edit `src/module_bindings/`.
