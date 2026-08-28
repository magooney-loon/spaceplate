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
  GlobalAudio.svelte    — All <Audio> components; never unmounts
  globalAudio.svelte.ts — soundTriggers + soundActions singleton (import from here in .ts files)
  MouseLook.svelte      — Mouse-look rig (mount in a scene to enable pointer-locked look)
  mouseLook.svelte.ts   — Mouse look state + pointer lock lifecycle (cross-browser hardened)
  Keymapper.svelte      — Global keyboard/mouse listeners; routes into the input extension
  Loader.svelte         — Asset loading screen (useProgress) + sound-enable prompt (autoplay unlock)
  Renderer.svelte       — STUB: post-processing removed in the WebGPU migration (see below)
  Skybox.svelte         — Procedural sky / env texture / cubemap switch (state-driven)
  Sky.svelte            — WebGPU-native sky (three's SkyMesh); replaces @threlte/extras <Sky>
  tasks.ts              — Task pipeline: physicsStage, renderStage, uiStage, audioStage

scenes/
  MainMenu/   MainMenu.svelte, MainMenuHud.svelte, SettingsHud.svelte
  DemoScene/  DemoScene.svelte, DemoSceneHud.svelte, DemoPhysicsBodies.svelte

extensions/   — see "Extensions system" below
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
Modules *inside* an extension import each other relatively, never through their own barrel — that
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

- **`core/Renderer.svelte` is a stub.** The ~300-line TSL RenderPipeline covering 25 effects was
  removed because it rebuilt itself continuously. Rendering is plain: Threlte's `autoRenderTask`
  draws the scene, no composer in between. `autoRender` is therefore left at its default (`true`);
  if a pipeline returns, set `autoRender={false}` as a Canvas *option*, never from an `$effect`.
- **`PostProcessingExtension` and `SkyboxExtension` are unregistered** in `App.svelte` — their Studio
  panels broke post-migration. The underlying state modules still drive `Renderer.svelte` /
  `Skybox.svelte`, so nothing else changed; only the toolbar UI is absent.
- **Tone mapping is owned by Threlte's renderer context** (default AgX), driven by the `<Canvas>`
  `toneMapping` option. Never also write `renderer.toneMapping` from a component — two owners for
  one property caused several of the earlier bugs.

Background: `DOCS/webgpu-notes.md` — WebGPU gotchas, the Studio task-ordering rules any new
pipeline must follow, and the reactivity rules. Read it before debugging anything renderer-shaped.
The post-processing rebuild is planned in `DOCS/post-processing.md`; the sky/weather rework in
`DOCS/weather-system.md`.

### Sound system
- `core/GlobalAudio.svelte` owns all `<Audio>` Threlte components — never unmounts (no race conditions).
- `soundTriggers` / `soundActions` live in `core/globalAudio.svelte.ts`.
  **Always import from the `.ts` file, not the `.svelte` file** — named exports from `<script module>`
  in a `.svelte` file aren't visible to TypeScript in `.ts` imports. `import { soundActions } from '$core'`.
- `soundActions.playSwoosh()` — polyphonic (clone per call → overlapping instances).
- `soundActions.playClick()` — one-shot (stop + restart).
- `$state.raw<ThreeAudio>()` — prevents Svelte 5 Proxy wrapping of THREE.js class instances.
- **Audio defaults must be `false`** — browser autoplay policy requires audio to start disabled.
  `Loader.svelte` shows the enable prompt that unlocks it.

### Scene state machine (`extensions/scene/`)
- Scenes defined in `SCENES: SceneConfig[]` — each entry has `id`, `label`, `icon`.
  Adding a scene = one entry in `SCENES` + its `id` in `SceneType` (`types.ts`).
- `sceneActions.setScene(scene)` transitions (plays swoosh, logs);
  convenience `goToMainMenu()` / `goToDemoScene()` / `goBack()`; async `transitionTo(scene, ms)`.
- Read via `sceneState.currentScene`; `sceneState.isTransitioning` is set during `transitionTo`.

**Per-scene look is not configured here — yet.** The preset-assignment layer that used to live in
this extension (`bundledPresets.ts`, two resolvers, two localStorage override maps, four actions)
was **deleted**: it resolved to `null` for every input and held zero presets, and its resolution
`$effect` in `core/Skybox.svelte` read and wrote `transitionState` in one pass — an unconditional
infinite loop.

Its replacement is a declarative `environment` block on each `SCENES` entry (post-processing
overrides + clock/time/weather), applied imperatively from `setScene()` and **never** from an
`$effect`. Not implemented yet — see `DOCS/scene-environment.md`. Until it lands, `SCENES` entries
carry only `id` / `label` / `icon`, and `SceneExtension.svelte` is a plain scene switcher.

### Task pipeline (`core/tasks.ts`)
- Four ordered stages per frame: `physicsStage` (before render) → `renderStage` (default) →
  `uiStage` (after) → `audioStage` (after ui).
- `useGameTasks()` returns `{ stages, createPhysicsTask, createUiTask, createAudioTask }`.
- `physicsStage` only runs in `demoScene` (pauses in menus); `uiStage` pauses during transitions;
  `audioStage` always runs.
- Use these instead of raw `useTask` so execution order is guaranteed.

### Mouse look & pointer lock (`core/mouseLook.svelte.ts` + `MouseLook.svelte`)

Driven by `settingsState.general.mouseSensitivity` / `aimSensitivity`:

- `BASE_SENS = 0.004` rad/px × user sensitivity (`aiming` flag switches to `aimSensitivity`).
- `movementX/Y` deltas are consumed **only while pointer-locked** — locked deltas are CSS pixels
  everywhere; unlocked deltas differ per browser/DPI.
- Single-event deltas clamped (±300px) — guards the lock-engagement spike some browsers emit.
- Lock is requested on `document.body`, never the canvas (avoids WebGL driver interaction).
- Handles promise-based and legacy `requestPointerLock()`; `pointerlockerror` → 800ms retry cooldown; in-flight guard.
- Never locks in Studio mode (`VITE_GAME_ENGINE=true`) or while the settings overlay is open;
  opening the overlay always releases the lock.
- `MouseLook.svelte` rig: mount inside a scene (DemoScene does) — auto-requests lock on mount, falls
  back to the first non-UI click/keydown, releases on unmount.
- Demo wiring: `secondaryAction` (RMB / Q) engages aim sensitivity; context menu suppressed while locked.

```ts
import { mouseLookState, mouseLookActions, BASE_SENS } from '$core';
// yaw/pitch in radians — Camera.svelte orbits the origin with them in demoScene
```

### Skybox (`extensions/skybox/`)
- `skyboxState` / `starsState` / `transitionState` / `environmentState` drive `core/Skybox.svelte`.
- `environmentState.mode` picks procedural sky (default) | `environment` (HDR) | `cube` (cubemap);
  `ENV_TEXTURES` / `CUBE_TEXTURES` come from `envTextures.ts`.
- 11 sky presets (dawn…vacuum) and 5 star presets; each sky preset embeds a star preset.
- `skyboxActions.applyPreset(id)` — instant or animated via `requestAnimationFrame`;
  individual setters `setTurbidity` / `setAzimuth` / `setElevation` / …
- User presets persist to localStorage (`savePreset` / `loadUserPreset` / `deletePreset`);
  bundled presets go in `bundledPresets.ts` and are never stored in localStorage.

### Post-processing (`extensions/postprocessing/`)
State module is intact and untouched but **currently unused** — kept as the starting point for the
rebuild. 25+ effect definitions, preset save/load/update/delete, `resetAll()` / `resetEffect(name)`
(the latter preserves `enabled`), bundled presets in `bundledPresets.ts`. Nothing imports it at
runtime, and its Studio panel is unregistered.

### Physics (`extensions/physics/`)

Rapier via `@threlte/rapier`. The `<World>` lives in `App.svelte`, fed from `physicsState`.

- **State:** world (`gravityX/Y/Z`, `framerate`, `debug`), spawn defaults (restitution, friction,
  damping, gravity scale, CCD, sleep, random spawn), attractor (enabled, strength, range, gravity
  type, position), and `bodies: PhysicsBody[]` (`ball` | `box`, color, spawn position, per-body materials).
- **Actions:** `setGravityY(v)`, `spawnBall()`, `spawnBox()`, `clearBodies()`, `toggleAttractor()`,
  `setAttractorGravityType('newtonian')`, …
- Spawning a body auto-switches to `demoScene`; leaving `demoScene` clears spawned bodies (`Scene.svelte`).
- `PhysicsController.svelte` applies per-body forces + attractor logic; `PhysicsWorldLogger.svelte`
  logs world lifecycle. `PhysicsExtension.svelte` is editor UI only.
- Rapier specifics: `RAPIER.md`.

### Input (`extensions/input/` + `core/Keymapper.svelte`)

Action-based mapping for keyboard, mouse, and gamepad. Persists to localStorage
(`spaceplate-input-settings` — bindings and gamepad config only, never transient pressed state).
Works in production without Studio.

**`core/Keymapper.svelte`** — mounted once in `App.svelte`, owns all `<svelte:window>` listeners:
- `keydown`/`keyup` → `inputState.runtime.keyboardPressed`; `mousedown`/`mouseup` →
  `inputState.runtime.mousePressed` (skips UI elements); `blur` → clears pressed state (no stuck keys).
- `Ctrl+H` intercepted as a global engine shortcut before input routing.
- The key bound to `openSettings` toggles `overlayState.settingsOpen` — in-game it only *opens*
  (use Back to close); ignored while rebinding or typing in an input.
- `Escape` cancels an active binding capture instead of binding.

**State:** `inputState.players` (player1–player4), `.capture` (rebinding UI), `.runtime` (pressed state).
Each player map has `actions: Record<InputAction, AnyBinding[]>` (multiple bindings per action),
`axes: Record<InputAxisAction, GamepadAxisBinding | null>`, and `gamepad: { enabled, index, deadzone… }`.

**Actions:** `moveForward` `moveBackward` `moveLeft` `moveRight` `jump` `sprint` `interact`
`primaryAction` `secondaryAction` `reload` `use` `crouch` `drop` `prone` `emote` `slot1`–`slot4`
`toggleUi` `openSettings`. **Axes:** `moveX` `moveY` `lookX` `lookY`.
`toggleUi` / `openSettings` are engine-reserved — hidden from the rebind UI.

Default player1: WASD+arrows move · Space jump · Shift sprint · E interact · Q/RMB secondary ·
LMB primary · R reload · F use · C crouch · X drop · Z prone · T emote · 1–4 slots · Esc settings.

```ts
import { inputActions, inputQueries, inputState, advanceInputFrame } from '$extensions/input';

inputQueries.isPressed('player1', 'jump');            // current frame
inputQueries.wasPressed('player1', 'primaryAction');  // edge detect — needs advanceInputFrame
inputQueries.getMoveVector('player1');                // { x, y }
inputQueries.getAxis('player1', 'lookX');

inputActions.startCapture('player1', 'jump', 'action');
inputActions.bindKeyboard('player1', 'jump', 'Space');
inputActions.bindMouse('player1', 'primaryAction', 'left');
inputActions.removeBinding('player1', 'jump', bindingId);
inputActions.resetAction('player1', 'jump');
inputActions.resetPlayerBindings('player1');
inputActions.resetAllInputSettings();

useTask(() => { advanceInputFrame(); });  // once per frame, enables wasPressed
```

`scenes/MainMenu/SettingsHud.svelte` is the tabbed UI: **General** (quality, mouse/aim sensitivity,
reserved shortcuts) · **Audio** · **Controls** (full keybinding editor with add/remove/reset per binding).

### Settings (`extensions/settings/`)
- Persists to localStorage. Audio: `musicVolume/musicEnabled`, `ambienceVolume/ambienceEnabled`,
  `sfxVolume/sfxEnabled`. Graphics: `quality` (`'low' | 'high'`) — drives DPR and renderer power
  preference. General: `uiVisible` (Ctrl+H), `mouseSensitivity`, `aimSensitivity`.
- `overlayState` (same module) — transient settings-overlay open state, never persisted.
- Actions: `audioActions.toggleMusic/Ambience/Sfx()`, `setMusicVolume(v)`,
  `graphicsActions.setQuality(q)`, `generalActions.toggleUiVisible/setMouseSensitivity/setAimSensitivity`.
- **`BASE_URL`** — always use it for static asset paths; never hardcode `/` or relative paths:
  ```ts
  import { BASE_URL } from '$extensions/settings';
  const src = `${BASE_URL}sounds/click.mp3`;
  ```

### GLTF viewer (`extensions/gltf-viewer/`)

Dev-only (`VITE_GAME_ENGINE=true`). Always targets DemoScene — loading a model auto-switches to it.

- **State:** `gltfViewerState.models: GltfViewerModel[]`, `selectedId: string | null`. Each model:
  `position/rotation/scale` (rotation in degrees), `animationClips` (filled after load),
  `activeAnimations` (multiple clips blend simultaneously), `playState`
  (`'playing' | 'paused' | 'stopped'` — paused holds the frame, stopped resets to 0),
  `animationSpeed`, `crossfadeDuration`, `loop`, `visible`.
- **Actions:** `loadFromFile(file)` (Blob URL), `loadFromPath('/models/x.glb')`,
  `toggleAnimation(id, clip)`, `setPlayState(id, s)`, `setCrossfadeDuration(id, 0.3)`.
- **Crossfade:** enabling a clip → `fadeIn(crossfadeDuration)`, disabling → `fadeOut(...)`,
  re-enabling mid-fade reverses it; `0` = hard cuts.
- `GltfViewerScene.svelte` drops inside DemoScene and renders one `GltfViewerInstance` per model —
  each instance owns its own `useGltf` + mixer, preventing conflicts between models.

### Logging (`extensions/logger/`)

Styled multi-channel logging with timestamp + color-coded prefix. Channels: `engine`, `settings`,
`sound`, `postprocessing`, `skybox`, `cache`, `gltf`, `physics`, `input`.

```ts
import { logEngine, logSound, logGltf } from '$extensions/logger';
logEngine.info('Scene:', scene);   // console.log
logSound.warn('Missing asset');    // console.warn
logGltf.error('Failed:', err);     // console.error
```

Adding a channel touches two files — the Studio UI generates its checkbox from `channelStyles`:
```ts
// types.ts
export type LoggerChannel = 'engine' | … | 'game';
export type LoggerState = { …; game: boolean };

// logger.svelte.ts
export const loggerState = $state<LoggerState>({ …, game: true });
export const channelStyles = { …, game: { color: '#ff6b6b', bg: 'background:#4a2020', text: '🎮', label: 'Game' } };
export const logGame = createLogger('game', 'game');
```

## Extensions system (`src/extensions/`)

**Core principle:** state in `.svelte.ts` modules is always reactive and works everywhere — in
production, in components, in hooks. Threlte Studio is a **dev-only editor** (`VITE_GAME_ENGINE=true`)
that provides a toolbar panel to tweak that same state at runtime.
**Never put logic in `*Extension.svelte` — UI only.**

```
extensions/my-feature/
  types.ts                  — extensionScope constant + all types
  myFeature.svelte.ts       — $state + actions (always active, works without Studio)
  MyFeatureExtension.svelte — Studio toolbar UI only (dev mode)
  useMyFeature.ts           — (optional) Studio-aware hook with fallback
  index.ts                  — barrel
```

```ts
// types.ts
export const extensionScope = 'my-feature';
export type MyFeatureState = { enabled: boolean; value: number };
export type MyFeatureActions = { setEnabled(v: boolean): void; setValue(v: number): void };
```

```ts
// myFeature.svelte.ts
import { logSettings } from '$extensions/logger';
import type { MyFeatureState, MyFeatureActions } from './types';

export type { MyFeatureState, MyFeatureActions } from './types';

export const myFeatureState = $state<MyFeatureState>({ enabled: true, value: 0.5 });

export const myFeatureActions: MyFeatureActions = {
  setEnabled(v) { myFeatureState.enabled = v; logSettings.info('Enabled:', v); },
  setValue(v)   { myFeatureState.value = v; }
};
```

```svelte
<!-- MyFeatureExtension.svelte — Studio UI only -->
<script lang="ts">
  import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
  import { Folder, Slider, Checkbox } from 'svelte-tweakpane-ui';
  import { myFeatureState, myFeatureActions } from './myFeature.svelte';
  import { extensionScope } from './types';
  import type { Snippet } from 'svelte';

  interface Props { children?: Snippet }
  let { children }: Props = $props();

  const { createExtension } = useStudio();
  createExtension({ scope: extensionScope, state: () => ({}), actions: {} });
</script>

<ToolbarItem position="left">
  <DropDownPane icon="mdiStar" title="My Feature">
    <Folder title="Settings" expanded={true}>
      <Checkbox label="Enabled" value={myFeatureState.enabled}
        on:change={() => myFeatureActions.setEnabled(!myFeatureState.enabled)} />
      <Slider label="Value" value={myFeatureState.value} min={0} max={1} step={0.01}
        on:change={(e) => myFeatureActions.setValue(e.detail.value)} />
    </Folder>
  </DropDownPane>
</ToolbarItem>

{@render children?.()}
```

```ts
// useMyFeature.ts — Studio-aware access with fallback
import { useStudio } from '@threlte/studio/extend';
import { myFeatureState, myFeatureActions } from './myFeature.svelte';
import { extensionScope } from './types';

export const useMyFeature = () => {
  try {
    const { useExtension } = useStudio();
    return useExtension(extensionScope);
  } catch {
    return { state: myFeatureState, ...myFeatureActions };
  }
};
```

**Registering** — Studio and every `*Extension.svelte` are dynamically imported inside
`{#if import.meta.env.VITE_GAME_ENGINE === 'true'}` in `App.svelte`, so none of it ships to
production. Add the import to the `Promise.all([...])` and the component to `extensions={[...]}`.

### Extension inventory

| Extension | State | Actions | Studio UI |
|-----------|-------|---------|-----------|
| `scene` | `sceneState` | `sceneActions` | `SceneExtension.svelte` ✅ registered |
| `settings` | `settingsState`, `overlayState` | `audioActions`, `graphicsActions`, `generalActions` | none (state-only) |
| `input` | `inputState` | `inputActions`, `inputQueries`, `advanceInputFrame` | none (runtime only) |
| `logger` | `loggerState` | `loggerActions.toggleChannel(ch)` | `LoggerExtension.svelte` ✅ |
| `sound` | `soundState` | (via `settingsState.audio`) | `SoundExtension.svelte` ✅ |
| `physics` | `physicsState` | `physicsActions` | `PhysicsExtension.svelte` ✅ |
| `gltf-viewer` | `gltfViewerState` | `gltfViewerActions` | `GltfViewerExtension.svelte` ✅ (dev only) |
| `stats` | — | — | `StatsExtension.svelte` ✅ (stats-gl draw calls / triangles / timestamps) |
| `skybox` | `skyboxState`, `starsState`, `transitionState`, `environmentState` | `skyboxActions` | `SkyboxExtension.svelte` ⛔ unregistered |
| `postprocessing` | `postprocessingState`, `postprocessingPresetsState` | `postprocessingActions` | `PostProcessingExtension.svelte` ⛔ unregistered |

### Common patterns

**localStorage persistence** — write inside actions, not `$effect`:
```ts
const MY_KEY = 'my-key';
export const myState = $state({ value: parseFloat(localStorage.getItem(MY_KEY) ?? '0.5') });
export const myActions = {
  setValue(v: number) { myState.value = v; localStorage.setItem(MY_KEY, String(v)); }
};
```

**Cross-extension state access** — import directly, no wrappers; runes are reactive across modules:
```ts
import { settingsState } from '$extensions/settings';
settingsState.audio.sfxVolume = 0.8;
```

**Never read and write the same reactive object in one `$effect`** — that's an unconditional
infinite loop (`effect_update_depth_exceeded`). It caused both the render-pipeline rebuild and the
skybox preset crash. Depend on primitives (`$derived(state.quality)`), not whole objects.

**Use `on:change`, not `bind:`, for tweakpane toggles** — `bind:` bypasses actions:
```svelte
<Checkbox bind:value={state.enabled} />                                      <!-- ❌ -->
<Checkbox value={state.enabled} on:change={() => actions.toggleEnabled()} /> <!-- ✅ -->
```

**`ToolbarButton` uses the `onclick` prop (Svelte 5), NOT `on:click`** — `on:click` silently does nothing.

**`$state.raw<T>()` for Three.js class instances** — avoids Svelte 5 Proxy wrapping that breaks them.

### svelte-tweakpane-ui components

| Component | Use case |
|-----------|----------|
| `Checkbox` | Boolean toggles — `on:change` |
| `Slider` | Numeric — `min/max/step` |
| `Button` | Actions — `on:click` |
| `Folder` | Group controls — `expanded={true}` |
| `DropDownPane` | Main extension panel in the toolbar |
| `List` | Select — `options={[{ value, text }]}` |
| `Separator` | Divider |

## SpacetimeDB client

Server module docs live in `spacetimedb/CLAUDE.md`; CLI in `spacetimedb/CLI.md`.

- `Root.svelte` builds the connection and calls `createSpacetimeDBProvider(connectionBuilder)` from
  `spacetimedb/svelte` (this is a plain Vite app — the SvelteKit `+layout.svelte` examples in the
  module docs map onto `Root.svelte` here). Auth token is cached under `${HOST}/${DB_NAME}/auth_token`.
- `useTable(tables.x)` from `spacetimedb/svelte` returns `[rows, isLoading]`.
- Reducer calls take **object** args: `conn.reducers.doSomething({ value: 'test' })`.
- SpacetimeDB UI belongs in HUD components (HTML), never in 3D scene components.
- Regenerate bindings with `pnpm spacetime:generate`; never hand-edit `src/module_bindings/`.
