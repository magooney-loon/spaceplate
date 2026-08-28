# Scene Environment

How a scene declares what it looks like: which post-processing is active, what time it
is, and what the weather is doing.

This is the seam between three things that otherwise don't know about each other — the
scene state machine (`extensions/scene/`), the post-processing pipeline
(`post-processing.md`) and the sky/weather model (`weather-system.md`).

**Status:** planned, nothing implemented.

---

## 1. What exists today, and why it goes

`extensions/scene/` currently carries a two-level preset-assignment layer:

- `BUNDLED_SCENE_PRESETS` — per-scene preset IDs, committed.
- `BUNDLED_GLOBAL_PRESETS` — a global base layer; scene wins on conflict.
- `scenePresetsOverrides` / `globalPresetsOverride` — localStorage dev overrides.
- `resolveScenePreset()` / `resolveGlobalPreset()` — override → bundled → `null`.
- Four actions (`setScenePreset`, `clearScenePreset`, `setGlobalPreset`,
  `clearGlobalPreset`) plus their persistence helpers.

That is roughly 130 lines of resolution and persistence machinery, and it currently
serves **zero presets**. Both bundled objects contain only commented-out examples,
both resolvers return `null` for every input, and nothing calls them any more —
`core/Skybox.svelte` deleted its resolution `$effect` because that effect read and
wrote `transitionState` in one pass and was a direct cause of
`effect_update_depth_exceeded`.

So the mechanism is entirely speculative, and it is also **the wrong shape now**:

| | Old payload | New payload |
|---|---|---|
| Post-processing | Preset ID → a snapshot of 25 effect param sets | Which effects are enabled + their params |
| Sky | Preset ID → 6 scalars + 17 star fields | *Not a snapshot at all* — a clock, a time, a weather target |

A preset ID pointing into a library made sense when the payload was large and opaque.
The sky's payload is now three small values with meaning, and there is nothing to look
up. The unified `ScenePresets { postprocessing?: string; skybox?: string }` cannot
describe both halves any more.

**The replacement is not a preset system.** A scene declares its *environment intent*,
and the engine applies it through the same public API any other caller uses.

---

## 2. The model

```
config files (global default)  ──┐
                                 ├──► resolved environment ──► applied on scene enter
SCENES[n].environment (override) ─┘
```

Three rules, and they are the whole design:

1. **Global config is the baseline.** `graphics.json` and `weather.json` describe the
   default look. A project with one look never writes a scene block at all.
2. **A scene block is a shallow partial override.** One level, not a merge tree. No
   conflict detection, no priority stack, no per-effect resolution.
3. **It is applied imperatively on scene change**, never watched by an `$effect`.

Rule 3 is the important one. See §4.

### 2.1 Why partial overrides and not named profiles

A scene could name a profile (`postprocessing: 'cinematic'`) instead of carrying
values. That reintroduces a preset library — the exact layer that just failed here by
existing with nothing in it.

With two scenes, inline overrides are strictly simpler and there is nothing to name.
If the scene count grows to where the same block is repeated, adding a name lookup is
a small, local change: resolve a string to a partial before the merge, leaving
everything downstream untouched. Not now.

**Weather is the deliberate exception.** `setWeather('storm')` is already the
established API (`weather-system.md` §5.3) — named weathers are target vectors and
raw channel objects are equally valid. A scene may use either, because that naming
layer already exists and already carries content.

---

## 3. The shape

```ts
// extensions/scene/types.ts
export type SceneEnvironment = {
    /** Shallow partial over the global post-processing config. */
    postprocessing?: Partial<PostProcessingConfig>;

    sky?: {
        clock?: 'realtime' | 'external' | 'manual';
        /** Normalized time-of-day, for a manual clock. */
        t?: number;
        timeScale?: number;
        /** A named weather, or a raw channel target. */
        weather?: string | Partial<WeatherChannels>;
    };
};

export type SceneConfig = {
    id: SceneType;
    label: string;
    icon: string;
    environment?: SceneEnvironment;
};
```

