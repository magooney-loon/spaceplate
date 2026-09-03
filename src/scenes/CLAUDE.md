# Scenes (`src/scenes/`)

One directory per scene, each pairing a 3D component (mounted inside `<Canvas>` via
`Scene.svelte`) with its HUD component (HTML overlay via `SceneHud.svelte`). The scene
state machine — `SCENES` config, `setScene`/`transitionTo`, keep-alive mounting — lives
in `$extensions/scene` (see its `CLAUDE.md`, including the planned per-scene
`environment` block for time/weather/post-processing overrides).

```
MainMenu/  MainMenu.svelte, MainMenuHud.svelte, SettingsHud.svelte (tabs: General, Audio,
           Controls, System — System reads capabilityState + telemetryState)
DemoScene/ DemoScene.svelte, DemoSceneHud.svelte, DemoPhysicsBodies.svelte,
           mirrorFloor.ts, demoQuality.ts
```

## DemoScene specifics

- **`mirrorFloor.ts`** — shared floor handle; the cube captures swap the reflector
  material out while they render. Read it before touching either file.
- **`demoQuality.ts`** — the low/high preset table for this scene (reflection
  resolution, cube capture size + rate, geometry segments, spawn shadows).

## Adding a scene

1. Add the id to `SceneType` + an entry to `SCENES` in `$extensions/scene` (+
   init `visited` in `sceneState`).
2. Create the directory with the scene component + HUD component.
3. Mount it in `Scene.svelte` with a `visited`-latched `{#if}` + `visible={current}`
   group — copy an existing block. The boot warmup sweep picks it up automatically.
