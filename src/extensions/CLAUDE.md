# Extensions (`src/extensions/`)

The extension system, conventions, and per-extension reference. Engine architecture (renderer,
task pipeline, audio, sky/weather, mouse look) lives in `src/CLAUDE.md`; the sky model itself in
`src/core/skybox/CLAUDE.md`.

## The extension system

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

Every extension has an `index.ts` barrel — import via `$extensions/<name>`, never deep paths.
The exceptions (path imports for `*Extension.svelte`, `useX.ts`, runtime components) and the
no-internal-barrel-imports rule are documented in _Barrels_ in `src/CLAUDE.md`.

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
	setEnabled(v) {
		myFeatureState.enabled = v;
		logSettings.info('Enabled:', v);
	},
	setValue(v) {
		myFeatureState.value = v;
	}
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

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiStar" title="My Feature">
		<Folder title="Settings" expanded={true}>
			<Checkbox
				label="Enabled"
				value={myFeatureState.enabled}
				on:change={() => myFeatureActions.setEnabled(!myFeatureState.enabled)}
			/>
			<Slider
				label="Value"
				value={myFeatureState.value}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => myFeatureActions.setValue(e.detail.value)}
			/>
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

| Extension        | State                                               | Actions                                             | Studio UI                                                                 |
| ---------------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `scene`          | `sceneState`                                        | `sceneActions`                                      | `SceneExtension.svelte` ✅ registered                                     |
| `settings`       | `settingsState`, `overlayState`                     | `audioActions`, `graphicsActions`, `generalActions` | none (state-only)                                                         |
| `input`          | `inputState`                                        | `inputActions`, `inputQueries`, `advanceInputFrame` | none (runtime only)                                                       |
| `logger`         | `loggerState`                                       | `loggerActions.toggleChannel(ch)`                   | `LoggerExtension.svelte` ✅                                               |
| `sound`          | `soundState`                                        | (via `settingsState.audio`)                         | `SoundExtension.svelte` ✅                                                |
| `physics`        | `physicsState`                                      | `physicsActions`                                    | `PhysicsExtension.svelte` ✅                                              |
| `gltf-viewer`    | `gltfViewerState`                                   | `gltfViewerActions`                                 | `GltfViewerExtension.svelte` ✅ (dev only)                                |
| `stats`          | —                                                   | —                                                   | `StatsExtension.svelte` ✅ (stats-gl draw calls / triangles / timestamps) |
| `skybox`         | — (env-mode state lives in `core/skybox/environment/`) | — (drive `environmentActions` there) | `SkyboxExtension.svelte` ✅ time + weather + env panel                    |
| `postprocessing` | `postprocessingState`, `postprocessingPresetsState` | `postprocessingActions`                             | `PostProcessingExtension.svelte` ⛔ unregistered                          |

### Common patterns

**localStorage persistence** — write inside actions, not `$effect`:

```ts
const MY_KEY = 'my-key';
export const myState = $state({ value: parseFloat(localStorage.getItem(MY_KEY) ?? '0.5') });
export const myActions = {
	setValue(v: number) {
		myState.value = v;
		localStorage.setItem(MY_KEY, String(v));
	}
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
<Checkbox bind:value={state.enabled} />
<!-- ❌ -->
<Checkbox value={state.enabled} on:change={() => actions.toggleEnabled()} />
<!-- ✅ -->
```

**`ToolbarButton` uses the `onclick` prop (Svelte 5), NOT `on:click`** — `on:click` silently does nothing.

**`$state.raw<T>()` for Three.js class instances** — avoids Svelte 5 Proxy wrapping that breaks them.

### svelte-tweakpane-ui components

| Component      | Use case                               |
| -------------- | -------------------------------------- |
| `Checkbox`     | Boolean toggles — `on:change`          |
| `Slider`       | Numeric — `min/max/step`               |
| `Button`       | Actions — `on:click`                   |
| `Folder`       | Group controls — `expanded={true}`     |
| `DropDownPane` | Main extension panel in the toolbar    |
| `List`         | Select — `options={[{ value, text }]}` |
| `Separator`    | Divider                                |