In practice:

```ts
export const SCENES: SceneConfig[] = [
    {
        id: 'mainMenu',
        label: 'Main Menu',
        icon: 'mdiHome',
        // A fixed, art-directed vista: pinned at golden hour, always clear.
        environment: {
            sky: { clock: 'manual', t: 0.78, weather: 'clear' },
            postprocessing: { dof: { enabled: true, focusDistance: 8 } }
        }
    },
    {
        id: 'demoScene',
        label: 'Demo Scene',
        icon: 'mdiEarth',
        // Gameplay: real time, weather free to change.
        environment: { sky: { clock: 'realtime', timeScale: 60 } }
    }
];
```

A scene that omits `environment` gets the global config unchanged.

---

## 4. Application — imperative, never reactive

**The environment is applied by an action call, not by an `$effect` watching
`sceneState.currentScene`.**

This is not a style preference. The previous system's crash was precisely a scene→
preset `$effect` that reached, several calls deep, into state it also read
(`webgpu-notes.md` §3.1). Any effect that watches the current scene and then writes
sky or post-processing state is the same bug wearing new clothes.

```ts
// core/environment.ts — imports sky + postprocessing; nothing imports it back
export function applyEnvironment(sceneId: SceneType) {
    const env = resolveEnvironment(sceneId);   // global ← scene partial

    if (env.sky?.clock) sky.setClock(env.sky.clock);
    if (env.sky?.t !== undefined) sky.setTime(env.sky.t);
    if (env.sky?.timeScale !== undefined) sky.setTimeScale(env.sky.timeScale);
    if (env.sky?.weather) sky.setWeather(env.sky.weather);

    postprocessing.applyConfig(env.postprocessing);
}
```

```ts
// scene.svelte.ts
setScene(scene: SceneType) {
    if (sceneState.currentScene === scene) return;
    // ...existing logging / swoosh / previousScene bookkeeping
    sceneState.currentScene = scene;
    applyEnvironment(scene);        // one direction, inside the action
}
```

Dependency direction is strictly one-way:

```
scene.svelte.ts ──► core/environment.ts ──► sky, postprocessing
```

Nothing in `sky` or `postprocessing` may import the scene extension. If a subsystem
ever needs to know the current scene, it takes it as a parameter.

**There is no leave handler.** Every scene enter applies a *complete* environment —
global provides every field, the scene block overrides some. A scene therefore never
has to undo what the previous one did, which removes an entire class of
"scene B looks wrong only when entered from scene A" bugs.

### 4.1 Timing with the transition

`transitionTo` (`post-processing.md` §6) fades out, swaps, and fades back in. Because
it calls `setScene` at the midpoint, the environment swap lands **while the screen is
covered** and needs no extra coordination:

```
mixRatio 0 ──────► 1        setScene() + applyEnvironment()        1 ──────► 0
   fade out              (hidden: sky, weather, PP all change)       fade in
```

This is the main practical argument for doing transitions at all: a post-processing
graph rebuild and an env-map re-bake are both visible hitches, and this hides both.

---

## 5. Clock override semantics

**Decided: a scene may override the clock source.** The menu pins a manual clock at a
chosen time; gameplay scenes run `realtime` or server-driven `external`.

Consequences worth stating up front, because this is the one decision here with teeth:

- **"What time is it" becomes scene-dependent.** Gameplay queries
  (`sky.getPhase()`, `sky.isDaytime()`) answer for the *current* scene's clock. Any
  game logic that must track world time regardless of scene has to read the world
  clock directly, not the sky's current view of it.
- **Re-entering a server-driven scene is a discontinuity.** Leaving a manual menu clock
  back to `external` means jumping to wherever server time now is. That jump must go
  through the clock's discontinuity path, not its smoothing path — the smoothing in
  `weather-system.md` §6 exists so time never runs backwards during *normal* drift,
  and it must not be asked to absorb a deliberate multi-hour jump.
