# Spaceplate Extensions

This folder contains all [@threlte/studio](https://threlte.studio/extensions) extensions for the Spaceplate application.

## Extension Structure

Each extension follows a consistent structure:

```
extensions/
  my-extension/
    types.ts              # All types and extensionScope
    {name}.svelte.ts    # State and actions (svelte module)
    {Name}Extension.svelte  # UI component
```

## Extension Types

Extensions come in two flavors:

1. **Studio Extensions** - Use Threlte Studio's `createExtension` API for toolbar UI and optional state persistence
2. **State-only Extensions** - Just provide reactive state and actions without Studio UI

## File Conventions

### `types.ts`

Single source of truth for all types:

```typescript
export const extensionScope = 'my-extension';

export type MyState = {
	enabled: boolean;
	value: number;
};

export type ExtensionState = MyState;

export type MyActions = {
	setEnabled: (v: boolean) => void;
	setValue: (v: number) => void;
	resetAll: () => void;
};

export type ExtensionActions = MyActions;
```

### `{name}.svelte.ts`

State and actions (reactive module):

```typescript
import { logSettings } from '$extensions/logger/logger.svelte';
import type { ExtensionState, ExtensionActions } from './types';

export type { ExtensionState, ExtensionActions } from './types';

export const myState = $state<ExtensionState>({
	enabled: true,
	value: 0.5
});

export const myActions: ExtensionActions = {
	setEnabled(v: boolean) {
		myState.enabled = v;
		logSettings.info('Enabled:', v);
	},
	setValue(v: number) {
		myState.value = v;
	},
	resetAll() {
		myState.enabled = true;
		myState.value = 0.5;
	}
};
```

### `{Name}Extension.svelte`

UI component with toolbar integration:

```svelte
<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox } from 'svelte-tweakpane-ui';
	import { myState, myActions } from './{name}.svelte';
	import { extensionScope } from './types';

	const { createExtension } = useStudio();

	createExtension({
		scope: extensionScope,
		state: () => ({}),
		actions: {}
	});
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiIcon" title="Name">
		<Folder title="Settings" expanded={true}>
			<Checkbox
				label="Enabled"
				value={myState.enabled}
				on:change={() => myActions.setEnabled(!myState.enabled)}
			/>
		</Folder>
	</DropDownPane>
</ToolbarItem>

<slot />
```

## Common Patterns

### 1. Logging

Use the `logSettings` logger from `$extensions/logger/logger.svelte` for settings-related logs:

```typescript
import { logSettings, logSound } from '$extensions/logger/logger.svelte';

logSettings.info('Setting changed:', value);
logSound.info('Volume:', v);
```

### 2. localStorage Persistence

For settings that persist across sessions, use localStorage directly in actions:

```typescript
const MY_KEY = 'my-key';

const loadFromStorage = (): number => {
	const v = localStorage.getItem(MY_KEY);
	return v ? parseFloat(v) : 0.5;
};

export const myState = $state<ExtensionState>({
	value: loadFromStorage()
});

export const myActions = {
	setValue(v: number) {
		myState.value = v;
		localStorage.setItem(MY_KEY, String(v));
	}
};
```

### 3. Browser Defaults

Audio-enabled states should default to `false` for browser autoplay policy compliance:

```typescript
export const settingsState = $state({
	audio: {
		musicEnabled: false, // Always off by default
		sfxEnabled: false,
		ambienceEnabled: false,
		musicVolume: loadVolume(MUSIC_VOLUME_KEY, 0) // Volumes can be persisted
	}
});
```

### 4. External State Access

Extensions can read state from other modules without using `createExtension`:

```typescript
// SoundExtension reads from settingsState
import { settingsState } from '$extensions/settings/settings.svelte';

<Slider
  value={settingsState.audio.sfxVolume}
  on:change={(e) => settingsState.audio.sfxVolume = e.detail.value}
/>
```

### 5. UI State Binding

Use `on:change` instead of `bind:` for checkboxes when you need to trigger actions:

```svelte
<!-- ❌ Don't use bind - bypasses actions -->
<Checkbox bind:value={state.enabled} />

<!-- ✅ Use on:change - triggers action -->
<Checkbox value={state.enabled} on:change={() => actions.toggleEnabled()} />
```

## Svelte 5 Caveats

### `$state` and Nested Objects

Direct mutations to `$state` objects work:

```typescript
state.nested.value = 42; // ✅ Works
```

But avoid reactive loops when syncing UI state:

```typescript
// ❌ Causes infinite loop
let localValue = $state(state.value);
$effect(() => {
	state.value = localValue;
});

// ✅ Use on:change handlers instead
```

### `$effect` with localStorage

Reading state inside `$effect` and writing localStorage can cause loops:

```typescript
// ❌ Infinite loop potential
$effect(() => {
	localStorage.setItem(KEY, String(state.value));
});

// ✅ Use on:change handlers for persistence
```

### Post-Processing Effect Disposal

When rebuilding post-processing effects (on quality change), track `isUpdatingEffects` to prevent rendering during the transition:

```typescript
let isUpdatingEffects = false;

const disposeAllEffects = () => {
	// Dispose effect references
};

$effect(() => {
	isUpdatingEffects = true;

	if (quality === 'low') {
		// Just render pass
		isUpdatingEffects = false;
		return;
	}

	disposeAllEffects();
	// Create new effects...

	isUpdatingEffects = false;
});

// In render task
useTask((delta) => {
	if (composer && !isUpdatingEffects) {
		composer.render(delta);
	}
});
```

## Existing Extensions

### Logger (`./logger/`)

Debug logging system with channel-based filtering.

**State:** Channel toggles (engine, settings, sound, postprocessing)

**Exports:**

- `loggerState` - Channel enable/disable states
- `loggerActions` - `toggleChannel(channel)`
- `logEngine`, `logSettings`, `logSound`, `logPostprocessing` - Logger instances

**Usage:**

```typescript
logSettings.info('Quality changed:', quality);
```

### Scene (`./scene/`)

Scene navigation and transitions.

**State:** Current scene, previous scene, transition status

**Exports:**

- `sceneState` - Current scene info
- `sceneActions` - Navigation methods
- `SCENES` - Scene configuration array

**Usage:**

```typescript
sceneActions.goToDemoScene();
await sceneActions.transitionTo('demoScene', 500);
```

### Settings (`./settings/`)

Application settings with localStorage persistence.

**State:** Audio volumes/enabled, graphics quality, UI visibility

**Exports:**

- `settingsState` - All settings (audio, graphics, general)
- `settingsState.audio` - Volume levels and enabled states
- `settingsState.graphics.quality` - 'low' | 'high'
- `audioActions` - Audio toggles and volume setters
- `graphicsActions` - Quality setter
- `generalActions` - UI toggle
- `BASE_URL` - For asset path construction

**Usage:**

```typescript
settingsState.graphics.quality = 'high';
audioActions.setSfxVolume(0.8);
generalActions.toggleUiVisible();
```

### Post-Processing (`./postprocessing/`)

Post-processing effects using the `postprocessing` library.

**State:** 24+ effect configurations (bloom, SMAA, vignette, etc.)

**Exports:**

- `postprocessingState` - All effect settings
- `postprocessingPresetsState` - Saved presets
- `postprocessingActions` - Preset management

**Renderer Integration:** State is consumed by `core/Renderer.svelte` to rebuild the effect composer when quality changes.

### Sound (`./sound/`)

Positional audio tuning via Threlte Studio.

**State:** Ref distance, max distance, rolloff factor, panning model

**Exports:**

- Extension actions for positional audio parameters

**Note:** Audio enabled/volume state lives in `settingsState.audio`, not here.

## Adding a New Extension

1. Create folder: `extensions/my-feature/`
2. Create `types.ts` with `extensionScope` and type definitions
3. Create `myFeature.svelte.ts` with state and actions
4. Create `MyFeatureExtension.svelte` with optional Studio UI
5. Import in `App.svelte`:

```svelte
{#await import('@threlte/studio') then { Studio }}
	<Studio
		extensions={[
			SceneExtension,
			LoggerExtension,
			SettingsExtension,
			PostProcessingExtension,
			SoundExtension,
			MyFeatureExtension
		]}
	>
		<!-- app content -->
	</Studio>
{/await}
```

## UI Components

We use [`svelte-tweakpane-ui`](https://github.com/nicegui/svelte-tweakpane) for extension UIs:

| Component      | Use Case                  | Example                      |
| -------------- | ------------------------- | ---------------------------- |
| `Checkbox`     | Boolean toggles           | `on:change={() => action()}` |
| `Slider`       | Numeric values            | `min/max/step` props         |
| `Button`       | Actions                   | `on:click={() => action()}`  |
| `Folder`       | Grouping related controls | `expanded={true}`            |
| `DropDownPane` | Main extension panel      | Container in toolbar         |
| `List`         | Select from options       | `options={[{value, text}]}`  |

## Best Practices

1. **Types first** - Define all types in `types.ts`, export `ExtensionState` and `ExtensionActions`
2. **Single source of truth** - State lives in `.svelte.ts`, UI just displays it
3. **Log important changes** - Use `logSettings` for settings changes
4. **Browser defaults** - Audio starts disabled, use `false` not `true`
5. **localStorage on action** - Save to localStorage inside actions, not `$effect`
6. **No bind: for toggles** - Use `on:change` with explicit actions
7. **Cleanup effects** - If creating/disposing effects (like postprocessing), track `isUpdatingEffects` to prevent render during updates
8. **Avoid reactive loops** - Don't read and write the same state in effects
9. **Use `BASE_URL`** - For asset paths that work in any deployment context

## Resources

- [Threlte Studio Documentation](https://threlte.studio/extensions)
- [svelte-tweakpane-ui](https://github.com/nicegui/svelte-tweakpane)
- [Material Design Icons](https://pictogrammers.com/library/mdi/) (for icons)
