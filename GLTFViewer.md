# GLTF Viewer Extension — Design Doc

## Purpose

A **dev-only** Studio extension for loading, inspecting, and animating GLTF/GLB files at runtime — no copying assets to `public/`, no recompiling. Load a file from disk, tweak its transform, play its animations, iterate fast.

Models always spawn into **DemoScene**. The viewer navigates there automatically on load.

---

## Extension Structure

```
src/extensions/gltf-viewer/
  types.ts                     — extensionScope + all types
  gltfViewer.svelte.ts         — $state + actions (model list, selection, transforms)
  GltfViewerExtension.svelte   — Studio toolbar UI (load, list, transform, animation controls)
  GltfViewerScene.svelte       — 3D component, lives inside DemoScene.svelte (dev-only)
```

---

## State Shape

```typescript
type GltfViewerModel = {
  id: string;                    // nanoid
  name: string;                  // filename without extension
  url: string;                   // blob: URL from FileReader (session-only) or public path
  blobUrl: boolean;              // true = revoke on remove
  position: [number, number, number];
  rotation: [number, number, number]; // euler degrees
  scale: number;                 // uniform
  activeAnimation: string | null;
  animationSpeed: number;        // default 1
  loop: boolean;
  playing: boolean;
  visible: boolean;
};

type GltfViewerState = {
  models: GltfViewerModel[];
  selectedId: string | null;
};
```

---

## Actions

```typescript
loadFromFile(file: File): void        // FileReader → blob URL → push to models, navigate to DemoScene
loadFromPath(path: string): void      // public path → push to models, navigate to DemoScene
removeModel(id: string): void         // revoke blob URL if needed, splice from list
clearAll(): void                      // revoke all blob URLs, empty list
selectModel(id: string): void
setPosition(id, x, y, z): void
setRotation(id, x, y, z): void
setScale(id, v): void
setAnimation(id, clipName | null): void
setPlaying(id, playing): void
setSpeed(id, speed): void
setLoop(id, loop): void
setVisible(id, visible): void
```

---

## File Loading Strategy

Use `<input type="file" accept=".gltf,.glb">` (hidden, triggered by a button).
Read via `URL.createObjectURL(file)` — instant, no upload, works with Threlte's `useGltf` / `<GLTF>`.
Mark as `blobUrl: true` so `URL.revokeObjectURL` is called on remove/clear.

For public assets: plain string input (e.g. `/models/mychar.glb`).

---

## 3D Scene Component (`GltfViewerScene.svelte`)

Lives inside `DemoScene.svelte`, wrapped in `{#if import.meta.env.DEV}`.

For each model in `gltfViewerState.models`:
- Render `<GLTF url={model.url} bind:gltf={$gltfStore} ... />` with transform props
- Use `useGltfAnimations(gltfStore)` per model instance
- `$effect` drives `actions[model.activeAnimation]?.play()` / `.stop()` / `.setEffectiveTimeScale()`
- Each model is its own Svelte component (`GltfViewerInstance.svelte`) to isolate animation mixer lifecycle

```
GltfViewerScene.svelte
  └─ {#each gltfViewerState.models as model}
       └─ GltfViewerInstance.svelte   ← isolated GLTF + animation mixer per model
```

---

## Studio UI (`GltfViewerExtension.svelte`)

```
ToolbarItem → DropDownPane (icon: mdiCubeOutline, title: "GLTF Viewer")
  ┌─ [Load from File]        ← triggers hidden <input type="file">
  ├─ [Load from Path]        ← prompt() for a public path string
  ├─ Separator
  ├─ {#each models}
  │    Folder "{model.name}" expanded={selectedId === model.id}
  │      [✓ Select / → Select]
  │      [👁 Show / Hide]
  │      Folder "Transform"
  │        Slider X / Y / Z   (position)
  │        Slider RX / RY / RZ (rotation, degrees)
  │        Slider Scale        (0.01 → 10)
  │        [Reset Transform]
  │      Folder "Animations"   (only if model has clips)
  │        List  — clip name selector (+ "— None —")
  │        [▶ Play / ⏸ Pause]
  │        [⏹ Stop]
  │        Slider Speed (0.1 → 3)
  │        Checkbox Loop
  │      [✕ Remove]
  ├─ Separator
  └─ [Clear All]
```

Auto-navigates to DemoScene on first model load (calls `sceneActions.setScene('demoScene')`).
Shows a warning banner if not in DemoScene: "⚠️ Switch to Demo Scene to see models."

---

## Animation Wiring (per `GltfViewerInstance.svelte`)

```svelte
<script lang="ts">
  const gltf = useGltf(model.url)
  const { actions, mixer } = useGltfAnimations(gltf)

  $effect(() => {
    // stop all, play active
    Object.values($actions ?? {}).forEach(a => a?.stop())
    if (model.activeAnimation && $actions?.[model.activeAnimation]) {
      const action = $actions[model.activeAnimation]
      action.setLoop(model.loop ? LoopRepeat : LoopOnce, Infinity)
      action.setEffectiveTimeScale(model.animationSpeed)
      if (model.playing) action.play()
    }
  })

  $effect(() => {
    if (mixer) mixer.timeScale = model.animationSpeed
  })
</script>
```

Available clip names are surfaced back to state via `onload` so the UI can populate the animation list.

---

## Key Constraints

| Constraint | Decision |
|---|---|
| Dev-only | `GltfViewerScene` wrapped in `{#if import.meta.env.DEV}` in DemoScene |
| Always DemoScene | `loadFromFile/Path` call `sceneActions.setScene('demoScene')` |
| Blob URL cleanup | `URL.revokeObjectURL` in `removeModel` and `clearAll` |
| No persistence | Models are session-only; blob URLs can't survive page reload |
| Isolated mixers | One `GltfViewerInstance.svelte` per model — each owns its `useGltfAnimations` |
| Animation list | Populated from `gltf.animations` on load, written back into state |

---

## Integration Points

- `DemoScene.svelte` — add `<GltfViewerScene />` inside `{#if import.meta.env.DEV}`
- `App.svelte` — register `GltfViewerExtension` in the Studio `extensions` array (inside the `{#await import('@threlte/studio')}` block)

---

## Out of Scope (for now)

- DRACO / KTX2 / Meshopt compression support (can add later via useDraco etc.)
- Saving model configs to localStorage (blob URLs are session-only anyway)
- Spawning into scenes other than DemoScene
- Per-mesh material overrides
- Skeleton / bone visualization
