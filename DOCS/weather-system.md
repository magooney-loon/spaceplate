# Sky & Weather System

Replacing the preset-based skybox with a time-driven sky and weather system.

**§1–§13 are the agreed concept** — the model, the API surface, the decisions.
**§14–§18 are the implementation plan** — module layout, three.js/WebGPU specifics,
and what actually gets written.

Companions: `post-processing.md` (the render pipeline this eventually feeds),
`scene-environment.md` (how a scene pins its own time and weather),
`webgpu-notes.md` (WebGPU and reactivity rules the implementation must obey).

**Status:** concept agreed, nothing implemented. Open questions from the first draft
are resolved in §11 (fixed sun arc, moon in v1, sky as the scene's only key light,
single weather mixer, `weather.json`, one server `environment` table).

---

## 1. Why rework

The current skybox is **preset-shaped**: ten discrete snapshots (`dawn`, `day`,
`sunset`, `storm`...) in `skybox.svelte.ts`, plus machinery to lerp between two
of them over a duration. That model breaks down the moment you want any of these:

- **A day/night cycle.** The sun should move because time passes, not because a
  script picked a new preset. `elevation`/`azimuth` are hand-set scalars today —
  nothing derives them from a time of day.
- **Server-driven conditions.** In a SpacetimeDB game the server should be able
  to say "it is 14:30 and a storm is rolling in" and every connected client
  should agree. There is no time source abstraction to hook a server clock into.
- **Weather as a living thing.** Clouds thickening, fog building, rain starting —
  these are continuous modulations over minutes, not a preset swap with a
  transition duration.
- **Gameplay queries.** Games want to ask "is the sun up?", "how high?", "is it
  raining?" and react (vampires, stealth, solar panels, wet footsteps). The
  current state exposes scattering coefficients — atmospheric physics, not game
  meaning.

There is also a structural problem: the existing presets are secretly one thing.
`sunrise`, `day`, `sunset`, `night` are not four different skies — they are four
*points on the same day*. The rework makes that structural.

### Lessons carried forward from the WebGPU migration

- Every reactive loop we have hit came from effects reading and writing the same
  state (directly or through actions several calls deep). The new system must be
  **pure where possible**: given (time, weather) → parameters, with rendering
  consuming the result. See `webgpu-notes.md` §3.
- One live global config beats a preset library nobody uses. Whatever is
  authored (day-curve keyframes, weather definitions) is **data in a committed
  file**, editable via Studio, saved explicitly.

---

## 2. The core model

Three concerns, strictly separated:

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│ TIME        │─────▶│ ATMOSPHERE   │─────▶│ RENDERING       │
│ (a clock)   │      │ (pure model) │      │ (consumers)     │
└─────────────┘      └──────▲───────┘      └─────────────────┘
                            │
                     ┌──────┴───────┐
                     │ WEATHER      │
                     │ (a mixer)    │
                     └──────────────┘
