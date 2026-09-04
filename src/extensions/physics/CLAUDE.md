# Rapier Physics (`physics/`)

## Files

```
types.ts                  — GravityType, PhysicsFramerate, PhysicsBody, PhysicsState, PhysicsActions
physics.svelte.ts         — $state, physicsActions, WORLD_DEFAULTS, SPAWN_DEFAULTS
PhysicsExtension.svelte   — Studio toolbar panel
PhysicsController.svelte  — Mounted inside <World>, syncs gravity via $effect
PhysicsWorldLogger.svelte — Logs Rapier world mount/destroy with snapshot stats
index.ts                  — barrel re-exports
```

## State shape

- **World:** `gravityX/Y/Z` (0, -9.8, 0), `framerate` (**200**, i.e. fixed/deterministic —
  the panel also offers 'varying', 60 and 120), `debug` (false).
- **Spawn defaults:** `spawnRestitution` (0.5), `spawnFriction` (0.5), `spawnLinearDamping` (0.5), `spawnAngularDamping` (0.5), `spawnGravityScale` (1), `spawnCcd` (true), `spawnCanSleep` (true), `spawnRandom` (true).
- **Attractor:** `attractorEnabled` (false), `attractorStrength` (0.5), `attractorRange` (2.5), `attractorGravityType` ('static'), `attractorX/Y/Z`.
- **bodies**: `PhysicsBody[]` — each has `id`, `type` ('ball'|'box'), `position`, `color`, per-body material properties. **Capped at `MAX_BODIES` (500)**; at the cap a spawn evicts the oldest.

## Key behavior

- **`framerate` is a fixed 200 Hz, so a `usePhysicsTask` may run 0..n times per rendered
  frame.** Anything a task integrates must be expressed PER SECOND and scaled by `delta` —
  a "fraction kept per step" constant silently changes the feel of the game the moment this
  number moves (it is how TestGame's drift and handbrake are written: `exp(-rate * delta)`).
- Spawning auto-switches to `demoScene` via `sceneActions.setScene('demoScene')`.
- `spawnBall()` / `spawnBox()` are both one internal `spawn(type)` — the shapes differ only by `type` and their collider.
- **`MAX_BODIES` is a Rapier budget, not a render one.** The renderer draws every spawned body in **two instanced draw calls** (`scenes/DemoScene/SpawnedBodies.svelte`), so what the cap actually bounds is the simulation, the collider pairs and 500 `<RigidBody>` components' effects.
- Spawn position: `[(random-0.5)*8, 8+random*4, (random-0.5)*8]`. Colors randomly from 6 hardcoded colors, and the colour reaches the GPU as a per-instance attribute, never as a per-body material.
- `resetWorld()` uses `Object.assign(physicsState, WORLD_DEFAULTS)` — replaces properties, does not deep-merge sub-objects.
- **Spawned bodies survive scene switches.** Scenes are keep-alive, and nothing calls `clearBodies()` on a switch — the bodies stay in the array and their components stay mounted; `DemoPhysicsBodies` and `SpawnedBodies` gate their per-frame work on `sceneState.currentScene` instead, and physics itself is paused by `Scene.svelte`. Clearing is explicit (`Clear All` in the panel).
- `PhysicsController.svelte` syncs `physicsState.gravityX/Y/Z` to `world.gravity` via `$effect`.
- No localStorage persistence — physics settings reset on page load.
- Rapier specifics documented in `DOCS/RAPIER.md`.
