# Sky & Weather System

Replacing the preset-based skybox with a time-driven sky and weather system.

**§1–§13 are the agreed concept** — the model, the API surface, the decisions.
**§14–§18 are the implementation plan** — module layout, three.js/WebGPU specifics,
and what actually gets written.

Companions: `post-processing.md` (the render pipeline this eventually feeds),
`scene-environment.md` (how a scene pins its own time and weather),
`webgpu-notes.md` (WebGPU and reactivity rules the implementation must obey).

**Status:** phases 1 and 2 are implemented. Time core, day curve, sun/moon paths, the
descriptor-driven key light, stars, moon, and now the weather mixer with its modulation
layer and scene fog all ship. Phase 3 (server adapter) is next; phase 4 (cloud,
precipitation and lightning render layers) and phase 5 (`weather.json` + keyframe
editor) are untouched. Open questions from the first draft are resolved in §11 (fixed
sun arc, moon in v1, sky as the scene's only key light, single weather mixer,
`weather.json`, one server `environment` table).

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
_points on the same day_. The rework makes that structural.

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

1. **Time** — _when is it_. A single source of truth for the current moment.
   Pluggable: local clock, server clock, manual scrub.
2. **Atmosphere** — _what the sky is like at that moment_. A pure function:
   time-of-day + weather → a frame descriptor of atmospheric parameters.
3. **Rendering** — _how it is drawn_. Sky dome, star field, clouds, fog,
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

| Clock      | What it does                                                                | Who uses it                                                                                       |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `realtime` | Follows the player's wall clock, optionally pinned to a timezone/UTC offset | "The sky outside my window" — the obvious pick for games that want it                             |
| `external` | Reads a value the game supplies each tick                                   | **Server time** (SpacetimeDB), scripted timelines, replays                                        |
| `manual`   | Fixed value, changed only when someone calls `setTime`                      | **Template default** (boots on a curated sunset) — Studio scrubber, cutscenes, screenshots, tests |

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

What the curve holds: the _baseline_ sky — scattering parameters, exposure, star
visibility, base fog colour. What it does **not** hold: weather (§5).

**Keyframe times are not free — they are the inverse of the sun arc.** This was learned
the hard way: the first curve was authored by eye and drifted badly from §3.3's arc. The
`sunrise` keyframe fired at **+9.4°** of sun elevation, `goldenHour` at **+23°**,
`sunset` at **−4.7°**, `dusk` at **−23°**. The sky's _look_ and the sun's _position_
disagreed by 20–30° of elevation, worst on the evening side — which reads as "the
day/night cycle feels off" without any single value being wrong.

Every keyframe is now pinned to the elevation milestone its name claims, via

```
t = 0.25 ± asin(elevation / maxElevation) / 2π      (− morning, + … see dayCurve.ts)
```

giving twelve keyframes: night (−75°), astronomicalDawn (−18°), dawn (−6°), sunrise (0°),
goldenMorning (+6°), morning (+44°), noon (+75°), afternoon (+44°), goldenHour (+6°),
sunset (0°), dusk (−6°), astronomicalDusk (−18°). The twilight keyframes cluster tightly
because twilight _is_ short on this arc.

The consequence: **the arc's peak elevation is part of the curve's contract.** Changing
`maxElevation` moves every twilight boundary and silently un-pins the curve. Keyframe
`t` and the arc peak must be retimed together — a Studio keyframe editor (phase 5) has
to either recompute `t` from a target elevation or refuse to edit the two independently.

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
light; weather _attenuates, adds, and obscures_. That composition — day curve
under weather, never instead of it — is what makes this a system rather than a
preset swap. An overcast sunset still reads as evening: dimmer, grey, but
evening.

### 5.2 Weather channels

Weather is a vector of independent **channels**, each with an intensity
`∈ [0, 1]` plus channel parameters:

| Channel         | Roughly governs                                      |
| --------------- | ---------------------------------------------------- |
| `cloudCover`    | Opacity/extent of the cloud layer                    |
| `cloudType`     | Cumulus / stratus / storm towers (blends)            |
| `fog`           | Fog/haze density and colour bias                     |
| `precipitation` | None / rain / snow, intensity                        |
| `wind`          | Speed + direction — drives clouds, particles, audio  |
| `lightning`     | Storm-cell flicker events                            |
| `special`       | Aurora, eclipse, blood moon — game-specific overlays |

Channels are independent: fog without rain, wind without clouds. A weather
_state_ is just a named target vector over these channels.

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

**As built** (`model/weatherMixer.ts`): `stagger` is a per-channel _fraction of the
blend duration_ to wait before that channel starts moving; every channel still finishes
together. Only the onset is staggered, so a blend has one end time and `blending` is one
boolean. Measured on `setWeather('storm', { over: 20_000 })`: cloud cover leads, wind
reaches half at 12 s, precipitation starts at 10 s, lightning at 14 s, everything lands
at 20 s.