```

1. **Time** — *when is it*. A single source of truth for the current moment.
   Pluggable: local clock, server clock, manual scrub.
2. **Atmosphere** — *what the sky is like at that moment*. A pure function:
   time-of-day + weather → a frame descriptor of atmospheric parameters.
3. **Rendering** — *how it is drawn*. Sky dome, star field, clouds, fog,
   precipitation, environment map. Pure consumers; they never feed back.

**The rule that keeps this sane: data flows one way.** Clock → model →
renderers. Renderers never write back. Weather is the only second input, and it
enters through the model, not around it.

---

## 3. Time

### 3.1 The canonical value

The engine tracks **normalized time-of-day** `t ∈ [0, 1)` — `0` = midnight,
`0.25` = sunrise, `0.5` = noon, `0.75` = sunset — plus a day counter for
"how many days since epoch" (needed for multi-day weather and save games).

Everything else derives from `t`. It is the only time value anyone reads.

### 3.2 Clocks

Time has pluggable sources. The engine **never owns time** — it reads it from a
clock, and games bring their own:

| Clock | What it does | Who uses it |
|---|---|---|
| `realtime` | Follows the player's wall clock, optionally pinned to a timezone/UTC offset | Default. "The sky outside my window" |
| `external` | Reads a value the game supplies each tick | **Server time** (SpacetimeDB), scripted timelines, replays |
| `manual` | Fixed value, changed only when someone calls `setTime` | Studio scrubber, cutscenes, screenshots, tests |

Every clock carries a **scale** (`1` = real time, `60` = one game day per 24
minutes, `0` = frozen). Scale multiplies elapsed time; it does not change the
source.

The "hook up their server time" case is exactly `external`: the game (or a thin
SpacetimeDB adapter) pushes server time into the engine, and the engine stops
listening to any local source. Switching clocks is a state swap, not a rewire.

### 3.3 The sun path — fixed arc

Sun position is derived from `t` along a **fixed arc**: sunrise and sunset at
fixed normalized times, elevation/azimuth interpolated along a simple arc.
Predictable, gamey, trivially authorable. Decided over a real solar model
(latitude + day-of-year — short winter days, midnight sun at high latitudes);
if a game ever needs that, it arrives as an alternative path module, because
everything downstream reads only the derived sun direction, never the arc
parameters.

### 3.4 The moon path

The moon is in v1. It mirrors the sun's fixed arc with a **configurable lag**,
defaulting to opposition (`t + 0.5`) — a full moon every night to start. Phases
are just the sun–moon angle, so the lag knob becomes the phase control when
wanted; a phase-shaded disc is render-layer work and is not in v1.

Two celestial bodies, one rule: both are pure functions of `t`. The scene gets
a **single key light** that crosses over sun → moon at dusk and dawn (§7) —
not two competing lights.

### 3.5 Phases

The day is divided into **named phases** — night, astronomical dawn, dawn,
sunrise, morning, noon, afternoon, golden hour, sunset, dusk, night. Phases are
derived thresholds on **sun** elevation (e.g. sun below −18° = night, −6°…0° =
twilight), not separate presets — moonlight illuminates the night, it does not
redefine it. `noon` is keyed to the arc's peak (a narrow band around the sun's
highest point), not to an absolute elevation — "above 20°" would swallow most
of daylight and the word would stop meaning anything. Symmetric pairs (dawn /
dusk, morning / afternoon) are separated by the rising/falling flag, not by
separate thresholds.
They exist for gameplay queries and events, and as keyframe anchors for the
day curve (§4).

---

## 4. The day curve

Instead of ten discrete presets, **one continuous day**: the atmospheric
parameters are keyframed curves over `t`.

```
t:      0 ─── 0.22 ─── 0.27 ─── 0.35 ─── 0.5 ─── 0.7 ─── 0.76 ─── 0.8 ─── 1
        night  astro    sunrise  morning  noon  golden  sunset   dusk   night
                dawn
```

Each keyframe is a full atmospheric parameter set. The current parameter values
are **sampled** from the curve at the current `t` — cheap interpolation between
neighbouring keyframes.

- The existing `SKY_PRESETS` are exactly these keyframes wearing a disguise.
  `sunrise`/`day`/`sunset`/`night` become four keyframes on one timeline; the
  rest (`cloudy`, `storm`, `fog`) stop being sky presets entirely — they were
  always weather wearing a sky costume.
- Keyframes are **authored data** — a committed JSON file, same story as
  `graphics.json`: loaded at boot, editable in Studio, saved explicitly,
  reviewable in git.
- Interpolation rules: scalars ease, angles wrap (the existing `lerpAngle`
  concept survives), colours interpolate in a sane space. Keyframes can carry
  per-property curves (hold, linear, smooth) if flat lerp ever feels cheap.

What the curve holds: the *baseline* sky — scattering parameters, exposure, star
visibility, base fog colour. What it does **not** hold: weather (§5).

---

## 5. Weather

Weather is not a preset of the sky. Weather is a **modulation layer** applied on
top of the day-curve baseline.

### 5.1 The split

```
day curve (time)  ──▶ baseline sky params
                            │
