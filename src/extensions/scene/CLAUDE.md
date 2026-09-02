# Scene State Machine (`scene/`)

## Files

```
types.ts            — SceneType union, SceneConfig, SceneState, ExtensionState/Actions
scene.svelte.ts     — $state, sceneActions, SCENES config
SceneExtension.svelte — Studio toolbar panel (scene switcher)
index.ts            — barrel re-exports
```

## Concepts

- **SceneType**: `'mainMenu' | 'demoScene'`. Add new scenes here and in `SCENES`.
- **SCENES**: `SceneConfig[]` — each entry has `id`, `label`, `icon`. Per-scene `environment` block (post-processing overrides, time/weather) is planned but not implemented — see `DOCS/scene-environment.md`.
- **sceneState**: `{ currentScene, previousScene, isTransitioning, visited }`.
- **sceneActions**: `setScene`, `goToMainMenu`, `goToDemoScene`, `goBack`, `transitionTo`, `warmupScenes`.

## Key behavior

- `setScene()` plays the swoosh sound, logs the transition, stores `previousScene`, latches `visited[scene]`.
- **Keep-alive mounting** (Scene.svelte): a scene component mounts the first time it becomes current (`visited`) and stays mounted forever; switching toggles the group's `visible`. Never route scenes with a bare `{#if}` on currentScene — unmounting disposes materials (evicting compiled pipelines) and tears down Rapier bodies. Caveats: hidden meshes still raycast if they register pointer handlers, and hidden Rapier bodies keep simulating (see `useRapier().pause()` if that must stop).
- `warmupScenes()` — boot-only sweep called by Loader.svelte once assets settle: visits every scene (direct currentScene writes — no swoosh/log), waits for mount, bumps `bootState.warmVersion` for a warm frame through the real pipeline, holds `WARM_GRACE_MS` per scene for background compilation, restores the original scene, latches `scenesWarmed`. Idempotent.
- `transitionTo(scene, ms)` splits the wait in half around `setScene` for a two-phase animation.
- The old preset-assignment layer (bundledPresets.ts, resolvers, localStorage maps, four actions) was deleted — it resolved to `null` for every input and held zero presets, and its `$effect` caused an infinite loop.

## Adding a scene

1. Add id to `SceneType` in `types.ts`.
2. Add entry to `SCENES` array in `scene.svelte.ts` (+ init `visited` in `sceneState`).
3. Add scene component in `src/scenes/` and mount it in `Scene.svelte` with a `visited`-latched `{#if}` + `visible={current}` group — copy an existing block. The warmup sweep picks it up automatically.
