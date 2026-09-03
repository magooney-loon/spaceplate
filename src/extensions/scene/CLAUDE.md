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
- **SCENES**: `SceneConfig[]` — each entry has `id`, `label`, `icon`. Per-scene `environment` block is planned but not implemented — see below.
- **sceneState**: `{ currentScene, previousScene, isTransitioning, visited }`.
- **sceneActions**: `setScene`, `goToMainMenu`, `goToDemoScene`, `goBack`, `transitionTo`, `warmupScenes`.

## Key behavior

- `setScene()` plays the swoosh sound, logs the transition, stores `previousScene`, latches `visited[scene]`.
- **Keep-alive mounting** (Scene.svelte): a scene component mounts the first time it becomes current (`visited`) and stays mounted forever; switching toggles the group's `visible`. Never route scenes with a bare `{#if}` on currentScene — unmounting disposes materials (evicting compiled pipelines) and tears down Rapier bodies. Caveats: hidden meshes still raycast if they register pointer handlers, and hidden Rapier bodies keep simulating (see `useRapier().pause()` if that must stop).
- `warmupScenes()` — boot-only sweep called by Loader.svelte once assets settle: visits every scene (direct currentScene writes — no swoosh/log), waits for mount, bumps `bootState.warmVersion` for a warm frame through the real pipeline, holds `WARM_GRACE_MS` per scene for background compilation, restores the original scene, latches `scenesWarmed`. Idempotent.
- `transitionTo(scene, ms)` splits the wait in half around `setScene` for a two-phase animation. Nothing visual happens today — it is two `setTimeout`s; the plan is a pipeline fade (see _Scene transitions_ in `$core/postprocessing/CLAUDE.md`).
- The old preset-assignment layer (bundledPresets.ts, resolvers, localStorage maps, four actions) was deleted — it resolved to `null` for every input and held zero presets, and its `$effect` caused an infinite loop.

## Planned: per-scene `environment` block

How a scene declares what it looks like: which post-processing is active, what time it
is, what the weather is doing. Nothing implemented yet; this is the agreed design.

**Not a preset system.** The old preset-ID layer failed by existing with nothing in it.
A scene declares its *environment intent* as a shallow partial, and the engine applies
it through the same public API any other caller uses:

```ts
export type SceneEnvironment = {
	postprocessing?: Partial<PostProcessingConfig>; // shallow partial over the global config
	sky?: {
		clock?: 'realtime' | 'external' | 'manual';
		t?: number;      // normalized time-of-day, for a manual clock
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
3. **No leave handler.** Every enter applies a *complete* environment (global provides
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
