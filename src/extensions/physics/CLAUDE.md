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

- **World:** `gravityX/Y/Z` (0, -9.8, 0), `framerate` (**60**, i.e. fixed — the panel
  also offers 'varying', 120 and 200), `debug` (false).
- **Spawn defaults:** `spawnRestitution` (0.5), `spawnFriction` (0.5), `spawnLinearDamping` (0.5), `spawnAngularDamping` (0.5), `spawnGravityScale` (1), `spawnCcd` (true), `spawnCanSleep` (true), `spawnRandom` (true).
- **Attractor:** `attractorEnabled` (false), `attractorStrength` (0.5), `attractorRange` (2.5), `attractorGravityType` ('static'), `attractorX/Y/Z`.
- **bodies**: `PhysicsBody[]` — each has `id`, `type` ('ball'|'box'), `position`, `color`, per-body material properties. **Capped at `MAX_BODIES` (500)**; at the cap a spawn evicts the oldest.

## Key behavior

- **`framerate` is a FIXED number, so a `usePhysicsTask` may run 0..n times per rendered
  frame.** Anything a task integrates must be expressed PER SECOND and scaled by `delta` —
  a "fraction kept per step" constant silently changes the feel of the game the moment this
  number moves (write damping as `exp(-rate * delta)`, never as a kept-fraction).
- **Fixed vs `'varying'` is the determinism axis; 60 vs 120 vs 200 is the cost axis.**
  Any number here steps the world at exactly `1 / n` seconds whatever the monitor does,
  so the run repeats; `'varying'` puts rAF's jittery delta into `world.timestep` and no
  two runs match. Do not read "200" as "the deterministic one" — it never was.
- **The default is 60 because `ceil(accumulator / rate)` is the substep count.** At 200 Hz
  against 60 fps that is 4/3/3/4/3/3…; at 60 Hz it is one step per frame. Every physics
  task in the app runs that many times, and Rapier steps its trimesh sets that many times.
- **A physics task must never integrate a VISUAL quantity**, at any rate. The substep
  count per frame is never constant (`ceil` guarantees it), so a per-step-integrated
  visual pulses against a chassis that Threlte is smoothly interpolating. It bites harder
  at 60 Hz, not less: on a 144 Hz display the count is 0 or 1, i.e. a frame where the
  visual does not advance at all. `scenes/TestGame/fx/CarWheels.svelte` is the worked
  example and `DOCS/testperf.md` §1.4 is the write-up.
- Spawning auto-switches to `demoScene` via `sceneActions.setScene('demoScene')`.
- `spawnBall()` / `spawnBox()` are both one internal `spawn(type)` — the shapes differ only by `type` and their collider.
- **`MAX_BODIES` is a Rapier budget, not a render one.** The renderer draws every spawned body in **two instanced draw calls** (`scenes/DemoScene/SpawnedBodies.svelte`), so what the cap actually bounds is the simulation, the collider pairs and 500 `<RigidBody>` components' effects.
- Spawn position: `[(random-0.5)*8, 8+random*4, (random-0.5)*8]`. Colors randomly from 6 hardcoded colors, and the colour reaches the GPU as a per-instance attribute, never as a per-body material.
- `resetWorld()` uses `Object.assign(physicsState, WORLD_DEFAULTS)` — replaces properties, does not deep-merge sub-objects.
- **Spawned bodies unmount with the scene.** Descriptors stay in `physicsState.bodies` across scene switches (nothing calls `clearBodies()` on a switch), but their `<RigidBody>` components live inside DemoScene — leaving the scene removes the bodies from the world, and re-entering re-creates them at their original spawn positions. Clearing is explicit (`Clear All` in the panel).
- `PhysicsController.svelte` syncs `physicsState.gravityX/Y/Z` to `world.gravity` via `$effect`.
- No localStorage persistence — physics settings reset on page load.
- Rapier specifics documented in `DOCS/RAPIER.md`.
