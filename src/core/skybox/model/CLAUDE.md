# Sky model (`src/core/skybox/model/`)

The pure model: clock → curve → mixer → **`descriptor`**. Import from
`'$core/skybox/model'` (barrel in `index.ts`); modules in here import each other
relatively, never through the barrel.

**Purity rule:** nothing in this folder imports three.js or Threlte — except
`sky.svelte.ts`, the only stateful module, which wires the pure parts into the façade
and owns `descriptor` / `skyMeta` / `skyActions` / `skyQueries`. That purity is what
keeps the model out of Svelte reactive cycles (the descriptor contract in
`../CLAUDE.md`) and unit-testable.

## The façade (`sky.svelte.ts`)

```ts
import { skyActions, skyQueries, skyMeta, on } from '$core/skybox/model';

skyActions.setClock('manual', { t: 0.75 });            // see clocks below
skyActions.setTimeScale(60);                           // 60x — 24 min/day
skyActions.setWeather('storm', { over: 30_000 });      // named target, 30 s blend
skyActions.setWeather({ fog: 0.9 }, { over: 0 });      // raw partial, snapped
skyActions.clearWeather({ over: 10_000 });
skyActions.freeze() / unfreeze();                      // pause scaled time only
skyQueries.getWeather();                               // live vector — read, never cache
skyQueries.getTime();                                  // { t, day }
on('sunrise', () => ...);                              // sunrise|sunset|phaseChange|weatherChanged
```

- `tick(deltaMs)` is called by exactly one task (Skybox.svelte's driver). Not public API
  for games.
- `consumeDiscontinuity()` — snaps (`over: 0`, clock jumps) set a flag; Sky's env-bake
  task consumes it to re-bake the cube map immediately.
- `skyMeta` is the `$state` mirror for HUD/panel use (t, day, phase, isDaytime, weather
  name, blending, all channels), epsilon-gated. Never a data path for renderers.

**Clocks** (`clock.ts`): `realtime` (wall clock, optional fixed UTC offset),
`external` (server-driven, phase 3), `manual`. Boot default: manual, frozen at the
`sunrise` keyframe (t 0.25) under the named `storm` weather — both are reproducible
from the panel, unlike the bespoke boot vector they replaced. `storm` is deliberately
the library's loudest entry, so every weather renderer (deck, rain, lens, wind, strike
scheduler) is live in the first frame; it is also the most expensive boot the engine
has, so a scene measuring its own budget should `clearWeather({ over: 0 })` first.
`t` is normalized `[0,1)` = midnight→midnight, **solar time** — 0.25 sunrise, 0.5 noon.
Timezones are the `realtime` clock's concern, never the model's.

**Sun/moon** (`sunPath.ts`): fixed arc from `t`; the moon walks the same arc a
**`moonLagAt`** behind. Downstream reads only the derived direction/elevation/azimuth
in `descriptor.sun` / `.moon`.

### The moon's lag IS its phase

One number carries both, because in this model they are the same fact: a lag of 0.5
puts the moon opposite the sun — fully lit **and** rising at sunset — and a lag of 0
puts it on the sun, unlit and up only by day. There is nothing to keep in sync.

The lag **advances** — `moonLag` is the seed at day zero, and `synodicDays`
(`DEFAULT_SYNODIC_DAYS` = 8) is how long a full new→full→new cycle takes. Eight, not
the real 29.53: the arc is already a gamey fixed one, and at the dev clock's 60× a
realistic month is twelve hours of play to see one phase change. Eight moves the phase
an eighth per night, which is visible from one night to the next.
`setPathOptions({ synodicDays: 29.53 })` buys the real thing; `0` pins the moon at
`moonLag` forever (the pre-cycle permanent full moon).

- `descriptor.moonPhase` is `{ age, illumination, waxing, name }`, all derived from the
  lag. `illumination` is `(1 - cos(2π·age))/2`; `name` is one of eight, bucketed with a
  half-bucket offset so `new`/`firstQuarter`/`full`/`lastQuarter` are **centred** on
  their exact ages rather than starting there.
- **Nothing here reaches the moon DISC.** `Moon.svelte` shades a sphere by the sun
  direction, so its terminator tracked the lag before the cycle existed and needed no
  change when it started moving. These scalars exist for the light model and gameplay.
- `skyActions.setMoonPhase(age)` is the write path: it rebases the **seed** by however
  far the clock has already carried it, so the cycle keeps running from there instead of
  pinning. It also moves the moon in the sky, necessarily — see above.
