# Frontend (`src/`)

Svelte 5 + Threlte 8 on the **WebGPU** renderer. See the root `CLAUDE.md` for commands and path aliases.

> **Import Threlte from the WebGPU entrypoints:** `@threlte/core/webgpu` (not `@threlte/core`) and
> `three/webgpu` (not `three`). Mixing entrypoints gives you two renderer contexts and silently broken materials.

## File structure

```
App.svelte          — Canvas (createRenderer → WebGPURenderer) + Rapier World + Studio boundary;
                      Keymapper / Loader / SceneHud are siblings outside the Canvas
Root.svelte         — SpacetimeDB provider wrapper (wraps App); mounted by main.ts
main.ts             — Entry point
Scene.svelte        — 3D scene router (inside Canvas → Threlte context)
SceneHud.svelte     — HTML overlay router (sibling to Canvas) + global settings overlay
app.css             — Global styles
module_bindings/    — Generated SpacetimeDB bindings — DO NOT EDIT
lib/                — Empty by convention; app-specific shared code goes here

core/
  index.ts              — Barrel — import engine parts from '$core'
  Camera.svelte         — PerspectiveCamera + AudioListener; orbits origin in demoScene via mouse look

  audio/
    GlobalAudio.svelte    — All <Audio> components; never unmounts
    globalAudio.svelte.ts — soundTriggers + soundActions singleton (import from here in .ts files)
    weatherAudio.ts       — Rain bed + thunder claps; the sky's audio consumer (see Sound system)

  input/
    Keymapper.svelte      — Global keyboard/mouse listeners; routes into the input extension
    MouseLook.svelte      — Mouse-look rig (mount in a scene to enable pointer-locked look)
    mouseLook.svelte.ts   — Mouse look state + pointer lock lifecycle (cross-browser hardened)

  skybox/               — Everything sky/skybox/weather (→ see core/skybox/CLAUDE.md)
    Skybox.svelte         — Mount + THE sky driver task + env/cube texture mode switch
    Sky.svelte            — WebGPU-native sky dome (three's SkyMesh), descriptor consumer
    SkyLight.svelte       — Descriptor-driven key light (sun→moon crossover) + hemisphere fill
    SkyFog.svelte         — scene.fog (FogExp2) from the day curve + fog channel
    environment/          — Env-mode state (procedural | HDR | cube) + texture lists — Skybox.svelte
                           consumes it in every build, so it is engine state, not extension
    model/                — Pure sky model: clock, sunPath, dayCurve, weatherMixer, phases,
                           events, math, types + sky.svelte.ts façade (descriptor,
                           skyActions, skyQueries, skyMeta)
    layers/               — Every renderer that draws on/around the dome:
      skyLayer.ts           — Shared plumbing: instancedQuad, billboardClip/streakClip,
                             pinFarPlane/domeVertexNode, altitudeOf, skyLayerMaterial
      celestial/            — Stars (TSL billboards, NOT points), Moon, Meteors, Nebula + milkyWay.ts
      clouds/               — CloudDeck (heavy weather mass + wind scroll)
      precipitation/        — Rain, Snow, RainLens, SnowLens, HeightField + heightField.ts
      lightning/            — Lightning + flashState.ts (shared strike state)

  utils/
    Loader.svelte         — Asset loading screen (useProgress) + sound-enable prompt (autoplay unlock)
    Renderer.svelte       — STUB: post-processing removed in the WebGPU migration (see below)
    tasks.ts              — Task pipeline: physicsStage, renderStage, uiStage, audioStage

scenes/
  MainMenu/   MainMenu.svelte, MainMenuHud.svelte, SettingsHud.svelte
  DemoScene/  DemoScene.svelte, DemoSceneHud.svelte, DemoPhysicsBodies.svelte

extensions/   — extension system + per-extension docs (→ see extensions/CLAUDE.md)
  scene/ settings/ input/ logger/ sound/ skybox/ postprocessing/ physics/ gltf-viewer/ stats/
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

Two things are currently torn out — don't assume they work:

- **`core/utils/Renderer.svelte` is a stub.** The ~300-line TSL RenderPipeline covering 25 effects was
  removed because it rebuilt itself continuously. Rendering is plain: Threlte's `autoRenderTask`
  draws the scene, no composer in between. `autoRender` is therefore left at its default (`true`);
  if a pipeline returns, set `autoRender={false}` as a Canvas _option_, never from an `$effect`.
- **`PostProcessingExtension` is unregistered** in `App.svelte` — its Studio panel broke post-migration;
  the rebuild is planned in `DOCS/post-processing.md`. `SkyboxExtension` is registered again as the
  time + environment panel for the descriptor-driven sky (`DOCS/weather-system.md`).
- **Tone mapping is owned by Threlte's renderer context** (default AgX), driven by the `<Canvas>`
  `toneMapping` option. Never also write `renderer.toneMapping` from a component — two owners for
  one property caused several of the earlier bugs.

Background: `DOCS/webgpu-notes.md` — WebGPU gotchas, the Studio task-ordering rules any new
pipeline must follow, and the reactivity rules. Read it before debugging anything renderer-shaped.
The post-processing rebuild is planned in `DOCS/post-processing.md`; the sky/weather rework in
`DOCS/weather-system.md`.

### Sound system

- `core/audio/GlobalAudio.svelte` owns all `<Audio>` Threlte components — never unmounts (no race conditions).
- `soundTriggers` / `soundActions` live in `core/audio/globalAudio.svelte.ts`.
  **Always import from the `.ts` file, not the `.svelte` file** — named exports from `<script module>`
  in a `.svelte` file aren't visible to TypeScript in `.ts` imports. `import { soundActions } from '$core'`.
- `soundActions.playSwoosh()` — polyphonic (clone per call → overlapping instances).
- `soundActions.playClick()` — one-shot (stop + restart).
- `$state.raw<ThreeAudio>()` — prevents Svelte 5 Proxy wrapping of THREE.js class instances.
- `core/audio/weatherAudio.ts` is the sky's audio consumer: the rain bed and thunder claps read
  `descriptor.weather` + `flashState` from a task ticked by GlobalAudio — never an `$effect` (the
  descriptor is not reactive, weather-system.md §14.1). The triggers deliberately do NOT live in the
  sky layers: layers unmount with the environment mode, and a looping bed must not.
- **Audio defaults must be `false`** — browser autoplay policy requires audio to start disabled.
  `Loader.svelte` shows the enable prompt that unlocks it.

### Extensions (`extensions/`)

Full rules live in `src/extensions/CLAUDE.md` — the extension system (`.svelte.ts` state + Studio
panel pattern, templates, extension inventory) and the per-extension reference (scene, physics,
input, settings, gltf-viewer, logger, sound, stats, skybox, postprocessing). The essentials:

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

### Task pipeline (`core/utils/tasks.ts`)

- Four ordered stages per frame: `physicsStage` (before render) → `renderStage` (default) →
  `uiStage` (after) → `audioStage` (after ui).
- `useGameTasks()` returns `{ stages, createPhysicsTask, createUiTask, createAudioTask }`.
- `physicsStage` only runs in `demoScene` (pauses in menus); `uiStage` pauses during transitions;
  `audioStage` always runs.
- Use these instead of raw `useTask` so execution order is guaranteed.

### Mouse look & pointer lock (`core/input/mouseLook.svelte.ts` + `MouseLook.svelte`)

Driven by `settingsState.general.mouseSensitivity` / `aimSensitivity`:

- `BASE_SENS = 0.004` rad/px × user sensitivity (`aiming` flag switches to `aimSensitivity`).
- `movementX/Y` deltas are consumed **only while pointer-locked** — locked deltas are CSS pixels
  everywhere; unlocked deltas differ per browser/DPI.
- Single-event deltas clamped (±300px) — guards the lock-engagement spike some browsers emit.
- Lock is requested on `document.body`, never the canvas (avoids WebGL driver interaction).
- Handles promise-based and legacy `requestPointerLock()`; `pointerlockerror` → 800ms retry cooldown; in-flight guard.
- Never locks in Studio mode (`VITE_GAME_ENGINE=true`) or while the settings overlay is open;
  opening the overlay always releases the lock.
- `MouseLook.svelte` rig: mount inside a scene to enable it — auto-requests lock on mount, falls
  back to the first non-UI click/keydown, releases on unmount. Currently unused: no scene mounts it
  (DemoScene dropped it; the demo camera is a static `[0, 1, 12]` vantage).
- While mounted, `secondaryAction` (RMB / Q) engages aim sensitivity; context menu suppressed while locked.

```ts
import { mouseLookState, mouseLookActions, BASE_SENS } from '$core';
// yaw/pitch in radians — consume them from a task to drive a camera
```

### Sky & weather (`core/skybox/`)

Full rules live in `src/core/skybox/CLAUDE.md` (plus `model/`, `layers/` and
`environment/` sub-docs); concept + plan of record in `DOCS/weather-system.md`.
The essentials:

- **The descriptor is plain, not `$state`** (§14.1): one writer — `Skybox.svelte`'s driver
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
