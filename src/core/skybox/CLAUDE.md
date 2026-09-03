# Skybox (`src/core/skybox/`)

Everything sky / time / weather / environment. Sub-area docs: `model/`,
`layers/`, `environment/` — each has its own `CLAUDE.md`.

```
Skybox.svelte     — mount + THE driver task + env/cube mode switch
Sky.svelte        — the dome (three's SkyMesh), descriptor consumer, env bake budget
SkyLight.svelte   — the descriptor-driven key light (sun→moon crossover); its shadow map
                    size comes from Skybox.svelte, per graphics preset (2048 / 1024)
SkyFog.svelte     — scene.fog from the day curve + fog channel
model/            — the pure model + the sky façade (descriptor, skyActions, skyMeta)
layers/           — every renderer that draws on/around the dome
environment/      — env-mode state (procedural | HDR | cube) + texture lists
```

**Scene fog is owned by `SkyFog.svelte`.** One linear `Fog` plus one `scene.fogNode`,
both created at mount and never swapped — assigning a _new_ fog object or node rebuilds
three's fog node and invalidates every material's cache key. The Fog instance is the
parameter carrier (colour/near/far, mutated per frame and bound into the node through
`reference()`, exactly as `NodeManager.updateFog()` would); the node adds a second,
height-based term.

Two factors, unioned as transmittances (`1 - (1 - range)(1 - height)`):

- **range** — camera-relative horizon masking, starting near the active camera's `far`.
  The weather `fog` channel pulls that band inward for actual low visibility.
- **height** — `exponentialHeightFogFactor`, a ground layer that thins with world Y, so
  fog sits in the world instead of hanging at a fixed distance. Driven by the same two
  signals as the band plus `clearGroundFogShare`, which lets the day curve's own haze
  peak (dawn/dusk) produce valley mist with no `setWeather` call at all. Its ceiling
  rises with its density: thin mist is shallow, a fog bank is deep.

Every sky layer sets `material.fog = false` — at radius 1000 any fog would resolve the
whole sky to flat fog colour (see `layers/CLAUDE.md`). That opt-out still applies on the
`fogNode` path; `NodeMaterial` gates on `material.fog` before touching the node.

## The descriptor contract — the one rule everything else follows

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

## Update budgets

A continuous sky changes every frame, but consumers have wildly different costs, so
cadence is tiered:

- **Visual** (dome uniforms, sun position, key light) — every frame; cheap writes,
  must be smooth.
- **Environment map** — the one real trap: a re-bake is a full cube render, ruinous at
  60× time scale if driven per change. `Sky.svelte` owns the budget: re-bake at most
  every ~250 ms wall time **or** once the sun has moved ~1°, whichever first, and
  always immediately on a discontinuity (time scrub, clock swap, `over: 0` weather —
  the model flags these via `consumeDiscontinuity()`).
- **Gameplay/events** — on threshold crossing (phase change, sunrise, weather targets
  reached).

The descriptor stays fresh; only the expensive derivative of it steps. That is also
why data flows one way (clock → model → renderers, renderers never write back): a
renderer can make cost decisions locally without the model knowing what a cube camera
is.

## Multiplayer: server-authoritative sky

For a SpacetimeDB game the server is the authority on time-of-day and weather: clients
run an `external` clock fed by server time and receive weather as data, not commands —
the adapter is a thin extension (a table, a subscription, a call into the mixer); the
core stays source-agnostic. **Client-side smoothing is mandatory**: server ticks arrive
with jitter, so the clock must ease toward the authoritative value, never step, never
run backwards (a game day must not jump because a packet was late). No prediction or
rollback needed — nobody notices rain starting 150 ms late. Single-player is the same
engine with a `realtime` clock and local weather calls.

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

## Planned: authored sky data

Day-curve keyframes and weather definitions are intended to become **authored data in
a committed file** (`weather.json`, schema = the model's types; a `version` field so a
format change can migrate rather than crash) — imported directly so it is bundled,
type-checked and works in production. Today they live in code (`dayCurve.ts`,
`WEATHERS` in `weatherMixer.ts`); Studio edits live state only.

The save path is a **dev-server endpoint** (Vite plugin, `apply: 'serve'` — it cannot
exist in a production build), because it writes to source:

- Validate shape + version **before** touching disk; a malformed POST must not corrupt
  a committed file.
- Write via temp file + rename, so an interrupted write cannot truncate the config.
- Emit 2-space indent + trailing newline (matches Prettier) so saving doesn't churn
  the diff.

Boot order: file → localStorage override (dev scratchpad only) → live edits. The
per-scene `environment` plan (`src/extensions/scene/CLAUDE.md`) reuses this same
endpoint rather than inventing a second mechanism.