- `skyQueries.getMoonPhase()` returns the live object; `skyMeta.moonPhase` /
  `.moonIllumination` are the panel mirrors.

**Phases** (`phases.ts`): named phases are **derived thresholds on sun elevation**
(e.g. below −18° = night, −6°…0° = twilight), not presets — moonlight illuminates the
night, it does not redefine it. `noon` is keyed to the arc's peak (a narrow band
around the highest point — "above 20°" would swallow most of daylight), and symmetric
pairs (dawn/dusk, morning/afternoon) are separated by the rising/falling flag. They
exist for gameplay queries/events and as keyframe anchors for the day curve.

## Day curve (`dayCurve.ts`)

`DEFAULT_DAY_CURVE` — 12 keyframes (`night` → `astronomicalDusk`), each holding the
**baseline** sky only, never weather: turbidity, rayleigh, mie pair, exposure,
starVisibility, fogColor, fogDensity. Weather modulates on top; it never replaces the
baseline (a storm at noon is still noon under clouds).

Authoring notes that cost real debugging time:

- **Rayleigh is the sunrise/sunset colour knob, not turbidity.** Turbidity feeds mie,
  which is wavelength-flat — raising it grows a grey halo. The red comes from rayleigh
  _extinction_ along the horizon path.
- **`goldenMorning` / `goldenHour` (+6°) cannot be made golden** — Preetham's warm
  window is only ~0–2° of elevation. They are tuned merely to stop clipping; the colour
  lives at `sunrise`/`sunset` (0°).
- **`exposure` is renderer-global.** Never compensate a lighting change with it — it
  blows out the dome. It belongs to the dome's look only.
- **A blown-out daytime frame is usually bloom, not this curve.** Bloom runs on linear
  values _before_ exposure is applied, so dimming here scales halo and scene together
  and never changes the ratio. The sun disc is 60800 linear (`SkyMesh.js`) and the
  bloom mips smear it over the whole frame — bloom's `inputClamp` is what fences that
  off. The daylight keyframes still came down ~0.1 from their originals (0.58–0.66),
  but that part was a look choice.

## Weather (`weatherMixer.ts`)

**Eight channels**, each independent in `[0,1]`: `cloudCover` `cloudType` `fog`
`precipitation` `precipitationType` `wind` `windDirection` `lightning`. Most are
intensities (0 = none); two are **positions**:

- `precipitationType` — 0 = snow, 1 = rain, the band between is sleet. Authored to 1
  in every dry weather on purpose: a raw partial leaves unmentioned channels where they
  are, so `setWeather({ precipitation: 0.8 })` gives rain unless you say otherwise.
  **It only blends when precipitation is non-zero at BOTH ends of the transition** —
  otherwise the change is applied as a snap at whichever end is dry, where crossing the
  sleet band cannot be seen. Blending it regardless made `snow → clear` peak at
  `rainAmount` 0.26 under a heavy deck: the snow turned into a rain shower halfway
  through clearing. `rain ↔ snow` is wet at both ends and still crosses the band, which
  is what the band is for.
- `windDirection` — the wind's compass bearing, one full turn over `[0,1)`. Wraps: the
  mixer blends it along the **shorter arc** (crossing north, not the long way south).
  `windAxisX/Z` hand the vector to renderers; bearing 0 = +Z (the pre-channel default
  look). `wind` itself is an intensity: 0 = still, 1 = storm. Never remap it bipolar.

- Named weathers (`clear` `cloudy` `overcast` `fog` `rain` `storm` `snow` `blizzard`)
  are **target vectors** in `WEATHERS`, kept in code like the day curve; a raw partial is
  a first-class call, not an escape hatch. `storm` and `blizzard` are the two extremes —
  rain and snow respectively; `blizzard` leads on `fog` (0.8, a whiteout) rather than on
  precipitation.
- Blends run on **wall-clock ms** (`over`), default 20 s. `over: 0` snaps and counts as
  a discontinuity (immediate env re-bake).
- Per-weather `stagger` delays a channel's _onset_ as a fraction of the blend; all
  channels still finish together. That is what makes a storm _arrive_ rather than appear.

### cloudCover is authored against SkyMesh's look, not physics

SkyMesh's cloud mask is `smoothstep(1 - coverage, 1 - coverage + 0.3, fbm)`, so by ~0.5
the dome reads as a flat sheet. `overcast` is therefore **0.35** and ordering is
cloudy 0.25 < overcast 0.35 < rain 0.8 < snow 0.9 < storm 1.0 (the boot weather) =
blizzard 1.0.