weather mixer    ──▶ modulation (cloud, fog, rain, wind...)
                            ▼
                     frame descriptor
```

A storm at noon is still noon under clouds. The sun still drives scattering and
light; weather *attenuates, adds, and obscures*. That composition — day curve
under weather, never instead of it — is what makes this a system rather than a
preset swap. An overcast sunset still reads as evening: dimmer, grey, but
evening.

### 5.2 Weather channels

Weather is a vector of independent **channels**, each with an intensity
`∈ [0, 1]` plus channel parameters:

| Channel | Roughly governs |
|---|---|
| `cloudCover` | Opacity/extent of the cloud layer |
| `cloudType` | Cumulus / stratus / storm towers (blends) |
| `fog` | Fog/haze density and colour bias |
| `precipitation` | None / rain / snow, intensity |
| `wind` | Speed + direction — drives clouds, particles, audio |
| `lightning` | Storm-cell flicker events |
| `special` | Aurora, eclipse, blood moon — game-specific overlays |

Channels are independent: fog without rain, wind without clouds. A weather
*state* is just a named target vector over these channels.

### 5.3 The mixer

Named weathers (`clear`, `cloudy`, `overcast`, `fog`, `storm`, `snow`) are
**target vectors**, not scripts. The mixer holds the current channel values and
eases them toward whatever target is active:

```
setWeather('storm', { over: 30_000 })
   └─▶ over 30 s, cloudCover 0.2→1, precipitation 0→1, wind 0.1→0.8, ...
```

- Blending is per-channel with its own easing; a storm doesn't arrive all at
  once — clouds first, then wind, then rain (staggered channel onset is a
  parameter of the weather definition).
- Raw targets are as valid as named ones: `setWeather({ cloudCover: 0.9, fog:
  0.4 })` with no name at all.
- The mixer is the **single authoritative weather state**. Whether a call came
  from local game code or a server table subscription, it converges on the same
  mixer — one code path.

### 5.4 Who drives weather

Anything, because the engine doesn't care:

- **Game code** — `setWeather(...)` at any moment (cutscene, trigger zone).
- **The server** — authoritative for multiplayer: a reducer writes a weather
  row, every client's subscription calls the same `setWeather`. All clients
  blend to the same storm on the same clock (§6).
- **A director (optional, later)** — an autonomous loop that picks weather
  goals semi-randomly so single-player worlds have weather without a script.
  The engine ships the hook, not the policy.

---

## 6. Multiplayer: server-authoritative sky

This is a SpacetimeDB boilerplate, so this isn't a nice-to-have — it is half the
point of "hook up their server time".

- **The server is the authority** on time-of-day and weather. Clients run an
  `external` clock fed by server time; clients receive weather as data, not
  commands.
- **Client-side smoothing is mandatory, not optional.** Server ticks arrive at
  network cadence with jitter; the sky must interpolate toward the server's
  time/weather rather than step. The clock owns this: it tracks drift and eases
  toward the authoritative value instead of snapping (a game day must never
  jump backwards because a packet arrived late).
- **Latency doesn't matter here.** Nobody notices if their rain starts 150 ms
  after yours. There is no need for rollback or prediction — smooth toward
  authority is sufficient. This is the easiest possible netcode problem, and the
  architecture should not complicate it.
- **Single-player still works** with a `realtime` clock and local weather calls.
  Same engine, different sources. The core never knows which world it is in.

The server adapter itself is a thin extension (a table, a subscription, a call
into the mixer). The core stays source-agnostic.

---

## 7. The frame descriptor

The single output contract of the atmosphere model. Once per frame (or per
budget tier, §9), the model publishes a plain object:

```
frame descriptor
├─ sun: direction, elevation, azimuth, visibility (0..1, occluded by clouds)
├─ moon: direction, elevation, visibility
├─ sky: scattering parameters, exposure
├─ clouds: cover, type, wind offset
├─ fog: colour, density
├─ precipitation: type, intensity
├─ stars: visibility
├─ wind: vector, speed
├─ light hints: key light (colour, intensity, direction — sun by day, moon by
│              night, crossfading at the horizon) + ambient level
└─ meta: phase name, isDaytime, timeOfDay, dayCounter
```

Consumers subscribe to the slices they care about:

- **The sky dome** (today's `Sky`) consumes `sky` + `sun`.
- **The environment map** consumes sky + sun + clouds (§9).
- **Scene lighting** consumes `light hints`. Decided (§11): the sky is the
  scene's **only key light** — the hardcoded `<T.DirectionalLight>` in
  `core/Camera.svelte` is replaced by a descriptor-driven light that follows
  the sun by day and the moon by night. The model itself still only
  *publishes*; a small consumer component applies the hints to the real light
  and owns the shadow configuration (game-specific, stays out of the
  descriptor). The baked `scene.environment` remains the ambient half, as
  today.
- **Gameplay** consumes `meta` + queries (`§8`).
- **Audio (optional, later)** — wind/rain layers crossfade off the descriptor.
  Probably its own extension; mentioned here only to justify `wind` being in
  the contract.

This is the seam that keeps the model testable: time + weather in, plain object
out, no renderer involved. It can be unit-tested, logged, scripted, or driven
by Studio with zero WebGPU in the room.

---

## 8. Engine API surface

What a game actually touches. Names are provisional; the shape is the point.

```ts
// ── time ───────────────────────────────────────────────
sky.setClock('realtime', { timeZone: 'Europe/Berlin' })
sky.setClock('external')            // game/server ticks time in
sky.setExternalTime(t, day?)        // feed the external clock
sky.setTimeScale(60)                // 1 game day per 24 min
sky.setTime(0.62)                   // manual scrub (Studio, cutscenes)
sky.freeze() / sky.unfreeze()