A raw partial target leaves unmentioned channels **where they are** rather than
defaulting them — `setWeather({ fog: 0.9 })` is a fog call, not a whole-sky call.
`over: 0` snaps, and is treated as a discontinuity exactly like a time scrub, so the env
map re-bakes immediately instead of on the next interval.

Blend durations run on **wall-clock ms, not scaled game time**. `over: 30_000` means
thirty seconds the player experiences, whatever `timeScale` the day is running at.

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
  _publishes_; a small consumer component applies the hints to the real light
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
  trip over — the _mixer_ has internal state; the _API_ does not expose it.
- **Studio is just another caller.** The time scrubber calls `setTime`, the
  weather buttons call `setWeather`. No privileged path — which means the dev
  panel costs nothing to maintain and cannot drift from the real API.

---

## 9. Update budgets

A continuous sky is a performance contract problem, and it goes in the concept
because it shapes the architecture.

With time-driven parameters, sky values change **every frame**. But consumers
have wildly different costs, so updates are tiered:

| Tier                | Cadence                           | Consumers                                               |
| ------------------- | --------------------------------- | ------------------------------------------------------- |
| **Visual**          | Every frame                       | Sky dome uniforms, sun position — cheap, must be smooth |
| **Lighting**        | Every frame or every few          | Scene light hints                                       |
| **Environment map** | Throttled / on-significant-change | The baked cube map that lights the scene                |
| **Gameplay/events** | On threshold crossing             | Phase change, sunrise, weather targets reached          |

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

| Today                                                    | Becomes                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skyboxState` scalars (`turbidity`, `elevation`...)      | Derived outputs of the atmosphere sampler — nobody sets them by hand                                                                                                                                   |
| `SKY_PRESETS` (`dawn`/`day`/`sunset`/`night`...)         | Keyframes on the day curve (they already are, semantically)                                                                                                                                            |
| `cloudy`/`overcast`/"storm-ish" presets                  | Weather target vectors in the mixer                                                                                                                                                                    |
| `transitionState` + preset-pair lerp machinery           | Deleted — curve sampling and the weather mixer replace it                                                                                                                                              |
| `starsState` (17 fields)                                 | One number: star visibility in the descriptor, consumed by `core/skybox/Stars.svelte` (§15.4)                                                                                                          |
| `environmentState` (env/cube texture modes)              | Stays, orthogonal — a sky-driven env map is one mode among several                                                                                                                                     |
| User presets in `localStorage`                           | Gone — authored keyframes/weather live in a committed file (the `graphics.json` story), Studio edits the live state and saves                                                                          |
| `Sky.svelte`                                             | A consumer of the descriptor's `sky` + `sun` slices; gains the env budget logic                                                                                                                        |
| Hardcoded `<T.DirectionalLight>` in `core/Camera.svelte` | Replaced by the descriptor-driven key light (sun/moon crossover) — and the light moves out of the camera component, where it never belonged                                                            |
| `SkyboxExtension.svelte` panel                           | **Rewritten in phase 1** as the time + environment panel: clock scrubber, speed presets, jump buttons, env-mode switch. Weather buttons arrive with phase 2, keyframe editor + save-to-file in phase 5 |

The 888-line `skybox.svelte.ts` dissolves into: a clock module, a day-curve
module, a weather mixer, a descriptor, and an index that wires them. Each is
small, pure, and independently testable.

---

## 11. Decisions

Resolved — v1 scope is now fixed:

| #   | Question         | Decision                                                                                                                                                                                                               |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sun path         | **Fixed arc.** A real solar model (latitude/season) can arrive later as an alternative path module; downstream reads only the derived direction                                                                        |
| 2   | Moon             | **In v1.** Mirrored fixed arc, configurable lag, default opposition = full moon. Phase rendering later, via the lag knob                                                                                               |
| 3   | Scene lighting   | **The sky is the only key light.** A descriptor-driven light (sun → moon crossover) replaces the hardcoded one in `Camera.svelte`. The model publishes hints; a consumer component applies them and owns shadow config |
| 4   | Weather stacking | **Single mixer, last-writer-wins per channel** with blend durations                                                                                                                                                    |
| 5   | Config file      | **New `weather.json`**, separate from `graphics.json`                                                                                                                                                                  |
| 6   | Server schema    | **One `environment` table** for time + weather                                                                                                                                                                         |
| 7   | `t = 0` mapping  | **Midnight, solar time** (unchallenged default). Timezones are the `realtime` clock's concern, not the model's                                                                                                         |

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
   fog colour, star visibility, exposure) — weather you can _see_ before any
   new renderer exists. **Done**, plus the one renderer that had to come with it:
   `SkyFog` (§15.6), because "fog colour" was authored data nothing consumed.
3. **Server adapter.** SpacetimeDB `environment` table + `external` clock sync
   - weather subscriptions. Multiplayer parity.
4. **New render layers.** Clouds, precipitation, lightning — the visually
   expensive half, each consuming descriptor slices. Needs its own WebGPU-native
   plan; sketched in §17, not designed here.
5. **Studio panel.** Weather buttons, keyframe editor, save to the committed
   file. The time scrubber was pulled into phase 1 — the panel already drives
   the clock through the same engine API a game uses.

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

Everything sky/skybox/weather lives in one home: `src/core/skybox/`. Consumers at
the top, the pure model in `model/`. The model has **no Threlte and no three.js
imports** — that is what makes it unit-testable and what keeps it out of the
reactive-loop traps.

```
src/core/skybox/
  Sky.svelte        — The dome: descriptor consumer, owns the env bake budget (§15.2)
  SkyLight.svelte   — The descriptor-driven key light, sun→moon crossover (§15.3)
  Stars.svelte      — TSL billboard star field, driven by starVisibility (§15.4)
  Moon.svelte       — Phase-shaded moon sphere, driven by moonLag (§15.5)
  Skybox.svelte     — Mount + THE driver task + env/cube texture mode switch
  model/
    clock.ts        — Clock interface + realtime / external / manual clocks.
                      Pure: advance(dtMs) → { t, day }. No Svelte, no three.
    sunPath.ts      — t → sun direction (fixed arc, §3.3). Also moon, via the lag knob.
    dayCurve.ts     — Keyframe list + sampler. t → baseline sky params (§4).
                      Owns the interpolation rules: ease, lerpAngle, colour space.
    weatherMixer.ts — Channel values + targets + per-channel easing (§5.3). Phase 2.
                      tick(dtMs) → current channel vector.
    phases.ts       — Sun elevation → phase name; threshold-crossing detection.
    types.ts        — The frame descriptor type (§7) + all model types.
    events.ts       — Plain callback registry (on / off / emit). Not stores.
    sky.svelte.ts   — Wires the above into the `sky` façade of §8. The only
                      stateful module; everything it imports is pure.
    index.ts        — Barrel: import from '$core/skybox/model'.