### The key light reads `deckFactor`, never raw cover

- `deckFactor(cloudCover)` — `smooth01(DECK_THRESHOLD=0.4, 1, cover)`: exactly 0 below
  0.4 (scattered cloud leaves shadows alone), ramping to 1 only as the deck closes.
  `overcast` (0.35) keeps its shadows; the flat shadowless deck lives at `rain`+.
  Everything touching the key light goes through it — attenuation, ambient return,
  desaturation, night fills. The baseline modulation (haze, stars, fog density)
  deliberately uses raw cover; none of that touches shadows.
- `keyAttenuation(w)` = deck + fog attenuation of the key (`KEY_ATTENUATION` 0.85,
  `KEY_FOG_ATTENUATION` 0.7); `AMBIENT_RETURN` 0.45 puts the intercepted light back as
  fill, so overcast noon reads flat and bright, not dim.
- `bodyVisibility(w)` — how visible sun/moon discs are; harsher than light attenuation.

### Precipitation split

`rainShare(w)` = `smooth01(0.35, 0.65, precipitationType)`; `rainAmount`/`snowAmount`
multiply `precipitation` by the share and its complement, so intensity is conserved
across the sleet band. **One definition, three consumers** (Rain, Snow, RainLens) —
never re-derive the split in a layer.

## Light pipeline constants (in `sky.svelte.ts`)

- **`SUN_INTENSITY` (4.75) and `Sky.svelte`'s `environmentIntensity` (0.25) are ONE
  change.** The raw dome integrates to ~5.0 irradiance at noon vs the key's old 0.745,
  so unscaled the env map supplied 87% of every daylit frame. Move them together and
  re-measure; never compensate with the day curve's `exposure`.
- **`scene.environment` is black below −2.31° sun elevation** (SkyMesh zeroes its sun
  term). Night/twilight lighting comes from `SkyLight`'s hemisphere fill
  (`descriptor.light.ambient`), not the env map. Don't "fix" dark nights via the curve.
- `MOON_INTENSITY` (π/12) is an absolute playable level, not a fraction of the sun —
  it must not be "restored" to any ratio of `SUN_INTENSITY`.
- **The moon's key and fill both scale by `moonLight`**, one weight off
  `moonPhase.illumination` — a crescent throwing a full moon's shadows was the giveaway
  that the phase was cosmetic. `MOON_PHASE_FLOOR` (0.15) is what a new moon keeps, and
  it is a playability floor, not physics: real moonlight is a steep function of phase and
  would hand the player several unlit nights per cycle.
- Ambient fills: `DAY_AMBIENT` 0 (env map genuinely carries day), `MOON_AMBIENT` π/32,
  `TWILIGHT_AMBIENT` π/14 (dawn would otherwise measure darker than midnight — moon
  sets as sun rises), `NIGHT_AMBIENT` π/96.
- **`NIGHT_AMBIENT` exists because the moon phases.** Before the cycle the moon sat at
  opposition forever, so `MOON_AMBIENT` was up every night by construction. A cycling
  moon spends part of it new — unlit _and_ in the daytime sky — and on those nights the
  dome bakes black, the twilight hump has expired and the moon fill is at its floor,
  which is a frame nobody can navigate. It is `max()`'d in like the others, so a full
  moon is unchanged and only nights that had nothing gain anything. Its ramp is the
  exact complement of the twilight hump's rising half, so no gap opens at −18°.
- **`KEY_MIN_ELEVATION` (3°) floors the light's _aim_** so civil twilight does not light
  undersides and throw shadows upward.
- **Sun and moon are computed independently and combined with `max()`** — one shared
  `horizon` weight once handed over to the moon _and_ dimmed the sun, cutting a
  horizon sun to an eighth of peak and rendering warm keyframes cold. Now
  `sunShare = sunKey / (sunKey + moonKey)` is the single weight driving direction,
  colour and intensity, so they cannot disagree. The direction still flips at the
  handover (~−4.5°, ~8% of peak, colour/intensity continuous). **The synodic cycle now
  varies how large that flip is** — 180° at full, near zero at new — rather than making
  it worse: the flip shrinks toward the phases where the two bodies are close, and the
  handover already happens at 8% of peak. If it ever does become visible, fade the light
  out and back in; do not slerp between opposed vectors.