// ── weather ────────────────────────────────────────────
sky.setWeather('storm', { over: 30_000 })
sky.setWeather({ cloudCover: 0.9, fog: 0.4 })   // raw target, no name
sky.clearWeather({ over: 10_000 })

// ── queries (synchronous, for gameplay) ────────────────
sky.getSunElevation()               // degrees; below -18 = deep night
sky.getPhase()                      // 'night' | 'goldenHour' | ...
sky.isDaytime()
sky.getWeather()                    // current channel values

// ── events ─────────────────────────────────────────────
sky.on('sunrise', cb)
sky.on('phaseChange', cb)           // gameplay hooks: torches, enemy spawns
sky.on('weatherChanged', cb)
```

Design notes:

- **Queries are synchronous reads of derived state.** Gameplay in a frame loop
  must not await weather.
- **Events are a plain callback registry**, not stores — consistent with the
  runes-only, no-stores convention. Fired from the model tick, never from a
  renderer.
- **Everything is fire-and-forget idempotent.** Calling `setWeather('storm')`
  twice blends to the same place. No transition state machine for callers to
  trip over — the *mixer* has internal state; the *API* does not expose it.
- **Studio is just another caller.** The time scrubber calls `setTime`, the
  weather buttons call `setWeather`. No privileged path — which means the dev
  panel costs nothing to maintain and cannot drift from the real API.

---

## 9. Update budgets

A continuous sky is a performance contract problem, and it goes in the concept
because it shapes the architecture.

With time-driven parameters, sky values change **every frame**. But consumers
have wildly different costs, so updates are tiered:

| Tier | Cadence | Consumers |
|---|---|---|
| **Visual** | Every frame | Sky dome uniforms, sun position — cheap, must be smooth |
| **Lighting** | Every frame or every few | Scene light hints |
| **Environment map** | Throttled / on-significant-change | The baked cube map that lights the scene |
| **Gameplay/events** | On threshold crossing | Phase change, sunrise, weather targets reached |

The environment map is the trap. Today `Sky.svelte` re-bakes the env cube
whenever sky parameters change — correct for a static sky, ruinous for a moving
one (that's a re-bake per frame at 60× time scale). The model must treat env
updates as a **budget**: re-bake at most every N ms of wall time, or when the
sun has moved more than X degrees since the last bake, whichever comes first.
The descriptor stays fresh; the expensive derivative of it steps.

This is also why the one-way data flow matters: the renderer can make these
cost decisions locally without the model ever knowing what a cube camera is.

---

## 10. What happens to the current code

Mapping old → new. Nothing here is done in this doc; this is the plan of record
for where things land.

| Today | Becomes |
|---|---|
| `skyboxState` scalars (`turbidity`, `elevation`...) | Derived outputs of the atmosphere sampler — nobody sets them by hand |
| `SKY_PRESETS` (`dawn`/`day`/`sunset`/`night`...) | Keyframes on the day curve (they already are, semantically) |
| `cloudy`/`overcast`/"storm-ish" presets | Weather target vectors in the mixer |
| `transitionState` + preset-pair lerp machinery | Deleted — curve sampling and the weather mixer replace it |
| `starsState` (17 fields) | One number: star visibility in the descriptor. The star *renderer* is separate future work — `@threlte/extras`' `<Stars>` is a raw `ShaderMaterial` and cannot run on WebGPU (`webgpu-notes.md` §1); it needs a TSL point-sprite reimplementation |
| `environmentState` (env/cube texture modes) | Stays, orthogonal — a sky-driven env map is one mode among several |
| User presets in `localStorage` | Gone — authored keyframes/weather live in a committed file (the `graphics.json` story), Studio edits the live state and saves |
| `Sky.svelte` | A consumer of the descriptor's `sky` + `sun` slices; gains the env budget logic |
| Hardcoded `<T.DirectionalLight>` in `core/Camera.svelte` | Replaced by the descriptor-driven key light (sun/moon crossover) — and the light moves out of the camera component, where it never belonged |
| `SkyboxExtension.svelte` panel | Time scrubber + weather knobs + save-to-file — the best dev tool in the repo once it exists |

The 888-line `skybox.svelte.ts` dissolves into: a clock module, a day-curve
module, a weather mixer, a descriptor, and an index that wires them. Each is
small, pure, and independently testable.

---

## 11. Decisions

Resolved — v1 scope is now fixed:

| # | Question | Decision |
|---|---|---|
| 1 | Sun path | **Fixed arc.** A real solar model (latitude/season) can arrive later as an alternative path module; downstream reads only the derived direction |
| 2 | Moon | **In v1.** Mirrored fixed arc, configurable lag, default opposition = full moon. Phase rendering later, via the lag knob |
| 3 | Scene lighting | **The sky is the only key light.** A descriptor-driven light (sun → moon crossover) replaces the hardcoded one in `Camera.svelte`. The model publishes hints; a consumer component applies them and owns shadow config |
| 4 | Weather stacking | **Single mixer, last-writer-wins per channel** with blend durations |
| 5 | Config file | **New `weather.json`**, separate from `graphics.json` |
| 6 | Server schema | **One `environment` table** for time + weather |
| 7 | `t = 0` mapping | **Midnight, solar time** (unchallenged default). Timezones are the `realtime` clock's concern, not the model's |

Still open, none blocking:

- Moon **phase rendering** — the lag knob exists; shading the disc is render-layer work
- A **weather director** (autonomous weather goals for single-player) — the mixer is the hook; policy comes when a game wants it

---

## 12. Phasing (concept level)

Each phase leaves the app working. Concrete module-level detail is in §16.

1. **Time core.** Clock interface + `realtime`/`manual` clocks + day-curve
   sampling — sun and moon paths both derived from `t` — producing the sky
   parameter fields. The `Sky` component becomes a descriptor consumer, and
   the descriptor-driven key light replaces the hardcoded directional light in
   `Camera.svelte`. The sky now moves because time moves, and the shadows move
   with it.
2. **Weather mixer.** Channel targets + blending, modulating the day-curve
   output. First visible effects via parameters we already render (scattering,
   fog colour, star visibility, exposure) — weather you can *see* before any
   new renderer exists.
3. **Server adapter.** SpacetimeDB `environment` table + `external` clock sync
   + weather subscriptions. Multiplayer parity.
4. **New render layers.** Clouds, precipitation, lightning — the visually
   expensive half, each consuming descriptor slices. Needs its own WebGPU-native
   plan; sketched in §17, not designed here.
5. **Studio panel.** Time scrubber, weather buttons, keyframe editor, save to
   the committed file. The payoff for everything above.

Phases 1–2 are pure refactor plus concept — no new rendering, fully verifiable
in a browser. Phase 4 is where the real graphics work lives and should get its
own roadmap document.

---

## 13. Concept boundary

Everything above is the agreed model. It deliberately says nothing about three.js.
Two things remain genuinely undesigned and are **not** settled below either:

- **Render layers** — clouds, rain, lightning. Sketched in §17, not designed.
- **The server schema** — table shapes are proposed in §11 and finalized when
  phase 3 is actually planned.

---

# Implementation Plan

Everything from here down is the how. Concept above, code below.

---

## 14. Module layout

The 888-line `extensions/skybox/skybox.svelte.ts` dissolves into small, pure modules.
The model has **no Threlte and no three.js imports** — that is what makes it
unit-testable and what keeps it out of the reactive-loop traps.

```
src/core/sky/
  clock.ts          — Clock interface + realtime / external / manual clocks.
                      Pure: advance(dtMs) → { t, day }. No Svelte, no three.
  sunPath.ts        — t → sun direction (fixed arc, §3.3). Also moon, via the lag knob.
  dayCurve.ts       — Keyframe list + sampler. t → baseline sky params (§4).
                      Owns the interpolation rules: ease, lerpAngle, colour space.
  weatherMixer.ts   — Channel values + targets + per-channel easing (§5.3).
                      tick(dtMs) → current channel vector.
  phases.ts         — Sun elevation → phase name; threshold-crossing detection.
  descriptor.ts     — The frame descriptor type + the compose step:
                      (baseline, weather, sun, moon) → descriptor (§7).
  events.ts         — Plain callback registry (on / off / emit). Not stores.
  index.ts          — Wires the above into the `sky` façade of §8. The only
                      stateful module; everything it imports is pure.
