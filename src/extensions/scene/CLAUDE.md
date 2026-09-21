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
- **sceneState**: `{ currentScene, visibleScene, previousScene, isTransitioning }`.
  - **`currentScene` is what is MOUNTED, `visibleScene` is what the player can SEE**, and during a transition they differ for the whole covered period: the swap happens at the start of the load, the reveal at the end of it. 3D routing (`Scene.svelte`) follows `currentScene`; HUD routing (`SceneHud.svelte`) follows `visibleScene`, which `transitionTo` publishes one statement before the reveal. Anything else asking "which scene is this" wants `currentScene`.
- **sceneActions**: `setScene`, `goToMainMenu`, `goToDemoScene`, `goToTestGame`, `goBack`, `transitionTo`.

## Key behavior

- `setScene()` plays the swoosh sound, logs the transition, stores `previousScene`. Instant swap — boot, the Studio panel and other programmatic callers.
- **Scene routing** (Scene.svelte): a plain `{#if}` on `currentScene` — exactly one scene is mounted at a time. Switching unmounts the outgoing scene (its components' teardown disposes their THREE resources and removes its Rapier bodies from the world), so a return trip re-pays mount and shader compilation.
- **`transitionTo(scene)` — the per-scene warm swap ("bootloader")**: the `goTo*`/`goBack` actions (every HUD button) route through it. The cover has three phases, and the middle one is a loading screen: the post-processing composite captures the outgoing scene's last frame (`$core/postprocessing/transitionState.svelte`), **dips** it to flat black *before* the swap (while the outgoing scene is still mounted and nothing is blocking the main thread), the load and warm happen under that flat cover with Loader.svelte's veil as the whole picture, and the veil **reveals** into the new scene at the end. Loader.svelte's black veil is the fallback when there's no pipeline to capture with.
  - Sequence: capture → `waitForCoverSettled` (the dip) → `setScene` → one rAF to flush mount (where the new scene's `useGltf`/`TextureLoader` calls fire) → **the asset gate** (`waitForAssetsIdle`, holds the cover until the loading queue drains, capped by a timeout) → one rAF to flush the subtrees those assets gated → **the warm gate** (`warmScene`, forces real frames until three stops building shader programs — must run *after* the asset gate, or it warms the wrong material variants) → **the reveal**, which waits for a minimum cover time (`minCoverSeconds`) so a cached re-entry doesn't strobe the loading UI on and off. Guards: same-scene and already-transitioning are no-ops; the boot scene skips all of this (it mounts at t=0 behind the Loader).
  - `isTransitioning` is raised after the capture and before the dip; the re-entrancy guard is a separate plain `busy` flag, so `isTransitioning` is free to mean "a cover is warranted" rather than "a call is in flight". Full rules for the asset/warm gates: `$core/utils/CLAUDE.md`.

## Planned: per-scene `environment` block

How a scene declares what it looks like: which post-processing is active, what time it
is, what the weather is doing. Nothing implemented yet; this is the agreed design.

**Not a preset system.** A scene declares its _environment intent_ as a shallow partial,
and the engine applies it through the same public API any other caller uses:

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
2. **Applied imperatively on scene change, never watched by an `$effect`** — a
   scene→environment effect that also reads the state it's applying is the
   unconditional-loop trap. `setScene` calls `applyEnvironment(scene)` (a new
   `core/environment.ts`); dependency direction is strictly one-way:
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
