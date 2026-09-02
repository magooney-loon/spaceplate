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

| Extension        | State                                               | Actions                                             | Studio UI                                                    | Docs                                           |
| ---------------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `scene`          | `sceneState`                                        | `sceneActions`                                      | `SceneExtension.svelte` ✅                                   | [scene/](scene/CLAUDE.md)                      |
| `settings`       | `settingsState`, `overlayState`                     | `audioActions`, `graphicsActions`, `generalActions` | none (state-only)                                            | [settings/](settings/CLAUDE.md)                |
| `input`          | `inputState`                                        | `inputActions`, `inputQueries`, `advanceInputFrame` | none (runtime only)                                          | [input/](input/CLAUDE.md)                      |
| `logger`         | `loggerState`                                       | `loggerActions.toggleChannel(ch)`                   | `LoggerExtension.svelte` ✅                                  | [logger/](logger/CLAUDE.md)                    |
| `sound`          | `soundState`                                        | (via `settingsState.audio`)                         | `SoundExtension.svelte` ✅                                   | [sound/](sound/CLAUDE.md)                      |
| `physics`        | `physicsState`                                      | `physicsActions`                                    | `PhysicsExtension.svelte` ✅                                 | [physics/](physics/CLAUDE.md)                  |
| `gltf-viewer`    | `gltfViewerState`                                   | `gltfViewerActions`                                 | `GltfViewerExtension.svelte` ✅ (dev only)                   | [gltf-viewer/](gltf-viewer/CLAUDE.md)          |
| `stats`          | —                                                   | —                                                   | `StatsExtension.svelte` ✅ (stats-gl)                        | [stats/](stats/CLAUDE.md)                      |
| `skybox`         | — (env-mode state lives in `core/skybox/environment/`) | — (drive `environmentActions` there) | `SkyboxExtension.svelte` ✅ time + weather + env             | [skybox/](skybox/CLAUDE.md)                    |
| `postprocessing` | `postprocessingState` (defaults from the `$core/postprocessing` registry) | `postprocessingActions` (setEnabled/resetEffect/resetAll) | `PostProcessingExtension.svelte` ✅ registry-driven | [postprocessing/](postprocessing/CLAUDE.md) |

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


