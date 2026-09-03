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
- Each model: `id`, `name`, `url`, `isBlobUrl`, `animationClips` (populated after load), `activeAnimations`, `playState` ('playing'|'paused'|'stopped'), `animationSpeed` (1), `crossfadeDuration` (0.3), `loop` (true), `visible` (true), `showRig` (false), `castShadows` (false), `autoRotate` (false), `autoRotateSpeed` (0.5 rad/s), `colliderEnabled` (false), `colliderShape` ('trimesh').

## Key behavior

- `loadFromFile(file)` creates a Blob URL, pushes model, switches to demoScene.
- `loadFromPath(path)` for known models in `public/`.
- `removeModel(id)` revokes Blob URL if applicable.
- `GltfViewerInstance` uses `useGltf` + `useGltfAnimations` (each instance has its own mixer).
- Clip names are deduped in `setModelClips` (first-seen order, warn on drop): GLTFs can carry duplicate clip names (Blender NLA exports do it readily), which would crash the panel's name-keyed `each` with `each_key_duplicate` — and the actions map is name-keyed anyway, so duplicates were never addressable.
- Compression support: every load passes `dracoLoader` + `meshoptDecoder` + `ktx2Loader` to `useGltf`. DRACO/KTX2 decoders are fetched on demand from jsdelivr pinned to the installed three version (`three@0.<REVISION>/examples/jsm/libs/…`) — needs network on first compressed load; Meshopt is bundled in three. Uncompressed models never fetch anything.
- Animation crossfade: enabling a clip → `fadeIn(crossfadeDuration)`, disabling → `fadeOut(...)`. `0` = hard cuts.
- `AutoColliders` from `@threlte/rapier` when `colliderEnabled` is true.
- `Show Rig`: mounts a `SkeletonHelper` (from `three/webgpu`) on the loaded scene root while enabled — gated on `model.visible` (a detached mesh stops updating bone world matrices, the helper would freeze); skipped when the model has no bones. Marked `selectable: false, hideInTree: true` for Studio.
- `Cast Shadows`: traverses the loaded scene and sets `castShadow` on every mesh (DemoScene floor already receives shadows).
- `Auto Rotate`: spins the wrapper `T.Group` (not the GLTF scene root — that would fight the mixer's own transforms) from a `useTask`. **This is the only task in the app that calls `invalidate()` unconditionally every frame**, which is unavoidable (the group really did move) but pins Threlte's `'on-demand'` renderMode at full rate for as long as it runs — in DemoScene that means the mirror floor's reflector re-renders the scene every frame and the cube captures in `DemoPhysicsBodies` start firing at their full 30/15 Hz. Expect the FPS readout to drop to the scene's real cost while it's on; switch Settings ▸ General to `low` to cut the reflection scale and disable the ball capture. It is guarded on `sceneState.currentScene === 'demoScene'` because `Scene.svelte` is keep-alive (a scene switch only toggles group `visible`, it never unmounts) — without the guard the rotation would keep forcing full-rate frames of whatever scene is actually on screen. Any future per-frame task added here needs the same guard.
- Animation diffing: `prevActive` Set tracks which clips were active on the previous effect run to compute fade in/out correctly.
- `toggleAnimation` sets `playState` to `'playing'` if no animations were active before.
- `untrack()` used for URL in GltfViewerInstance (intentionally fixed per instance, keyed by `model.id` in parent `{#each}`).
