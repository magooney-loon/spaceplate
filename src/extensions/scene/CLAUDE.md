# Scene State Machine (`scene/`)

## Files

```
types.ts            — SceneType union, SceneConfig, SceneState, ExtensionState/Actions
scene.svelte.ts     — $state, sceneActions, SCENES config
SceneExtension.svelte — Studio toolbar panel (scene switcher)
index.ts            — barrel re-exports
```

## Concepts

- **SceneType**: `'mainMenu' | 'demoScene' | 'testGame'`. Add new scenes here and in `SCENES`.
- **SCENES**: `SceneConfig[]` — each entry has `id`, `label`, `icon`. Per-scene `environment` block is planned but not implemented — see below.
- **sceneState**: `{ currentScene, previousScene, isTransitioning }`.
- **sceneActions**: `setScene`, `goToMainMenu`, `goToDemoScene`, `goToTestGame`, `goBack`, `transitionTo`.

## Key behavior

- `setScene()` plays the swoosh sound, logs the transition, stores `previousScene`. Instant swap — boot, the Studio panel and other programmatic callers.
- **Scene routing** (Scene.svelte): a plain `{#if}` on `currentScene` — exactly one scene is mounted at a time. Switching unmounts the outgoing scene (its components' teardown disposes their THREE resources and removes its Rapier bodies from the world), so a return trip re-pays mount and shader compilation.
- **`transitionTo(scene)` — the per-scene warm swap ("bootloader")**: the `goTo*`/`goBack` actions (every HUD button) route through it. Cover → `setScene` under a full-screen veil (Loader.svelte, driven by `isTransitioning`) → two rAFs for the mount to flush and the new scene's **first rendered frame** — that frame goes through the real pipeline and kicks three's async shader compilation for the new scene's variants (the ones `renderer.compileAsync` cannot produce; see the shader-cache trap in `$core/postprocessing/CLAUDE.md`) → a fixed grace budget (`WARM_GRACE_MS`) → veil lifts. No warm frame is forced by hand — mount invalidations already draw it; this module lives outside the Canvas and has no Threlte context. Guards: same-scene and already-transitioning are no-ops. The boot scene needs none of this: it mounts at t=0 behind the Loader and compiles while assets stream.
- The old preset-assignment layer (bundledPresets.ts, resolvers, localStorage maps, four actions) was deleted — it resolved to `null` for every input and held zero presets, and its `$effect` caused an infinite loop.

## Planned: per-scene `environment` block

How a scene declares what it looks like: which post-processing is active, what time it
is, what the weather is doing. Nothing implemented yet; this is the agreed design.

**Not a preset system.** The old preset-ID layer failed by existing with nothing in it.
A scene declares its _environment intent_ as a shallow partial, and the engine applies
it through the same public API any other caller uses:

```ts
export type SceneEnvironment = {
	postprocessing?: Partial<PostProcessingConfig>; // shallow partial over the global config
	sky?: {
		clock?: 'realtime' | 'external' | 'manual';
		t?: number; // normalized time-of-day, for a manual clock
		timeScale?: number;
		weather?: string | Partial<WeatherChannels>; // named weather or raw channel target
	};
};
// SCENES[n].environment — a scene that omits it gets the global config unchanged
```

Rules that are the whole design:

1. **Global config is the baseline** (`graphics.json` / `weather.json`); a scene block
   is a **shallow partial override** — one level, no merge tree, no priority stack.
   Weather is the deliberate exception for named targets: `setWeather('storm')` already
   exists and raw partials are equally valid.
2. **Applied imperatively on scene change, never watched by an `$effect`.** The old
   system crashed precisely via a scene→preset effect that reached into state it also
   read. `setScene` calls `applyEnvironment(scene)` (a new `core/environment.ts`);
   dependency direction is strictly one-way:
   `scene.svelte.ts → core/environment.ts → sky, postprocessing` — nothing in sky or
   postprocessing may import the scene extension.
3. **No leave handler.** Every enter applies a _complete_ environment (global provides
   every field, the scene overrides some), so a scene never undoes the previous one —
   removes the "scene B looks wrong only when entered from scene A" class of bugs.

Clock overrides are the one decision with teeth:

- "What time is it" becomes scene-dependent; logic that must track world time reads the
  world clock directly, not the sky's current view of it.
- Re-entering a server-driven (`external`) scene is a **discontinuity** — it must go
  through the clock's discontinuity path (which re-bakes the env map immediately), not
  its drift smoothing, which exists so time never runs backwards during normal drift.

Open questions, decided-leanings only: boot applies the initial scene's environment
with an explicit `applyEnvironment` call (not `setScene` — no swoosh/previousScene
side effects); post-processing overrides are shallow per-effect, not deep-merged;
transition-timed application (swap at the covered fade midpoint) waits for the pipeline
fade. Studio edits the block through the same dev-server save endpoint planned for
authored sky data (see _Planned: authored sky data_ in `$core/skybox/CLAUDE.md`).

## Adding a scene

Steps live in `src/scenes/CLAUDE.md` (create the scene dir + HUD there, wire `SceneType`/`SCENES`/`Scene.svelte` here).
