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
- **sceneState**: `{ currentScene, previousScene, isTransitioning }`.
- **sceneActions**: `setScene`, `goToMainMenu`, `goToDemoScene`, `goBack`, `transitionTo`.

## Key behavior

- `setScene()` plays the swoosh sound, logs the transition, stores `previousScene`.
- `transitionTo(scene, ms)` splits the wait in half around `setScene` for a two-phase animation.
- The old preset-assignment layer (bundledPresets.ts, resolvers, localStorage maps, four actions) was deleted — it resolved to `null` for every input and held zero presets, and its `$effect` caused an infinite loop.

## Adding a scene

1. Add id to `SceneType` in `types.ts`.
2. Add entry to `SCENES` array in `scene.svelte.ts`.
3. Add scene component in `src/scenes/` and mount it in `Scene.svelte` with a conditional.