```

Weather render layers (phase 4) will land here too, e.g. `skybox/layers/`.

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

`skybox/Sky.svelte` wraps three's `SkyMesh` and already writes uniforms:

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

**Rayleigh is the sunrise colour knob. Turbidity is not.** This is the single easiest
value in the curve to author backwards, and the first pass did. Turbidity feeds `vBetaM`,
and mie scattering is nearly wavelength-flat, so raising it grows a big **grey** halo —
measured, `sunrise` at turbidity 9 / rayleigh 2.8 produced a glow band of
`rgb(131,122,131)` at saturation **0.14**. A colourless sunrise. The red comes from
rayleigh **extinction** along the long horizon path (`Fex`): blue scatters out of the line
of sight and red survives. Rayleigh 5 at the same keyframe:

| view elevation | turbidity 9 / rayleigh 2.8 | turbidity 6 / rayleigh 5 |
| -------------- | -------------------------- | ------------------------ |
| +12°           | `rgb(182,185,198)`         | `rgb(161,133,108)`       |
| +6°            | `rgb(213,204,206)`         | `rgb(190,126,99)`        |
| +2°            | `rgb(220,174,167)`         | `rgb(164,56,47)`         |
| 0°             | `rgb(203,102,97)`          | `rgb(72,2,3)`            |
| −15°           | `rgb(129,28,22)`           | `rgb(19,0,0)`            |

Turbidity still controls how large and bright the halo is, so it comes down alongside.
Note the last row: SkyMesh clamps `zenithAngle = acos(max(0, dot(up, dir)))`, so the whole
**below-horizon** half of the dome renders at the horizon's optical depth with the sun's
forward-scatter still applied. With no ground in the scene that was a bright warm smear
filling the lower half of frame; rayleigh collapses it.

**Preetham's warm window is only ~0–2° of sun elevation, and no uniform widens it.** The
redness rides the `mix(1, sqrt(vSunE * ratio * Fex), pow(1 - sunDir.y, 5))` term, whose
weight is 1.0 at the horizon and already 0.57 by +6°. Measured on an R-minus-B scale over
the sun-side sky, sweeping rayleigh 2.8 → 6 at every sun elevation:

| sun elevation | warm (R−B) | clipped |
| ------------- | ---------- | ------- |
| 0°            | +0.06      | 0%      |
| 2°            | −0.05      | 0%      |
| 6°            | −0.36      | 20%     |
| 14°           | −0.65      | 100%    |

So the `goldenMorning` / `goldenHour` keyframes at **+6° are not golden and cannot be made
so** — they render blue, and at the original exposure 0.72 six of eight sampled elevations
were past white, i.e. a flat sheet with no gradient in it. They are retuned only to stop
clipping (5–6 of 8, which is where the curve flattens; lower exposure buys nothing and
only costs the scene). The golden look lives on `sunrise` / `sunset`. Don't spend an
afternoon tuning +6°.

None of this touches scene lighting — with the env map at 0.25 the key dominates, and
ground and sun-facing surfaces measure identical across the whole rayleigh sweep.

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

**The env map is black whenever the sun is down, and no setting changes that.** SkyMesh
zeroes its sun term outright once the sun passes **2.31°** below the horizon:

```js
const cutoffAngle = float( 1.6110731556870734 );   // pi / 1.95 = 92.31 degrees
const sunIntensity = EE.mul( max( 0.0, ... ) );    // -> exactly 0 below the cutoff
```

With `vSunE = 0` the whole dome collapses to `0.1 * Fex * 0.04 + vec3(0, 0.0003,
0.00075)` — a hard ceiling around **0.005 linear luminance**. Turbidity and rayleigh
cannot lift it; raising rayleigh actually makes it _darker_, since it only increases
extinction against that fixed night term.

**The dome must be scaled before it is used as an IBL — `scene.environmentIntensity`.**
SkyMesh's output is authored to be looked _at_ under a tone-mapping exposure, and its
absolute scale (`EE = 1000`, then `* 0.04`) is arbitrary. Fed to `scene.environment` raw
it buries the key light. Measured by integrating the dome's radiance against a cosine
lobe — the quantity three's `getIBLIrradiance` returns — for an up-facing normal under a
clear sky:

| time      | sky irradiance | key light | key's share of the light on flat ground |
| --------- | -------------- | --------- | --------------------------------------- |
| sunrise   | 0.121          | 0.003     | 2.8%                                    |
| golden am | 1.204          | 0.021     | 1.7%                                    |
| morning   | 4.454          | 0.528     | 10.6%                                   |
| noon      | 5.031          | 0.745     | 12.9%                                   |

A noon shadow therefore rendered `rgb(102,136,223)` against a lit `rgb(111,141,225)` — a
4% difference, i.e. **no directional lighting in the scene at any hour** — plus a heavy
blue cast, since noon irradiance was `[1.78, 5.19, 13.08]`, a 7:1 blue:red.

`Sky.svelte`'s `environmentIntensity` (default **0.25**) fixes the ratio, and
`SUN_INTENSITY` (π/4 → **4.75**) absorbs the daylight the env map stops delivering.
**They are one change and must move together.** With both: scene brightness stays within
0.88–0.97× of the old look through the whole day, a sun-facing surface gets 1.2–1.6×
brighter, shadow-over-lit falls from 0.96 to 0.29, and night is untouched at 0.94×
(the env map contributes ~5% there, so the moon and fill constants do not scale).

**Do not compensate with the day curve's `exposure` instead.** It is renderer-global, so
it drags the dome up with the scene — and at the current 0.78 the noon horizon already
tone-maps past white. Solving the rebase that way needed +2.4 stops and blew out the sky.

Two further consequences, both load-bearing:

1. §7's "the baked `scene.environment` remains the ambient half" is **true by day only**.
   At night the cube bakes black and the scene has exactly one light. That is why the
   descriptor's `light.ambient` is now delivered by a real light (§15.3) rather than
   left as a hint nobody consumed.
2. **The twilight keyframes never render their authored look.** `dawn` and `dusk` at −6°,
   and both astronomical keyframes at −18°, are all below the cutoff — their turbidity
   and rayleigh values shape nothing, because the sun term feeding them is zero. Their
   `exposure` and the fill light are the only levers that do anything down there. Worth
   knowing before anyone spends an afternoon tuning blue-hour scattering that cannot
   render.

### 15.3 The key light

`src/core/Camera.svelte:44` currently hardcodes a `<T.DirectionalLight>` at
`position={[0, 10, 0]}`, `intensity={Math.PI / 4}`, with a fixed ±20 shadow camera. It
is parented to nothing in particular and lives in the camera component, where it never
belonged.

It moves to `skybox/SkyLight.svelte`, which:

- reads the descriptor's `light hints` slice in a task and writes
  `light.position`, `light.color`, `light.intensity` directly on the three object;
- owns the shadow configuration, which stays **game-specific and out of the
  descriptor** — the model publishes direction and colour, not shadow-camera bounds;
- handles the sun→moon crossover as a single light whose colour and intensity
  crossfade, rather than two lights fighting.

**The key light must never aim below the horizon.** The intensity crossfade band runs
from −6° to +6°, so between −6° and 0° the _sun_ still drives the light while sitting
underground — which lights every underside in the scene and throws its shadow upward.
The model clamps the elevation used to aim the light to a 3° floor (`KEY_MIN_ELEVATION`),
so civil twilight becomes raking horizontal light. That is also physically the right
answer: at that point you are lit by the sky, not by the sun.

**The sun and the moon are computed independently and combined with `max()`.** They were
lerped across one shared weight, `horizon = clamp01((elevation + 6) / 12)`, and that one
factor was doing two unrelated jobs: handing over to the moon _and_ dimming the sun. At
elevation 0 it sits at 0.5, so a sun sitting exactly on the horizon was cut to its 0.25
strength floor and then **halved again** — an eighth of peak. Measured, the key delivered
2.8% of the light reaching flat ground at sunrise and 1.7% at golden hour, so the warm
raking light both keyframes are authored for did not exist. The same weight also made the
light 50% moon-blue at sunrise, rendering a warm keyframe cold.

Now: `sunSet = clamp01((elevation + 6) / 6)` is the sun's own extinction across its last
six degrees and nothing else; `sunShare = sunKey / (sunKey + moonKey)` is the single
weight driving direction, colour **and** intensity, so they cannot disagree.

The direction still flips 180° at the handover, because interpolating between two opposed
vectors is undefined and the moon is at opposition by default. The flip now lands near
**−4.5°** of sun elevation at ~8% of daytime peak, with colour and intensity continuous
across it. If a moon lag other than opposition ever makes it visible, the fix is to fade
the light out and back in across the handover, not to slerp.

Note `KEY_MIN_ELEVATION` deliberately does **not** prop up flat ground at sunrise:
`dot(n, l)` on a horizontal surface under a 3° light is 0.05, so the ground goes dark and
the vertical faces take the light. That is what a low sun does, and it is why flat ground
measures 0.36× its old brightness at sunrise while a sun-facing surface goes from
`rgb(7,6,13)` to `rgb(69,49,51)`.

The shadow camera bounds are currently a fixed ±20 box. With a light that tracks a
moving sun, that box needs to follow the camera or grow — otherwise shadows vanish at
low sun angles. Flagged, not solved here.

**`SkyLight` mounts two lights, not one.** The directional key, plus a
`HemisphereLight` driving the descriptor's `light.ambient`. The ambient half is not
optional: because the env map bakes black below −2.31° of sun elevation (§15.2), a
night scene with only the key light leaves every surface facing away from the moon at
_exactly zero_. Measured against a noon-lit surface:

|                   | lit side | shadow side |
| ----------------- | -------- | ----------- |
| midnight, before  | 7.2%     | **0.0%**    |
| midnight, after   | 36.4%    | 9.9%        |
| civil dawn, after | 22.4%    | 14.7%       |
| noon              | 100%     | 0%          |

That table counts the **lights only**. Its "noon, shadow 0%" row is what made the env-map
problem above easy to miss: the directional light really does contribute nothing to a
shadowed surface, but `scene.environment` was contributing 87% of the frame's light and
was not in the measurement. Read it alongside the irradiance table in §15.2.

(Percentages are relative to noon, so they moved once daytime exposure came down — the
absolute night values did not change.)

`light.ambient` combines a moonlight term and a twilight term with `max()`, not a sum —
they are alternatives, so whichever is doing the lighting wins and the other fading out
never claws brightness off it. The daytime term is deliberately **zero**: the env map
genuinely does carry daylight, and an earlier version that faded to a small daytime
value brightened noon by 10%, changing a look nobody asked to change.

### 15.4 Star field — built, and _not_ point sprites

`@threlte/extras`' `<Stars>` is a raw `ShaderMaterial` and cannot render on WebGPU
(`webgpu-notes.md` §1). The replacement is `core/skybox/Stars.svelte`, driven by the
day curve's `starVisibility`.

Earlier drafts of this doc called for "TSL point sprites". **That is not possible.**
`THREE.Points` + `PointsNodeMaterial.sizeNode` compiles and renders on WebGPU with every
point clamped to one pixel and `sizeNode` silently ignored — WGSL has no `gl_PointSize`.
Three's own source says so outright (quoted in `webgpu-notes.md` §1.1).

So the field is **billboarded quads**: four vertices per star, offset in view space
inside the TSL vertex node, one draw call. Since every star sits at the same radius, a
fixed view-space offset is a fixed _angular_ size, so no per-vertex distance maths is
needed. 2200 stars ≈ 395 KB and one draw call; on-screen sizes run 1.8–7.6 px at fov 60.

Two details that are load-bearing rather than cosmetic:

- **Depth is pinned to the far plane** (`clip.z = clip.w`), exactly as `SkyMesh` does
  internally. The camera's far plane is **144** while the dome sits at radius 1000 — an
  honestly-projected star field would be clipped away in its entirety. Pinning also puts
  the field behind all scene geometry for free. The same applies to the moon.
- **`frustumCulled={false}`** on both. The moon's bounding sphere sits 1000 units out,
  entirely beyond the far plane, so three would cull it before it ever drew.

### 15.5 The moon disc

`core/skybox/Moon.svelte`. §17 sketched a billboard with "phase from the sun–moon
angle"; it is a **sphere** instead, because that is barely more work and strictly
better — the phase falls out of the surface normal, and an equirectangular moon map
wraps it properly rather than being cropped to a disc.

The lit term is `smoothstep(-0.08, 0.28, dot(surfaceNormal, sunDirection))`, so the
phase is driven entirely by the `moonLag` knob that §3.4 already specified. Measured
illuminated fraction of the disc:

| `moonLag`     | lit | phase          |
| ------------- | --- | -------------- |
| 0.5 (default) | 97% | full           |
| 0.375         | 86% | waning gibbous |
| 0.25          | 45% | quarter        |
| 0.125         | 7%  | crescent       |
| 0.0           | 0%  | new            |

The normal is rebuilt from `positionWorld` minus a moon-centre uniform rather than read
from `normalWorld`, so it cannot be disturbed by the custom vertex node. The sphere is
tidally locked with `lookAt(0,0,0)` plus a `geometry.rotateY(-π/2)` — `SphereGeometry`
puts uv (0.5, 0.5) on +X, and `Object3D.lookAt` aims **+Z** for a non-camera object.
Without the lock the moon appears to spin as it crosses the sky.

Neither layer reaches the environment map: `Sky.svelte` bakes by passing the dome mesh
alone to `CubeCamera.update()`, so the moon never burns a hotspot into the ambient term
the way the sun disc would.

### 15.6 Scene fog — the consumer the day curve was waiting for

`fogColor` and `fogDensity` were authored on all twelve keyframes in phase 1 and **nothing
consumed them**. There was no `scene.fog` anywhere in the repo, so a `fog` or `storm`
target had nothing to show for itself at ground level. `core/skybox/SkyFog.svelte` is
that consumer.

It works on WebGPU, and the mechanism dictates the implementation. Three's
`NodeManager.updateFog()` converts `scene.fog` into a `fog()` node, binding colour and
density through `reference()` — so **mutating the instance every frame is a uniform write
and costs nothing**. But it caches that node against the fog _object's identity_
(`sceneData.fog !== sceneFog`), so assigning a new `FogExp2` rebuilds the node and
invalidates every material's cache key. One instance, created at mount, mutated forever.

Two consequences that are not optional:

- **Every sky layer sets `material.fog = false`** — the dome, Stars, Nebula, Meteors and
  the Moon. They sit at radius 1000 while fog is tuned for a 144-unit far plane, so any
  density at all resolves the entire sky to a flat fog colour. The sky is what the fog is
  a haze _toward_, never something the fog is applied to. That is precisely why the day
  curve authors a per-keyframe `fogColor` in the first place.
- **The curve's densities are a shape, not a magnitude.** Taken raw, sunset's authored
  0.038 puts 44% fog at 20 world units on a _clear_ evening. `SkyFog`'s `densityScale`
  (default 0.5) is the world-scale knob, and it belongs in the component for the same
  reason `SkyLight` owns its shadow bounds: it depends on the game's world scale, not on
  the sky. At 0.5 a clear noon fades 18% at 60 units — honest aerial perspective — while
  `fog` still white-outs to 76% at 20 units.

Colours are read as **sRGB**, not working-space linear: the curve's fog colours are
authored by eye, so `[0.7, 0.78, 0.9]` has to mean the pale blue it looks like.

Fog is mounted only in procedural-sky mode. An HDR or cubemap environment brings its own
horizon colour and the day curve's would fight it.

### 15.7 Wind cannot drive `SkyMesh.cloudSpeed`

The obvious phase-2 win — bind the `wind` channel to `cloudSpeed` — **does not work**, and
the reason generalizes to phase 4.

`SkyMesh` scrolls its cloud plane with `cloudUV += time * cloudSpeed`, so the offset is
proportional to _absolute elapsed time_. Changing the speed teleports the pattern by
`elapsed × Δspeed`: a barely visible hitch a few seconds into a session, a total scramble
of the sky an hour in. There is no offset uniform to compensate with.

Cloud motion driven by wind therefore needs a layer that accumulates its own offset,
which is phase 4's problem. `wind` ships as a published, blended channel with no renderer
— as do `precipitation`, `cloudType` and `lightning`.

### 15.8 The modulation, measured

`modulateBaseline()` applies the channel vector over the sampled baseline in place. Three
of its rules are the ones worth knowing, because each was a wrong first guess:

- **Rayleigh goes DOWN under cover, not up.** An overcast sky is not a bluer sky, it is a
  greyer one. Turbidity and mie rise; the blue-scattering term falls. Raising all three
  together is the classic mistake and produces a vivid, saturated storm.
- **Exposure barely moves** (−8% at full cover). Almost all of an overcast day's
  darkening is the key light losing its throw. Doing both at full strength double-counts
  and crushes an overcast noon into dusk.
- **The fog-colour lift is gated on luminance.** Fog desaturates toward the baseline's own
  luminance, darkens under a deck, and lifts toward white as fog thickens — so storm comes
  out dark grey and fog comes out a bright white-out, from the same expression and with no
  per-weather colour table. Ungated, the lift made a midnight storm 0.11 grey against the
  clear night's 0.02: fog glowing brighter than the sky above it.

The key light takes its cut at the very end of `compose`, in one expression
(`keyAttenuation`), so every constant in §15.3 still means what it says under a clear sky.
Full cover removes 85% of the key; **45% of what was removed comes back as ambient fill**
(`AMBIENT_RETURN`). That second half is what keeps strong attenuation from meaning "dark":
the deck intercepts the light, it does not destroy it, so overcast reads flat and bright
rather than dim.

**The light reads a deck factor, never raw cover** (`deckFactor`, `DECK_THRESHOLD = 0.4`).
The first implementation scaled linearly with `cloudCover` and that was a straightforward
bug, not a tuning choice: the sky boots at a non-zero `cloudCover`, so every scene silently
lost 31% of its key light and gained 0.111 of fill before anything called `setWeather`.
Washed-out shadows in the default scene were the visible symptom.

It is also wrong physically. A directional light models the sun as permanently visible;
37% cover means the sun is _intermittently_ occluded, which one directional light cannot
represent and which, at ground level, looks like a sunny day with clouds in it. Cover only
starts behaving like a diffuser once it closes into a layer. So `deckFactor` smoothsteps
from 0.4 to 1.0 — exactly zero below the threshold, full only at solid cover — and
everything touching the key light goes through it: attenuation, the ambient return, the
colour desaturation, and the night fills. The baseline modulation above deliberately does
_not_: thin cloud genuinely adds haze and hides stars, and none of that touches shadows.

Measured, against a clear noon at 100%:

|                        | deck | key   | fill  | key/fill  | total |
| ---------------------- | ---- | ----- | ----- | --------- | ----- |
| **boot / clear**, noon | 0.00 | 0.785 | 0.000 | ∞ (crisp) | 100%  |
| cloudy, noon           | 0.02 | 0.745 | 0.018 | 41.2      | 97%   |
| fog, noon              | 0.00 | 0.318 | 0.210 | 1.51      | 67%   |
| rain, noon             | 0.74 | 0.230 | 0.250 | **0.92**  | 61%   |
| overcast, noon         | 0.84 | 0.194 | 0.266 | **0.73**  | 59%   |
| storm, noon            | 1.00 | 0.089 | 0.313 | **0.28**  | 51%   |
| clear, midnight        | 0.00 | 0.262 | 0.098 | 2.67      | 46%   |
| storm, midnight        | 1.00 | 0.030 | 0.114 | 0.26      | 18%   |

Once the ratio drops below 1 the fill exceeds the key and the scene is effectively
shadowless, which is what overcast _is_. Note the last two rows: the night fills are also
scaled by the deck, because a real layer blocks moonlight and twilight too. Without that, a
storm at midnight came out brighter than the clear sky it replaced.

`fog` keeps its shadows on purpose (ratio 1.51): it carries only 0.3 cover, so it is ground
mist under a clear sky, and sunbeams throwing shadows through morning fog is the correct
answer rather than a missed case.

**The boot default is byte-for-byte the phase-1 look** — verified equal to four decimal
places on key and fill at midnight, sunrise, noon and sunset. `clear` is identical to it.
The appearance nobody asked to change does not change until weather arrives.

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
	apply: 'serve', // dev only; cannot exist in a prod build
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

| Layer         | Consumes                               | Rough approach                                         | Status                              |
| ------------- | -------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| Clouds        | `clouds.cover/type`, `wind`, `sun`     | **See below — SkyMesh already ships one**              | cover bound; type/wind open (§15.7) |
| Fog           | `fog`, `sky.fogColor/fogDensity`       | `scene.fog` as a mutated `FogExp2` (§15.6)             | **done**                            |
| Precipitation | `precipitation.type/intensity`, `wind` | GPU particles / instanced sprites, camera-anchored     | not started                         |
| Lightning     | `lightning` events                     | Emissive flash + a transient light contribution        | not started                         |
| Moon disc     | `moon.direction`, phase                | Textured sphere, phase from the surface normal (§15.5) | **done**                            |
| Stars         | `stars.visibility`                     | Billboarded TSL quads, _not_ point sprites (§15.4)     | **done**                            |
| Audio         | `wind`, `precipitation`                | Crossfading layers; its own extension                  | not started                         |

**SkyMesh already has a procedural cloud layer, and it was on by default.** three
0.185.1's `SkyMesh` exposes `cloudCoverage` / `cloudDensity` / `cloudScale` /
`cloudSpeed` / `cloudElevation` uniforms, with `cloudCoverage` defaulting to **0.4**.
Nothing in this repo ever set it, so the sky was rendering unmanaged fbm clouds that
responded to neither time nor weather — and they were being baked into the environment
map along with everything else.

`Sky.svelte` now binds `cloudCoverage` to `descriptor.weather.cloudCover`, which hands
phase 2 a working cloud channel for free. Coverage is the only one that is weather —
`cloudDensity` (0.64) and `cloudElevation` (0.71) are authored look and live as props on
`Sky.svelte`. The boot value is `cloudCover: 0.2`; note that this is the _default_
channel vector, not the named `clear` weather, which targets 0.

**Coverage saturates early, and that sets the whole channel's scale.** The mask is
`smoothstep(1 - coverage, 1 - coverage + 0.3, fbm)`, so by roughly 0.5 almost all of the
noise has passed the threshold and the dome reads as a flat sheet rather than as cloud.
`cloudCover` values are therefore authored against how SkyMesh _looks_, not as a physical
fraction of sky covered: `overcast` is **0.35**, which is where the sky actually reads as
overcast.

That has a consequence for the light. 0.35 is below `DECK_THRESHOLD` (§15.8), so `overcast`
does not attenuate the key light and keeps its shadows; the flat, shadowless deck now lives
at `rain` (0.8) and above. The full ordering is boot 0.2 < cloudy 0.25 < overcast 0.35 <
rain 0.8 < snow 0.9 < storm 1.0 — note the gap, and the sharp change in feel across it. If
phase 4 replaces the fbm layer with something whose coverage is linear, these numbers get
re-authored and the gap closes.

This substantially shrinks phase 4's cloud task: the question is no longer "write a
volumetric cloud system" but "is the built-in fbm layer good enough, and what do
`cloudType` / `wind` map onto?" — worth answering before anyone starts raymarching.
`cloudScale` and `cloudSpeed` are still at SkyMesh defaults and are the obvious targets
for the `wind` channel.

Each remaining layer deserves its own plan when it is actually reached. Phase 4 should
get a separate document rather than growing this one.

---

## 18. Open implementation questions

Non-blocking, but they need answers before the phase they belong to:

1. **Where does the sky tick run?** `core/utils/tasks.ts` still defines its four ordered
   stages, but the sky deliberately does not use them — a stage would tie the tick to
   `useGameTasks()` callers. **Decided in phase 1:** a single driver task in
   `core/skybox/Skybox.svelte`, constrained `before: autoRenderTask`
   together with the consumer tasks (Sky's env-bake task, SkyLight's light task).
   Among tasks sharing a constraint the DAG falls back to registration order, and
   Skybox registers before its children, so the model ticks first.
2. **What happens to `skyboxState`'s scalars during the transition?** Superseded:
   the extension was rewritten rather than left dormant. The preset layer was
   deleted outright (the panel was unregistered anyway, so nothing regressed),
   `skybox.svelte.ts` shrank to the environment-mode state, and the panel became
   the time + environment control surface. No override layer ever existed.
3. **Env map and post-processing.** Once `post-processing.md`'s pipeline exists, the
   cube-camera bake runs inside a frame that also has a `RenderPipeline`. `CubeCamera.update()`
   saves and restores the active render target, so it _should_ compose — unverified.
4. **Clock drift smoothing shape.** §6 mandates easing toward server time, never
   snapping, and never running backwards. The actual filter (fixed rate limit? PI
   controller?) is a phase-3 decision.
5. **Does `t` advance while the tab is hidden?** `requestAnimationFrame` stops when
   backgrounded. On return, a `realtime` clock should jump to true wall-clock time;
   an `external` clock should wait for the server. Both need an explicit
   discontinuity path — which is also an env-map re-bake trigger (§15.2).
