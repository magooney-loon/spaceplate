# Skybox (`src/core/skybox/`)

Everything sky / time / weather / environment. Sub-area docs: `model/`,
`layers/`, `environment/` — each has its own `CLAUDE.md`.

```
Skybox.svelte     — mount + THE driver task + env/cube mode switch
Sky.svelte        — the dome (three's SkyMesh), descriptor consumer, env bake budget
SkyLight.svelte   — the descriptor-driven key light (sun→moon crossover), a SunLight with
                    CASCADED shadows fitted to the view camera; map size per cascade comes
                    from Skybox.svelte, per graphics preset (2048 / 1024) (see below)
keyShadow.ts      — who arms the one shadow render per frame, and from which camera
SkyFog.svelte     — scene.fog from the day curve + fog channel
fogScatter.svelte.ts — the uniforms SkyFog feeds the `fogScatter` post effect
godrays.svelte.ts — the key light + uniforms SkyLight feeds the `godrays` post effect
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
- **height** — a ground layer that thins with world Y, so fog sits in the world instead
  of hanging at a fixed distance. Driven by the same two signals as the band plus
  `clearGroundFogShare`, which lets the day curve's own haze peak (dawn/dusk) produce
  valley mist with no `setWeather` call at all. It deepens with its density: thin mist is
  shallow, a fog bank is deep.

### The height term is our own integral, NOT `exponentialHeightFogFactor`

Three's helper is not used — both of its problems are visible on screen:

- **It has a hard ceiling.** `max(top - fragmentY, 0)` means exactly no fog above `top`,
  and since the product with viewZ is then SQUARED, the ramp underneath saturates within
  a few percent of the layer at any real distance. The result is a flat horizontal LINE
  drawn across the world where the bank ends — the giveaway that fog is a formula.
- **It never looks at the camera.** Only the fragment's Y is in it, so a camera inside
  the bank looking up at a roof gets no fog on a ray that crossed the whole layer, and a
  camera above it looking down gets the full amount on a ray that barely clipped it.

So density falls off as `exp(-(y - base) / falloff)` and the term is its closed-form
integral along the view ray, `ρ(camera) · |P − C| · (1 − exp(−t)) / t` with
`t = Δy / falloff`. **No ceiling — it thins forever, so there is no line to draw**, and
both endpoints are in it, so climbing out of a fog bank looks like climbing out of one.

- `(1 − exp(−t))/t` is smooth and ≈1 through `t = 0`, but the expression is 0/0 there,
  and a horizontal ray is the most common case in a driving game rather than an edge
  case. A small positive `t` is substituted; `avg(1e-3) = 0.9995`, exact to float.
- **`groundFogDensity` is 1/(world unit), not 1/(unit²)** — the optical depth of a
  horizontal ray at the base is `density × length`. `groundFogFalloffRange` is a SCALE
  HEIGHT (density falls by 1/e), not a ceiling; about three of them up is where it stops
  reading as fog.

Every sky layer sets `material.fog = false` — at radius 1000 any fog would resolve the
whole sky to flat fog colour (see `layers/CLAUDE.md`). That opt-out still applies on the
`fogNode` path; `NodeMaterial` gates on `material.fog` before touching the node.

### The fog's colour is directional (`sunInscatter`)

`reference('color')` is only the **ambient-scattered base** — what the fog looks like
with your back to the light. On top of it the node ADDS a forward-scattering lobe,
`pow(max(dot(viewRay, keyDirection), 0), inscatterSharpness)` times a colour uniform, so
looking toward the sun through haze glows and looking away does not. Without it a misty
sunrise is grey haze that happens to occur at a warm time of day.

- **Additive, not a mix toward a second colour.** Inscattered light is light _arriving_;
  a thick bank toward a low sun is the brightest thing in the frame.
- `descriptor.light` is the source, so the sun→moon crossover comes free and the lobe
  costs one vec3 uniform, not two colours plus a blend.
- **The gain is computed in TS, never in the shader** — a `horizonGain` off the key's Y
  (a low key means a long grazing path; at noon the lobe points at empty sky), times the
  day curve's fog-colour luminance as the daylight proxy, the same trick and the same
  reason as the mixer's white lift (`weatherMixer.ts`). The uniform carries colour × gain
  together, so the whole term goes to black at night and at noon with no branch.
- **Deliberately NOT gated on `light.intensity`.** `keyAttenuation` pulls that down as
  fog thickens, which is right for the key and backwards here.
- `light.color` is read as WORKING space (no colour-space argument), matching
  `SkyLight.svelte`, the field's other consumer. `sky.fogColor` is the authored-sRGB one.
  They are different fields and they are converted differently — don't unify them.

### Lightning lights the fog (`flashFogLift`)

`flashState.flash` lifts the base fog colour toward white, in working space, so a strike
gives the bank a SHAPE instead of lighting the scene while the air it travels through
stays dead — the same event as the deck's inside-lighting and the dome's own flash wash.
Uniform, not directional: a bank lit from inside has no single direction, and the
envelope is already amplitude-capped at the source.

**Both of those terms are ABSORPTION.** The scattering half — a fog bank taking the edge
off what is inside it, rather than only paling it — is a post-processing effect
(`core/postprocessing/effects/fogScatter.ts`), because it blurs the composed frame and
nothing a material can do reaches its neighbours. `SkyFog`'s task drives it through
`fogScatter.svelte.ts`: the band as uniforms, the weather `fog` channel as the weight,
and an activity latch with hysteresis so the effect leaves the pipeline graph entirely in
dry weather. It is gated on the weather channel and never on the day curve's own haze —
the sky lies past the band's far edge, so it always takes the maximum blur, which is
right in a fog bank and wrong on a clear evening.

## Godrays are driven from `SkyLight`, not from a sibling driver

Crepuscular rays are a post effect (`core/postprocessing/effects/godrays.ts`, which has
the full story including the `three` patch it needs). The CPU half lives in
`SkyLight.svelte`'s existing task rather than in its own component, and that is
deliberate: the effect **raymarches the key light's shadow cascades**, so it needs that
`SunLight` INSTANCE at pipeline-build time. `SkyLight` is where the light is, and it
already registers the same light's shadow with `keyShadow.ts` from the same `oncreate`.

It writes four things into `godrays.svelte.ts`: the key colour (so the sun→moon crossover
comes free, exactly as it does for `SkyFog`'s inscatter), the key's **intensity**, a 0..1
haze weight, and the activity latch.

- **The intensity is separate from the colour because the colour is a hue and nothing
  else.** Every colour the day curve produces has magnitude around 1; the magnitude lives
  in `intensity`, up to `SUN_INTENSITY` 4.75. The post effect ADDS colour × intensity ×
  weight to an HDR frame, so without the second factor the shafts are a unit-brightness
  veil laid over a scene lit at 4.75 — which reads as a contrast crush, not as light
  (`core/postprocessing/CLAUDE.md` has the full post-mortem). It is the attenuated
  intensity on purpose: a deck that kills the key kills its shafts with it.

- **The weight is haze × key elevation.** Haze is `descriptor.sky.fogDensity`, which the
  mixer has already folded cloud and fog into — shafts are light scattered on its way to
  the camera, so a clear noon must produce none of them. The elevation fade exists because
  a key raking along the horizon is the one position where the cascades' far edge fills the
  screen, and without it a dawn flickers as the light crosses `KEY_MIN_ELEVATION`.
- **There is no on-screen term**, and that is the whole reason this can carry a latch: a
  raymarch integrates along the view ray, so the shafts exist with the sun behind you —
  nothing in the gate swings with what is in frame. The latch therefore only ever watches
  signals that move on weather-blend and day-curve timescales, and the hysteresis band
  actually works on them.
- **It is one of the few sky consumers that is NOT procedural-mode-only.** `SkyLight`
  mounts in every environment mode, so an HDR or cube environment still gets godrays — an
  environment texture still has a sun, and a raymarch through its shadow volume is still
  correct. Contrast `SkyFog`/`fogScatter`, which are procedural-only because an HDR
  environment brings its own horizon.

## The shadow frustum is fitted to the CAMERA (`SkyLight.svelte`)

The key light is three r186's **`SunLight`**, whose `SunLightShadow` fits **two
cascades** to the view camera's frustum: a practical split, a bounding-sphere projection
per cascade so a turning camera does not swim, texel snapping, and a fade band where the
two meet. One atlas, two tiles, `shadow.mapSize` per cascade. **`shadowDistance`
(`shadow.camera.far`) is the only budget knob** — the cost is the same two maps whatever
it is, so it trades reach against sharpness and nothing else.

It replaces a hand-fitted single cascade, and the reason is worth keeping: that fit
measured the **visible casters**, so it worked for a scene that fits in one box and
failed completely for one that does not. TestGame's track is ~3 km across; the fit
saturated at its cap, centred a kilometre from the car, and left the car outside its own
shadow frustum while every track triangle was rendered into the map to produce nothing
(`DOCS/testperf.md` §1.1). Fitting to the camera instead means what the player can see is
what gets shadowed, at any world size.

Three things did not come for free:

- **The map is rendered from ONE camera per frame, and which one matters.** The cascades
  are fitted by whichever camera renders them, so the once-a-frame arming lives in
  `keyShadow.ts` and fires from `core/utils/Renderer.svelte` immediately before the main
  draw. Every other pass in the frame (mirrors, cube captures, the reflector) reuses that
  atlas, one frame stale. Read `keyShadow.ts` before moving it.
- **The shadow pass draws twice**, once per cascade. Flat, and independent of
  `shadowDistance`.
- **One `normalBias` serves both cascades** — it is a world-space offset with nowhere to
  put a second. `SkyLight` measures it off the fitted **near** cascade each frame
  (`normalBiasTexels`), because over-biasing up close detaches contact shadows from their
  casters where a little acne at fifty units goes unnoticed.

`SunLight` has no `target`: its direction is its position, pointing at the origin. It is
an addon light, so `App.svelte` registers `SunLightNode` with the renderer's node library
at construction — without that it renders unlit.

**Shadows do not occlude the ambient term** — `scene.environment` and the hemisphere
fill light closed interiors from the inside regardless. That is the `ao` effect's job
(`core/postprocessing/CLAUDE.md`), and it is off by default.

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
  **must not call `invalidate()` themselves**. `SkyLight` stays in this group even though
  it now also drives the `godrays` post effect: those uniforms are pure functions of the
  descriptor too, with no camera term and nothing self-animated in them.
- **Layers animated by the TSL `time` node** (`Stars`, `Nebula`, `Meteors`, `CloudDeck`,
  `Rain`, `Snow`) keep their own `invalidate()`, gated on being visible, and set
  `mesh.visible` so an invisible layer costs no draw call either. **`Birds`** is the
  same contract with a different clock: its two `renderer.compute()` passes are what
  animate it, so they run (and invalidate) only while the flock is ungrounded.
- **`Lightning`** gates on a live strike. **`LensDriver`** gates on wetness/frost > 0 —
  it renders nothing itself, but the two lens POST effects it feeds are animated, so the
  invalidation is still owed (`layers/precipitation/lensState.svelte.ts`).

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
