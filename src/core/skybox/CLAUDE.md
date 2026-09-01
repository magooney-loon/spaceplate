# Skybox (`src/core/skybox/`)

Everything sky / time / weather / environment. Full concept + plan of record:
`DOCS/weather-system.md` (§ numbers below refer to it). Sub-area docs: `model/`,
`layers/`, `environment/` — each has its own `CLAUDE.md`.

```
Skybox.svelte     — mount + THE driver task + env/cube mode switch
Sky.svelte        — the dome (three's SkyMesh), descriptor consumer, env bake budget
SkyLight.svelte   — the descriptor-driven key light (sun→moon crossover)
SkyFog.svelte     — scene.fog from the day curve + fog channel
model/            — the pure model + the sky façade (descriptor, skyActions, skyMeta)
layers/           — every renderer that draws on/around the dome
environment/      — env-mode state (procedural | HDR | cube) + texture lists
```

**Scene fog is owned by `SkyFog.svelte`.** One linear `Fog`, created at mount and
mutated per frame — assigning a _new_ fog object rebuilds three's fog node and
invalidates every material's cache key. Clear-weather fog is camera-relative horizon
masking (it starts near the active camera's far range); the weather `fog` channel
pulls the band inward for actual low visibility. Every sky layer sets
`material.fog = false` instead — at radius 1000 any fog would resolve the whole sky to
flat fog colour (see `layers/CLAUDE.md`).

## The descriptor contract (§14.1) — the one rule everything else follows

**`descriptor` is a plain mutable object, not `$state`.** One task (Skybox.svelte's
driver, `before: autoRenderTask`) ticks the clock, samples the curve, mixes weather and
writes the descriptor in place. Every consumer — Sky, SkyLight, SkyFog, all layers,
`core/audio/weatherAudio.ts` — reads it from its own task. Nothing is tracked, nothing
invalidates, no effect can loop.

- Per-frame values are **never** `$state` and **never** props. They change 60x/second.
- State shared between layers (flashState, heightField) follows the same shape: a plain
  module with exactly **one writer** and any number of task readers.
- The only reactive surface is `skyMeta` — a `$state` mirror of `meta` + the weather
  channels, written by the model's publish step, epsilon-gated so a 20 s blend wakes the
  graph a few dozen times. For HUD overlays and the Studio panel only. Written, never
  read, by the tick.
- Authoring state (keyframes, weather definitions being edited in Studio) flows one
  direction: panel → actions → model.

## `invalidate()` has one owner per reason

`renderMode` is `'on-demand'`; a frame is only drawn when something invalidates.

- **Skybox.svelte's driver task** invalidates when the model actually moved (compares
  `meta.t` + the weather channels — everything else derives from those numbers). It
  covers `Sky`, `SkyFog`, `SkyLight`, `Moon`, which are pure descriptor consumers and
  **must not call `invalidate()` themselves**.
- **Layers animated by the TSL `time` node** (`Stars`, `Nebula`, `Meteors`, `CloudDeck`,
  `Rain`, `Snow`) keep their own `invalidate()`, gated on being visible, and set
  `mesh.visible` so an invisible layer costs no draw call either. **`Birds`** is the
  same contract with a different clock: its two `renderer.compute()` passes are what
  animate it, so they run (and invalidate) only while the flock is ungrounded.
- **`Lightning`** gates on a live strike. **Lens layers** gate on wetness/frost > 0.

## Environment modes

`environmentState.mode` picks `sky` (procedural, default) | `environment` (HDR/EXR) |
`cube` — see `environment/CLAUDE.md`. In procedural mode the whole `layers/` tree +
dome mount; in HDR/cube modes none of them do. **`SkyLight` mounts in every mode** — an
environment texture still needs a sun. Anything that must survive mode switches (like
the weather audio beds) therefore lives outside the layers.

## Consumers outside this directory

- `$core` barrel re-exports `Skybox`, `SkyLight` and the model surface.
- `core/audio/weatherAudio.ts` — rain bed + thunder, reading `descriptor.weather` +
  `flashState`. Deliberately not a layer (see above).
- `extensions/skybox/SkyboxExtension.svelte` — the Studio panel; just another caller of
  `skyActions` / `environmentActions`, plus the `requestStrike()` dev hook.
