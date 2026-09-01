# GLTF Model Viewer (`gltf-viewer/`)

## Files

```
types.ts                  — GltfViewerColliderShape, GltfViewerModel, GltfViewerState
gltfViewer.svelte.ts      — $state, gltfViewerActions
GltfViewerExtension.svelte — Studio toolbar panel (load controls, per-model panels)
GltfViewerScene.svelte    — Drops inside DemoScene, renders model instances
GltfViewerInstance.svelte — Per-model renderer (useGltf, animations, colliders)
index.ts                  — barrel re-exports
```

Dev-only (`VITE_GAME_ENGINE=true`).

## State shape

- `models: GltfViewerModel[]`, `selectedId: string | null`.
- Each model: `id`, `name`, `url`, `isBlobUrl`, `animationClips` (populated after load), `activeAnimations`, `playState` ('playing'|'paused'|'stopped'), `animationSpeed` (1), `crossfadeDuration` (0.3), `loop` (true), `visible` (true), `colliderEnabled` (false), `colliderShape` ('trimesh').

## Key behavior

- `loadFromFile(file)` creates a Blob URL, pushes model, switches to demoScene.
- `loadFromPath(path)` for known models in `public/`.
- `removeModel(id)` revokes Blob URL if applicable.
- `GltfViewerInstance` uses `useGltf` + `useGltfAnimations` (each instance has its own mixer).
- Animation crossfade: enabling a clip → `fadeIn(crossfadeDuration)`, disabling → `fadeOut(...)`. `0` = hard cuts.
- `AutoColliders` from `@threlte/rapier` when `colliderEnabled` is true.
- Animation diffing: `prevActive` Set tracks which clips were active on the previous effect run to compute fade in/out correctly.
- `toggleAnimation` sets `playState` to `'playing'` if no animations were active before.
- `untrack()` used for URL in GltfViewerInstance (intentionally fixed per instance, keyed by `model.id` in parent `{#each}`).
