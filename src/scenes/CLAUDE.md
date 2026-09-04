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
           SpawnedBodies.svelte, mirrorFloor.ts, demoQuality.ts
TestGame/  standalone tech demo game (driving prototype) — self-contained, has its own
           CLAUDE.md; nothing there is engine architecture, don't generalise it into
           core/ or extensions/
```

## DemoScene specifics

- **`mirrorFloor.ts`** — shared floor handle; the cube captures swap the reflector
  material out while they render. Read it before touching either file.
- **`demoQuality.ts`** — the low/high preset table for this scene (reflection
  resolution, cube capture size + rate, geometry segments, spawn shadows).
- **`SpawnedBodies.svelte`** — the spawned physics bodies: N Rapier bodies, **two
  instanced draw calls**. Read its header before adding anything else that spawns
  repeatedly. Two things generalise beyond this scene:
  - **Count draw calls per FRAME, not per object.** This scene renders itself up to
    five times a frame (main, shadow, mirror-floor reflector, and two cube captures at
    30/15 Hz), so one mesh per body cost ~7.5 draw calls per frame per body — the
    100-call budget was gone at fourteen balls.
  - **`<InstancedMesh>` from `@threlte/extras` would break on-demand rendering.** Its
    Api task calls `invalidate()` unconditionally whenever it syncs (`update` defaults
    to `true`), and scenes here are keep-alive — one mounted anywhere pins the render
    loop at full rate forever, in every scene. Drive `InstancedMesh` from a task that
    invalidates only when a matrix actually changed.

## Adding a scene

1. Add the id to `SceneType` + an entry to `SCENES` in `$extensions/scene` (+
   init `visited` in `sceneState`).
2. Create the directory with the scene component + HUD component.
3. Mount it in `Scene.svelte` with a `visited`-latched `{#if}` + `visible={current}`
   group — copy an existing block. The boot warmup sweep picks it up automatically.