```

Consumers (Threlte components, three.js) live separately:

```
src/core/
  Sky.svelte        — Exists. Becomes a descriptor consumer; gains the env budget (§15.2)
  SkyLight.svelte   — New. The descriptor-driven key light (§15.3)
  Skybox.svelte     — Exists. Keeps the env/cube texture mode switch, drops preset plumbing
```

### 14.1 The reactivity rule

**The descriptor is a plain mutable object, not `$state`.**

One task ticks the clock, samples the curve, mixes weather, and writes the descriptor
in place. Consumers read it inside their own tasks. Nothing is tracked, nothing
invalidates, no effect can loop. This is the direct application of `webgpu-notes.md`
§3 — and it is why the model is deliberately Svelte-free.

Only two things need to be reactive, because HTML overlays and the Studio panel read
them:

- `meta` — phase name, `isDaytime`, `t`, day counter. A tiny `$state` object written
  once per tick, and **only ever written**, never read by the writer.
- Authoring state — keyframes and weather definitions being edited in Studio. Read by
  the sampler, written by the panel. One direction.

Per-frame numeric values (sun elevation, cloud cover, fog density) must **not** be
`$state`. They change every frame; making them reactive would invalidate the whole
component tree 60 times a second.

---

## 15. Three.js specifics

### 15.1 The sky dome is already uniform-driven

`src/core/Sky.svelte` wraps three's `SkyMesh` and already writes uniforms:

```ts
sky.turbidity.value = turbidity;
sky.rayleigh.value = rayleigh;
sky.mieCoefficient.value = mieCoefficient;
sky.mieDirectionalG.value = mieDirectionalG;
sky.sunPosition.value.copy(sunPosition);
sky.showSunDisc.value = 0 | 1;
```

That is exactly the shape a per-frame sky needs — writing `.value` costs nothing and
triggers no recompile. **The dome needs no architectural change**, only a different
source for its numbers: descriptor slices instead of props off `skyboxState`.

The current component's `dirty`-flag `$effect` (which exists to avoid re-baking the
env map on every prop change) becomes unnecessary for the dome itself and is replaced
by the budget below.

`SkyMesh` has no moon. A moon disc is a separate small mesh or a TSL contribution to
the dome — deferred, per §11.

### 15.2 The environment map budget — the one real trap

`Sky.svelte` today re-bakes the env cube (`CubeCamera` → `CubeRenderTarget`) whenever
any sky parameter changes. That is correct for a static sky and **ruinous for a moving
one**: at 60× time scale it is a full cube re-bake every frame.

The budget, owned by the renderer and invisible to the model:

- Re-bake at most every `N` ms of wall time (start at ~250 ms), **or**
- when the sun direction has moved more than `X` degrees since the last bake
  (start at ~1°), whichever comes first.
- Always re-bake immediately on a discontinuity: manual time scrub, clock swap, or a
  weather target being set instantly.
- Keep the existing `showSunDisc.value = 0` trick around the bake — it avoids a
  blown-out hotspot baked into the ambient term.

Interpolating between the previous and current cube map would hide the stepping
entirely, but costs a second target and a blend. Not in v1; note it if banding shows.

### 15.3 The key light

`src/core/Camera.svelte:44` currently hardcodes a `<T.DirectionalLight>` at
`position={[0, 10, 0]}`, `intensity={Math.PI / 4}`, with a fixed ±20 shadow camera. It
is parented to nothing in particular and lives in the camera component, where it never
belonged.

It moves to `src/core/SkyLight.svelte`, which:

- reads the descriptor's `light hints` slice in a task and writes
  `light.position`, `light.color`, `light.intensity` directly on the three object;
- owns the shadow configuration, which stays **game-specific and out of the
  descriptor** — the model publishes direction and colour, not shadow-camera bounds;
- handles the sun→moon crossover as a single light whose colour and intensity
  crossfade, rather than two lights fighting.

The shadow camera bounds are currently a fixed ±20 box. With a light that tracks a
moving sun, that box needs to follow the camera or grow — otherwise shadows vanish at
low sun angles. Flagged, not solved here.

### 15.4 Star field

`@threlte/extras`' `<Stars>` is a raw `ShaderMaterial` and cannot render on WebGPU
(`webgpu-notes.md` §1). Stars are currently absent entirely. The descriptor already
carries a single `stars: visibility` number; the renderer behind it is a TSL
point-sprite field and is **separate work**, not part of phases 1–3.

---

## 16. Authored data and persistence

Day-curve keyframes and weather definitions are **authored data in a committed file**,
not code and not `localStorage`.

```jsonc
// src/config/weather.json
{
  "version": 1,
  "dayCurve": [ { "t": 0.0, "name": "night", "turbidity": 2, "rayleigh": 0.5, … }, … ],
  "weathers": { "storm": { "cloudCover": 1.0, "precipitation": 1.0, "wind": 0.8, … }, … }
}
```

- Imported directly (`import weatherConfig from '$config/weather.json'`) so it is
  bundled, type-checked, works in production, and needs no runtime fetch.
- `version` exists so a format change can migrate rather than crash.
- Committed to git — changing the look of dusk becomes a reviewable diff.

### 16.1 The Vite dev plugin

Studio edits live state; **Save as default** writes it to disk. This design was
specified for `graphics.json` and never built; it applies unchanged here, and
`post-processing.md` should reuse it rather than invent a second mechanism.

```ts
// vite/weatherConfig.ts
export const weatherConfig = (): Plugin => ({
  name: 'spaceplate:weather-config',
  apply: 'serve',                       // dev only; cannot exist in a prod build
  configureServer(server) {
    server.middlewares.use('/__weather-config', async (req, res) => {
      if (req.method !== 'POST') return res.end();
      const body = await readBody(req);
      // validate shape + version BEFORE touching disk
      writeFileSync(CONFIG_PATH, JSON.stringify(body, null, 2) + '\n');
      res.end('{"ok":true}');
    });
  }
});
```

Rules, because this writes to source:

- `apply: 'serve'` — the endpoint cannot exist in a production build.
- Validate before writing. A malformed POST must not corrupt a committed file.
- Write via temp file + rename, so an interrupted write cannot truncate the config.
- Emit 2-space indent and a trailing newline to match Prettier, so saving doesn't
  churn the diff.

Boot order: **file → localStorage override (dev only) → live edits.** `localStorage`
keeps its role as a dev scratchpad; the file is written only on an explicit Save.

Requires a `$config` alias in **both** `vite.config.ts` and `tsconfig.json`.

---

## 17. Render layers (phase 4 — sketch only)

Not designed. Recorded so the descriptor contract is understood to be the seam these
plug into, and so nobody assumes they are close.

| Layer | Consumes | Rough approach |
|---|---|---|
| Clouds | `clouds.cover/type`, `wind`, `sun` | Raymarched TSL volumetric, or a cheaper layered dome shader. The expensive one |
| Precipitation | `precipitation.type/intensity`, `wind` | GPU particles / instanced sprites, camera-anchored |
| Lightning | `lightning` events | Emissive flash + a transient light contribution |
| Moon disc | `moon.direction`, phase | Small billboard; phase from the sun–moon angle |
| Stars | `stars.visibility` | TSL point sprites (§15.4) |
| Audio | `wind`, `precipitation` | Crossfading layers; its own extension |

Each of these deserves its own plan when it is actually reached. Phase 4 should get a
separate document rather than growing this one.

---

## 18. Open implementation questions

Non-blocking, but they need answers before the phase they belong to:

1. **Where does the sky tick run?** ~~`core/tasks.ts` defines four ordered stages~~
   (that module no longer exists post-WebGPU migration). **Decided in phase 1:** a
   single driver task in `core/Skybox.svelte`, constrained `before: autoRenderTask`
   together with the consumer tasks (Sky's env-bake task, SkyLight's light task).
   Among tasks sharing a constraint the DAG falls back to registration order, and
   Skybox registers before its children, so the model ticks first.
2. **What happens to `skyboxState`'s scalars during the transition?** **Decided in
   phase 1:** nothing — `SkyboxExtension.svelte` is unregistered (its panel was
   already broken post-migration), so the scalars lost their last writer and simply
   went dark. The module stays on disk unused and is the starting point for the
   phase-5 Studio panel. No override layer needed.
3. **Env map and post-processing.** Once `post-processing.md`'s pipeline exists, the
   cube-camera bake runs inside a frame that also has a `RenderPipeline`. `CubeCamera.update()`
   saves and restores the active render target, so it *should* compose — unverified.
4. **Clock drift smoothing shape.** §6 mandates easing toward server time, never
   snapping, and never running backwards. The actual filter (fixed rate limit? PI
   controller?) is a phase-3 decision.
5. **Does `t` advance while the tab is hidden?** `requestAnimationFrame` stops when
   backgrounded. On return, a `realtime` clock should jump to true wall-clock time;
   an `external` clock should wait for the server. Both need an explicit
   discontinuity path — which is also an env-map re-bake trigger (§15.2).
