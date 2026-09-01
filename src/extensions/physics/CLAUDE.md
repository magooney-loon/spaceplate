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

- **World:** `gravityX/Y/Z` (0, -9.8, 0), `framerate` (60 or 'varying'), `debug` (true).
- **Spawn defaults:** `spawnRestitution` (0.5), `spawnFriction` (0.5), `spawnLinearDamping` (0.5), `spawnAngularDamping` (0.5), `spawnGravityScale` (1), `spawnCcd` (true), `spawnCanSleep` (true), `spawnRandom` (true).
- **Attractor:** `attractorEnabled` (false), `attractorStrength` (0.5), `attractorRange` (2.5), `attractorGravityType` ('static'), `attractorX/Y/Z`.
- **bodies**: `PhysicsBody[]` — each has `id`, `type` ('ball'|'box'), `position`, `color`, per-body material properties.

## Key behavior

- Spawning auto-switches to `demoScene` via `sceneActions.setScene('demoScene')`.
- Spawn position: `[(random-0.5)*8, 8+random*4, (random-0.5)*8]`. Colors randomly from 6 hardcoded colors.
- `resetWorld()` uses `Object.assign(physicsState, WORLD_DEFAULTS)` — replaces properties, does not deep-merge sub-objects.
- Leaving `demoScene` clears spawned bodies (`Scene.svelte` handles this).
- `PhysicsController.svelte` syncs `physicsState.gravityX/Y/Z` to `world.gravity` via `$effect`.
- No localStorage persistence — physics settings reset on page load.
- Rapier specifics documented in `RAPIER.md`.
