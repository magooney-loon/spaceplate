# Spaceplate Extensions

This folder contains all [@threlte/studio](https://threlte.studio/extensions) extensions for the Spaceplate application.

## Extension Structure

Each extension follows a consistent structure with three files:

```
extensions/
  my-extension/
    MyExtension.svelte    # Main extension component with UI
    useMyExtension.ts     # Public hook/API
```

## Conventions

### 1. File Naming

- **Extension file**: `{Name}Extension.svelte` (PascalCase)
- **Types file**: `types.ts`
- **Hook file**: `use{Name}.ts` (camelCase, following Svelte hook conventions)

### 2. Type Definitions (`types.ts`)

```typescript
export const extensionScope = 'my-extension';

export type ExtensionState = {
	// State properties
	enabled: boolean;
	value: number;
};

export type ExtensionActions = {
	// Actions that mutate state
	setEnabled: (value: boolean) => void;
	setValue: (value: number) => void;
	resetAll: () => void;
};
```

**Rules:**

- Always export `extensionScope` as a unique string (kebab-case)
- Define `ExtensionState` interface/type for all state properties
- Define `ExtensionActions` type for all state-mutating functions
- Actions should follow naming convention: `set{PropertyName}`, `toggle{PropertyName}`, `resetAll`

### 3. Hook File (`useMyExtension.ts`)

```typescript
import { useStudio } from '@threlte/studio/extend';
import { extensionScope, type ExtensionState, type ExtensionActions } from './types';

export const useMyExtension = () => {
	const { useExtension } = useStudio();
	return useExtension<ExtensionState, ExtensionActions, true>(extensionScope);
};
```

**Rules:**

- Export a single hook function named `use{Name}`
- Use `useExtension` from `@threlte/studio/extend`
- Pass the generic types: `<ExtensionState, ExtensionActions, true>`
- The `true` generic makes `state` non-partial (full type instead of `Partial<>`)

### 4. Extension Component (`MyExtension.svelte`)

```typescript
<script lang="ts">
  import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
  import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';
  import { extensionScope } from './types';

  const { createExtension } = useStudio();

  const ext = createExtension<ExtensionState, ExtensionActions>({
    scope: extensionScope,
    state: () => ({
      // Initial state values
      enabled: true,
      value: 1.0,
    }),
    actions: {
      setEnabled({ state }, value: boolean) {
        state.enabled = value;
      },
      setValue({ state }, value: number) {
        state.value = value;
      },
      resetAll({ state }) {
        state.enabled = true;
        state.value = 1.0;
      }
    }
  });

  const state = ext.state;
</script>

<ToolbarItem position="left">
  <DropDownPane icon="mdiIconName" title="Display Name">
    <!-- UI controls here -->
    <Checkbox value={state.enabled} label="Enabled" on:change={(e) => ext.setEnabled(e.detail)} />
  </DropDownPane>
</ToolbarItem>

<slot />
```

**Rules:**

- Always include `<slot />` at the end (required by Threlte Studio)
- Use `createExtension` to register the extension
- State should use sensible defaults (avoid `Infinity` for slider-compatible values)
- Actions receive `{ state }` as first parameter, then the action arguments
- UI bindings use `on:change={(e) => ext.{action}(e.detail)}` or `on:click={() => ext.{action}()}`

### 5. UI Components

We use [`svelte-tweakpane-ui`](https://github.com/nicegui/svelte-tweakpane) for extension UIs:

| Component      | Use Case                  | Example                         |
| -------------- | ------------------------- | ------------------------------- |
| `Checkbox`     | Boolean toggles           | Enable/disable features         |
| `Slider`       | Numeric values            | Adjust intensity, speed, limits |
| `Button`       | Actions                   | Reset, apply, trigger effects   |
| `Folder`       | Grouping related controls | Organize complex settings       |
| `DropDownPane` | Main extension panel      | Container in toolbar            |

**Slider Tips:**

- Always set explicit `min`, `max`, and `step` values
- Avoid `Infinity` - use large finite numbers instead
- For boolean toggles with Slider, use `min={0} max={1} step={1}`

### 6. State Persistence

State is automatically persisted by Threlte Studio. To customize persistence:

```typescript
state({ persist }) {
  return {
    enabled: persist(true),  // This value will be persisted
    value: persist(1.0),
  }
}
```

### 7. Key Mappings (Optional)

Add keyboard shortcuts for actions:

```typescript
keyMap({ shift, ctrl, alt }) {
  return {
    toggleEnabled: shift('e'),
    resetAll: ctrl('r')
  }
}
```

## Existing Extensions

### Camera Controls (`./camera/`)

Controls for the perspective camera and camera controls behavior.

**State includes:**

- Camera properties: `positionX`, `positionY`, `positionZ`, `fov`, `near`, `far`
- Control limits: `minPolarAngle`, `maxPolarAngle`, `minAzimuthAngle`, `maxAzimuthAngle`
- Distance limits: `minDistance`, `maxDistance`, `minZoom`, `maxZoom`
- Speed settings: `smoothTime`, `maxSpeed`, `azimuthRotateSpeed`, `polarRotateSpeed`, `dollySpeed`, `truckSpeed`
- Options: `dollyToCursor`

**Usage:**

```typescript
import { useCameraControls } from '$extensions/camera/useCameraControls';

const ext = useCameraControls();
const position = $derived([ext.state.positionX, ext.state.positionY, ext.state.positionZ]);
```

### Post-Processing (`./postprocessing/`)

Post-processing effects using the `postprocessing` library.

**State includes:**

- Multiple effect states (bloom, SMAA, FXAA, vignette, etc.)
- Each effect has `enabled` flag and effect-specific parameters

**Usage:**

```typescript
import { usePostProcessing } from '$extensions/postprocessing/usePostProcessing';

const { state } = usePostProcessing();
if (state.bloom.enabled) {
	// Apply bloom with state.bloom.intensity, state.bloom.threshold, etc.
}
```

### Sound (`./sound/`)

Audio system with bus-based mixing and positional audio tuning.

**State includes:**

- Master volume/mute
- Per-bus volumes (SFX, Music, Ambient)
- Positional audio settings (refDistance, maxDistance, rolloff, panning model)

**Usage:**

```typescript
import { useSound } from '$extensions/sound/useSound';
import { PositionalAudio } from '@threlte/extras';

const { state } = useSound();
```

```svelte
<PositionalAudio
	src="/sounds/rocket.ogg"
	volume={state.sfxMuted ? 0 : state.sfxVolume}
	refDistance={state.refDistance}
	maxDistance={state.maxDistance}
	rolloffFactor={state.rolloffFactor}
	panningModel={state.panningModel}
/>
```

## Adding a New Extension

1. Create folder: `extensions/my-feature/`
2. Create `types.ts` with scope and type definitions
3. Create `useMyFeature.ts` hook
4. Create `MyFeatureExtension.svelte` with UI
5. Import and add to `App.svelte`:

```typescript
{#await Promise.all([
  import('@threlte/studio'),
  import('./extensions/StageExtension.svelte'),
  import('./extensions/postprocessing/PostProcessingExtension.svelte'),
  import('./extensions/camera/CameraControlsExtension.svelte'),
  import('./extensions/my-feature/MyFeatureExtension.svelte')
]) then [{ Studio }, { default: Stage }, { default: PostProcessing }, { default: CameraControls }, { default: MyFeature }]}
  <Studio extensions={[Stage, PostProcessing, CameraControls, MyFeature]}>
    <!-- app content -->
  </Studio>
{/await}
```

## Best Practices

1. **Keep extensions focused** - Each extension should handle one feature area
2. **Use sensible defaults** - Avoid `Infinity`, use large finite numbers
3. **Group related settings** - Use `Folder` components for organization
4. **Provide reset functionality** - Always include `resetAll` action
5. **Type everything** - Use TypeScript for better DX and safety
6. **No reactive loops** - Don't sync state back and forth in effects
7. **Follow naming conventions** - Consistency makes code easier to maintain

## Resources

- [Threlte Studio Documentation](https://threlte.studio/extensions)
- [svelte-tweakpane-ui](https://github.com/nicegui/svelte-tweakpane)
- [Material Design Icons](https://pictogrammers.com/library/mdi/) (for icons)