- **A discontinuity forces an env-map re-bake** (`weather-system.md` §15.2). The
  budget's "significant change" trigger covers it, but it must be an explicit call at
  the swap rather than something the budget notices a frame later.

For a persistent multiplayer world where the menu should also show true world time, a
scene simply omits `clock` and inherits the global one. The override is available, not
mandatory.

---

## 6. Studio

The Scenes panel edits the environment block for the selected scene and writes it to
the committed config through the same dev-server endpoint as everything else
(`weather-system.md` §16.1). No copy-to-clipboard step — that workflow existed only
because there was no write path.

The panel is **just another caller**: it edits the same data the file provides and
calls the same `applyEnvironment`. There is no privileged Studio path, which is what
keeps the panel from drifting away from the real behaviour.

---

## 7. File plan

### Added

| Path | Purpose |
|---|---|
| `src/core/environment.ts` | `resolveEnvironment(sceneId)` + `applyEnvironment(sceneId)` (§4) |

### Changed

| Path | Change |
|---|---|
| `extensions/scene/types.ts` | `SceneEnvironment` type; `environment?` on `SceneConfig`; the four preset actions leave `ExtensionActions` |
| `extensions/scene/scene.svelte.ts` | `SCENES` entries gain `environment`; `setScene` calls `applyEnvironment`. Removes both resolvers, both override `$state` objects, the four preset actions and all four localStorage helpers |
| `extensions/scene/SceneExtension.svelte` | Preset-assignment and copy-to-clipboard UI → environment editor + save |

### Deleted

| Path | Reason |
|---|---|
| `extensions/scene/bundledPresets.ts` | Replaced by `environment` on `SCENES`. Contains only commented-out examples |

Two localStorage keys (`spaceplate-scene-preset-overrides`,
`spaceplate-global-preset-override`) become orphaned. They are dev-only scratch data;
stale values must be *ignored*, not migrated.

---

## 8. Phasing

This lands **after** both subsystems exist, because it is the thing that wires them
together and has nothing to wire before then.

1. **Delete the dead preset layer.** Can happen immediately and independently — it
   serves zero presets and has no callers. Leaves `SCENES` as plain config.
2. **`environment.ts` + sky intent.** Once `weather-system.md` phase 1 lands, scenes
   can set clock/time/weather. This is where the model earns itself: a menu that sits
   at golden hour while gameplay runs real time.
3. **Post-processing overrides.** Once `post-processing.md` phase 2 lands and there is
   a config to partially override.
4. **Studio environment editor + save.** Needs the write endpoint from
   `weather-system.md` §16.1.
5. **Transition-timed application.** Once `TransitionNode` is wired
   (`post-processing.md` phase 8), move the swap to the covered midpoint.

Step 1 is worth doing on its own regardless of when the rest happens — it is a pure
deletion of unreachable code.

---

## 9. Open questions

1. **Does `applyEnvironment` run on first boot?** The initial scene is set by
   declaration, not by `setScene`, so nothing applies its environment. Either boot
   calls it explicitly once, or `setScene` is used for the initial transition. Leaning
   explicit call at boot — using `setScene` for initialization would fire a swoosh and
   write `previousScene`.
2. **Should `postprocessing` overrides be per-effect-deep or shallow?** Shallow
   (`{ bloom: {...} }` replaces the entire bloom block) is simpler and predictable;
   deep merge is friendlier for changing one value. Shallow unless it becomes
   annoying — a deep merge over a config with `enabled` flags has ambiguous semantics
   for a partially-specified effect.
3. **Do HUD scenes need environment at all?** `SceneHud` components are HTML overlays
   outside the Canvas. They are unaffected, but a menu that wants the 3D scene dimmed
   behind it may want a post-processing override rather than a CSS scrim. Not decided.

---

## 10. Out of scope

- Per-scene *physics*, audio or input configuration. This document covers the visual
  environment only. If a general per-scene config layer is ever wanted, this is the
  precedent to follow, not a reason to build it now.
- Runtime scene creation. `SCENES` is a static committed list.
