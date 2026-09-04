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
TestGame/  TestGame.svelte, TestGameHud.svelte, ChaseCamera.svelte, CarWheels.svelte,
           CarHeadlights.svelte, carInput.svelte.ts (driving prototype: city trimesh +
           GR86 on one arcade chassis body)
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

## TestGame specifics

- **`ChaseCamera.svelte` BORROWS the app camera** (`core/Camera.svelte` — the one holding
  the AudioListener) via `<CameraControls>` + `useFollow` from `@threlte/extras`, rather
  than mounting a second `makeDefault` camera. One camera keeps the listener, the sky's
  framing and the post-processing pipeline pointed at what is on screen (`Renderer.svelte`
  rebuilds the whole pipeline on a camera swap). Two rules come with borrowing:
  - **Save the pose on entry, restore it on exit.** `Camera.svelte` sets its vantage once,
    in `oncreate`, and never re-asserts it — leave the camera at the car and every other
    scene inherits that framing.
  - **Gate on the scene AND on Studio's editor camera.** `useFollow`'s task `invalidate()`s
    whenever it does work, so ungated it pins the on-demand render loop at full rate from
    every scene; and `CameraControls.update()` writes position + `lookAt` unconditionally,
    so it must stand down when `camera.current` is Studio's editor camera
    (`userData.editorCamera`) — the collision `extensions/flypath/FlyPath.svelte` documents.
- **Physics runs at a fixed 200 Hz** (`physicsState.framerate`), so a `usePhysicsTask` runs
  0..n times per rendered frame. Every damping constant in the driving model is therefore a
  RATE in 1/s applied as `exp(-rate * delta)`, never a "fraction kept per step" — the latter
  silently retunes the car whenever the physics framerate moves.
- **`CarWheels.svelte` deforms vertices in `positionNode`**, so it also writes
  `positionPrevious` — a vertex-deforming material owns both ends of the velocity buffer or
  motion blur smears it against its own rest pose. Applies to any future deforming material.

## Adding a scene

1. Add the id to `SceneType` + an entry to `SCENES` in `$extensions/scene` (+
   init `visited` in `sceneState`).
2. Create the directory with the scene component + HUD component.
3. Mount it in `Scene.svelte` with a `visited`-latched `{#if}` + `visible={current}`
   group — copy an existing block. The boot warmup sweep picks it up automatically.