## Per-extension reference

### Scene state machine (`scene/`)

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

### Post-processing (`postprocessing/`)

State module is intact and untouched but **currently unused** — kept as the starting point for the
rebuild. 25+ effect definitions, preset save/load/update/delete, `resetAll()` / `resetEffect(name)`
(the latter preserves `enabled`), bundled presets in `bundledPresets.ts`. Nothing imports it at
runtime, and its Studio panel is unregistered.

### Physics (`physics/`)

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

### Input (`input/` + `core/input/Keymapper.svelte`)

Action-based mapping for keyboard, mouse, and gamepad. Persists to localStorage
(`spaceplate-input-settings` — bindings and gamepad config only, never transient pressed state).
Works in production without Studio.

**`core/input/Keymapper.svelte`** — mounted once in `App.svelte`, owns all `<svelte:window>` listeners:

- `keydown`/`keyup` → `inputState.runtime.keyboardPressed`; `mousedown`/`mouseup` →
  `inputState.runtime.mousePressed` (skips UI elements); `blur` → clears pressed state (no stuck keys).
- `Ctrl+H` intercepted as a global engine shortcut before input routing.
- The key bound to `openSettings` toggles `overlayState.settingsOpen` — in-game it only _opens_
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

inputQueries.isPressed('player1', 'jump'); // current frame
inputQueries.wasPressed('player1', 'primaryAction'); // edge detect — needs advanceInputFrame
inputQueries.getMoveVector('player1'); // { x, y }
inputQueries.getAxis('player1', 'lookX');

inputActions.startCapture('player1', 'jump', 'action');
inputActions.bindKeyboard('player1', 'jump', 'Space');
inputActions.bindMouse('player1', 'primaryAction', 'left');
inputActions.removeBinding('player1', 'jump', bindingId);
inputActions.resetAction('player1', 'jump');
inputActions.resetPlayerBindings('player1');
inputActions.resetAllInputSettings();

useTask(() => {
	advanceInputFrame();
}); // once per frame, enables wasPressed
```

`scenes/MainMenu/SettingsHud.svelte` is the tabbed UI: **General** (quality, mouse/aim sensitivity,
reserved shortcuts) · **Audio** · **Controls** (full keybinding editor with add/remove/reset per binding).

### Settings (`settings/`)

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

### GLTF viewer (`gltf-viewer/`)

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

### Logging (`logger/`)

Styled multi-channel logging with timestamp + color-coded prefix. Channels: `engine`, `settings`,
`sound`, `postprocessing`, `skybox`, `cache`, `gltf`, `physics`, `input`.

```ts
import { logEngine, logSound, logGltf } from '$extensions/logger';
logEngine.info('Scene:', scene); // console.log
logSound.warn('Missing asset'); // console.warn
logGltf.error('Failed:', err); // console.error
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

### Sound (`sound/`)

- `soundState` (`soundState.svelte.ts`) — Three.js positional-audio defaults: `refDistance` (5),
  `maxDistance` (80), `rolloffFactor` (1.5), `panningModel` (`'HRTF' | 'equalpower'`),
  `listenerEnabled`. Consumed via `useSound()` where positional audio is used (e.g. the
  `<PositionalAudio>` rig in `scenes/DemoScene/DemoPhysicsBodies.svelte`).
- Playback itself lives in `core/audio` (see _Sound system_ in `src/CLAUDE.md`); volume/enable
  toggles are `settingsState.audio`.
- `useSound.ts` — Studio-aware hook with fallback; the barrel exports state only.

### Panel-only extensions

- **`skybox/`** — `SkyboxExtension.svelte` only, no barrel. Time + weather + env-mode + ⚡ Strike
  Now panel; the state it drives lives in `core/skybox/` (see `src/core/skybox/CLAUDE.md`).
- **`stats/`** — `StatsExtension.svelte` (dev-only): stats-gl info panels (draw calls, triangles,
  points, lines, geometries, textures, programs) plus GPU timestamp queries via `TimestampQuery`
  from `three/webgpu`. No state module.
