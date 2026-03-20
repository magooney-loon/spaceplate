# Preset System — Analysis & Proposal

## Current State

### What Exists

Both **postprocessing** and **skybox** have a two-tier preset system:

| Layer | Postprocessing | Skybox |
|-------|----------------|--------|
| Data | `bundledPresets.ts` (committed) + localStorage | `bundledPresets.ts` (committed) + localStorage |
| Global assignment | `spaceplate-pp-global-preset` (localStorage) | `spaceplate-skybox-global-preset` (localStorage) |
| Per-scene assignment | `spaceplate-pp-scene-presets` (localStorage) | `spaceplate-skybox-scene-presets` (localStorage) |
| Applied in | `Renderer.svelte` via `$derived` | `Skybox.svelte` via `$effect` |
| Studio UI | Load/Save/Delete only | Load/Save/Delete only |

### How Presets Apply (Production)

Both systems use Svelte reactivity — no Studio dependency — so they work in production:

```
sceneState.currentScene changes
    ↓
Renderer.svelte $derived re-runs
    → looks up scenePresets[currentScene] from postprocessingPresetsState
    → merges with globalPresetId if both set (scene wins on conflict)
    → rebuilds effect composer with the resolved settings

Skybox.svelte $effect re-runs
    → picks scenePresets[currentScene] ?? globalPresetId
    → calls skyboxActions.loadUserPreset(presetId)
    → applies sky + stars state snapshot
```

### The Core Problem

**Scene-preset assignments are localStorage-only.** This means:

1. Developer configures assignments in Studio → saved to their machine's localStorage only
2. End user opens game fresh → no localStorage → no assignments → default plain state
3. There is no way to ship scene-preset assignments with the code today

Bundled presets (`bundledPresets.ts`) solve the "preset data" problem — the presets exist on every device. But the **assignments** (which preset goes to which scene) are still per-device.

**Additionally:** There is no Studio Editor UI for assigning presets to scenes. The only way to set assignments today is via the browser console:
```js
postprocessingActions.setScenePreset('mainMenu', 'some-preset-id');
skyboxActions.setScenePreset('demoScene', 'some-preset-id');
```

---

## Proposed System

### Option A — Scene Config Assignments (Recommended)

Extend `SceneConfig` in `extensions/scene/types.ts` to declare preset IDs directly:

```typescript
export type SceneConfig = {
  id: SceneType;
  label: string;
  icon: string;
  postprocessingPresetId?: string;  // Bundled or user preset ID
  skyboxPresetId?: string;
};
```

```typescript
// scene.svelte.ts
export const SCENES: SceneConfig[] = [
  {
    id: 'mainMenu',
    label: 'Main Menu',
    icon: 'mdiHome',
    skyboxPresetId: 'night-aurora',
    postprocessingPresetId: 'cinematic-bloom',
  },
  {
    id: 'demoScene',
    label: 'Demo Scene',
    icon: 'mdiEarth',
    skyboxPresetId: 'golden-hour',
    postprocessingPresetId: 'raw',
  },
];
```

`Renderer.svelte` and `Skybox.svelte` resolve the preset using:

```
Priority: localStorage scene override → SCENES config → localStorage global → raw state
```

This way:
- Preset assignments ship with the code (committed to git)
- Studio editor can **still override** per-device via localStorage (for dev iteration)
- Clearing localStorage reverts to the shipped defaults
- New team members / end users always get the right presets

**Pros:** Single source of truth, versioned with code, zero friction for new scenes
**Cons:** Requires a code change to update scene assignments (not pure editor workflow)

---

### Option B — Bundled Assignment Map

Keep `SceneConfig` unchanged. Instead, add an exported assignments map to each `bundledPresets.ts`:

```typescript
// extensions/postprocessing/bundledPresets.ts
export const BUNDLED_PP_PRESETS: PostProcessingPreset[] = [...];

export const BUNDLED_PP_SCENE_ASSIGNMENTS: Record<string, string> = {
  mainMenu: 'cinematic-bloom-id',
  demoScene: 'raw-id',
};

export const BUNDLED_PP_GLOBAL_ASSIGNMENT: string | null = null;
```

At startup, `postprocessing.svelte.ts` initialises `scenePresets` by merging bundled assignments with localStorage (localStorage wins):

```typescript
const loadScenePresets = (): Record<string, string | null> => {
  const bundled = Object.fromEntries(
    Object.entries(BUNDLED_PP_SCENE_ASSIGNMENTS)
  );
  const stored = JSON.parse(localStorage.getItem(SCENE_PRESETS_KEY) ?? '{}');
  return { ...bundled, ...stored };  // stored overrides bundled
};
```

**Pros:** No changes to SceneConfig or scene machinery; bundled presets file is the only place to edit
**Cons:** Indirection — preset assignments live in postprocessing/skybox files, not in the scene definition

---

### Option C — Studio-Only Assignment (Current Direction, Improved)

Keep assignments in localStorage. Add **Editor UI** to the PostProcessing and Skybox Studio extensions so the developer can visually assign presets to scenes during development. Then add an **"Export to Code"** button that prints the `SCENES` config or `bundledPresets.ts` snippet to the console, which the developer pastes into code.

**Pros:** Pure editor workflow — no manual code edits needed
**Cons:** Still requires a manual copy-paste step before shipping; assignments aren't automatically in git

---

## Recommended: Option A + Editor UI

The best developer experience combines both:

1. **`SCENES` array holds the shipped preset assignments** — code-first, git-versioned
2. **Studio UI allows visual assignment** — developer picks preset per scene in the panel
3. **Studio "bake to code"** — button logs the SCENES config snippet to the console so developer can paste it back in
4. **localStorage overrides during iteration** — developer can tweak per-device without changing code; clearing localStorage reverts to committed state

### Priority Resolution (Proposed)

```
For postprocessing:
1. localStorage scenePresets[scene]   ← dev override (Studio)
2. SCENES[scene].postprocessingPresetId ← shipped default (code)
3. localStorage globalPresetId         ← dev global override
4. postprocessingState (manual)        ← raw / no preset

For skybox:
1. localStorage scenePresets[scene]   ← dev override (Studio)
2. SCENES[scene].skyboxPresetId        ← shipped default (code)
3. localStorage globalPresetId         ← dev global override
4. raw skyboxState                     ← no preset
```

---

## Editor UI Plan

### PostProcessingExtension.svelte — Scene Assignments Folder

```
┌─ Scene Assignments ──────────────────────┐
│  Main Menu     [Cinematic Bloom ▾] [✕]   │
│  Demo Scene    [Raw              ▾] [✕]  │
│  ──────────────────────────────────────  │
│  Global        [None             ▾] [✕]  │
│  ──────────────────────────────────────  │
│  [Log to Console]                        │
└──────────────────────────────────────────┘
```

- Dropdown per scene listing all loaded presets + "None"
- Selecting a preset calls `setScenePreset(sceneId, presetId)` → persists to localStorage
- ✕ clears the assignment
- "Log to Console" button prints the SCENES snippet with current assignment IDs

### SkyboxExtension.svelte — identical panel for skybox

---

## Changes Required

### Option A (Recommended)

| File | Change |
|------|--------|
| `extensions/scene/types.ts` | Add `postprocessingPresetId?` and `skyboxPresetId?` to `SceneConfig` |
| `extensions/scene/scene.svelte.ts` | Add preset IDs to each entry in `SCENES` |
| `core/Renderer.svelte` | Read `SCENES` config as fallback before global preset |
| `core/Skybox.svelte` | Read `SCENES` config as fallback before global preset |
| `extensions/postprocessing/PostProcessingExtension.svelte` | Add Scene Assignments folder |
| `extensions/skybox/SkyboxExtension.svelte` | Add Scene Assignments folder |
| `extensions/postprocessing/bundledPresets.ts` | Populate with actual bundled presets |
| `extensions/skybox/bundledPresets.ts` | Populate with actual bundled presets |

### Option A Priority Logic (Renderer.svelte)

```typescript
const s = $derived.by((): typeof postprocessingState => {
  const { globalPresetId, scenePresets, presets } = postprocessingPresetsState;

  // 1. localStorage scene override
  const lsSceneId = scenePresets[sceneState.currentScene] ?? null;
  // 2. SCENES config fallback
  const sceneConfig = SCENES.find(s => s.id === sceneState.currentScene);
  const codeSceneId = sceneConfig?.postprocessingPresetId ?? null;

  const scenePresetId = lsSceneId ?? codeSceneId;

  // ... rest of existing merge logic unchanged
});
```

---

## What's Already Working (Keep As-Is)

- Bundled preset data shipping via `bundledPresets.ts` ✓
- Merge strategy (scene wins over global, conflict warning) ✓
- Preset CRUD (save, load, delete, rename, update) ✓
- Production reactivity (no Studio dependency) ✓
- Delete cleanup (removes orphan scene/global assignments) ✓
