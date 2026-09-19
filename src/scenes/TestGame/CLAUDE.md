# TestGame (`src/scenes/TestGame/`)

A standalone tech demo game: drivable cars (GR86, Audi RS3 Sportback, Nissan Pulsar
GTI-R — pick from the Garage) on a small race track, on top of the engine
(Threlte/Rapier/sky/on-demand rendering) but **not part of it**. Nothing here is
engine architecture — do not generalise from this code into `core/` or
`extensions/`, and keep engine docs free of TestGame specifics. The scene pair is
`TestGame.svelte` (3D) + `TestGameHud.svelte` (overlay), mounted like any other
scene via `Scene.svelte` / `SceneHud.svelte`.

```
TestGame.svelte         — the scene: world + car composition + the physics-task
                         shell; the driving model itself is sim/controller.ts,
                         the map is world/Track.svelte
PaintShop.svelte        — the paint shop: a TOP BAR (no backdrop, world stays
                         interactive) — order-sheet swatches + finish chips
                         (solid/metallic/pearl/shift, factory finish resets on
                         colour select), selection applies live
Garage.svelte           — the change-car shop: a TOP BAR, same shape as
                         PaintShop — one card per CARS entry showing exactly
                         what's in its spec (power/torque/weight/top speed/
                         gear count/layout, nothing invented here). Picking a
                         car writes carGarage.currentId; Scene.svelte keys the
                         TestGame mount on that id, so the pick REMOUNTS the
                         scene fresh against the new spec (garage.svelte.ts's
                         header) — the same rebuild a scene re-entry does
TestGameHud.svelte      — HUD shell (controls hint, back-to-menu, restart) + the
                         upper-middle launch flash (STREET / JUICY / PERFECT) +
                         the bottom-left `.corner` column, which is what ANCHORS
                         the minimap and the debug readout (neither positions
                         itself — they share that corner)
cars/                   — THE GARAGE: everything car-specific is data here
  types.ts              — CarSpec: the contract (hardware/suspension/geometry/
                         model/audio/cluster/tunes + layout 'rwd'|'fwd'|'awd')
  gr86.ts               — the GR86 spec: real-car hardware, measured geometry,
                         the two tunes (values + inline comments = source of truth)
  rs3.ts                — the Audi RS3 Sportback spec (AWD, 6-speed as given):
                         real headline numbers (power/torque/0-60/top speed/
                         weight), everything else researched the same way;
                         geometry MEASURED off its GLB, which — unlike the
                         GR86's — needed its wheel assembly's four separate
                         materials (tire/brake/disk/hub) RENAMED at the asset
                         level to share one prefix (see its own header).
                         Grip-only — see its `tunes` comment
  gtir.ts               — the Nissan Pulsar GTI-R spec (FWD as specified —
                         the real car is AWD; FWD is this demo's deliberate
                         drivetrain-variety choice, 5-speed as given). Its GLB
                         is the one exception to "GLBs are authored in
                         metres" (units.ts) — off by a measured ×3.776 — so
                         its geometry fields and `model.scale` carry an extra
                         conversion factor documented in its own header.
                         Grip-only — see its `tunes` comment
  spec.ts               — spec math: gearRatio/rpmInGear/engineTorque +
                         layout-aware drivenAxleLoad/drivenAxles + centerOfMass +
                         wheelPatches (shared layout)
  garage.svelte.ts      — CARS registry + carGarage.currentId ($state, written
                         by Garage.svelte) + currentCar()
  index.ts              — barrel (directory imports can't resolve .svelte.ts)
sim/                    — the driving model, car-agnostic
  controller.ts         — the physics task's brain: drivetrain + nitrous gameplay +
                         startup sequence + spawn/restart + yaw & lateral grip +
                         the SURFACE (the car's basis projected into the ground
                         plane, grip by axle LOAD SHARE, the static friction that
                         ends a stop) + carSim writes (extracted from TestGame.svelte)
  drivetrain.ts         — pure engine → clutch → gearbox → driven-axle traction step
                         (createDrivetrain(spec); layout-aware load). Owns BOTH
                         halves of the gearbox: the player's Q/E and the
                         AUTOMATIC (`autoShift`), which asks through the same
                         `requestShift` the keys do
  handling.ts           — the HandlingTune CONTRACT + cornering-model rules + modes
                         (the GR86's tunes live in its spec)
  suspension.ts         — the RIDE + body attitude, PER CAR (createSuspension(spec);
                         the controller owns the instance beside its drivetrain):
                         four raycast springs hold the car up in physics — along
                         the GROUND NORMAL, which is where slopes come from — the
                         spring-damped corners lean it in render. Every knob is
                         spec data; three pose consumers (model, CarWheels, rig)
  hullContacts.ts       — what the chassis hull is actually TOUCHING (not the
                         ground contact — the springs above are): reads Rapier's
                         own contact manifolds each physics step (never events —
                         a sensor throws away position, oncollisionenter only
                         fires once, oncontact has no position; NEVER solver
                         contacts either — unpopulated for this hull shape vs a
                         trimesh, a real bug this file's header documents),
                         publishes carSim.hullContact* for the debug rig's
                         hit-flash/scrape-tint AND fx/CarImpacts.svelte's sparks
  carControls.ts        — THE CAR'S INPUT MAP: one slot per input (label, group,
                         default key + pad bindings) declared to the engine's slot
                         system. Data, not a keymap — the engine owns the keys
                         (src/extensions/input/CLAUDE.md)
  carSwitches.svelte.ts — what LATCHING a switch MEANS: lights, ignition + its
                         startup sequence, handling tune, gearbox mode (manual /
                         automatic), B view mode, + the
                         HUD → scene restart signal. Was carInput.svelte.ts, which
                         also carried the hand-rolled keymap
  carTelemetry.svelte.ts — carSim (per-physics-step plain object) / carHud (30 Hz $state
                         mirror for the cluster) / carDebugHud (the second 30 Hz
                         mirror, published only while the rig is up) /
                         publishCarPose (the chassis body's world pose each step,
                         for fx that test against the car's volume)
  carPaint.svelte.ts    — the latched paint choice (id + finish override; the
                         order sheet is car data: spec.model.paints) + the
                         shop's open state. PAINTS is read fresh from
                         `currentCar()` per call, not snapshotted at module
                         load — this module is a singleton and the Garage can
                         switch cars mid-session
  garageShop.svelte.ts  — the Garage shop's open state (Garage.svelte's
                         counterpart to carPaint's `paintShop`)
  carMath.ts            — `clamp` / `damp`, shared by the sim modules
fx/                     — the car's visual effects
  puffPool.ts           — the smoke primitive: one mesh / one material / one draw
                         call, per-vertex puff attributes (TireSmoke + exhaust)
  sparkPool.ts          — the spark primitive, puffPool's hot sibling: one ADDITIVE
                         mesh of velocity-STREAKED quads that cool white→red and
                         SPUTTER (per-vertex spark attributes, CarImpacts); update()
                         optionally bounces alive sparks off an oriented box
                         (CarImpacts feeds it the hull bounds at the car's live
                         pose) so debris ricochets off the body instead of
                         passing through it
  noiseTextures.ts      — the two vendored noise PNGs, loaded ONCE for the scene
  CarWheels.svelte      — per-vertex steering/rolling wheel deformation (TSL); finds
                         wheels by the spec's material prefix in the GLB
  SkidMarks.svelte      — world-anchored ring buffer of rubber quads at the tyre
                         patches while the car slides; fades in-shader (TSL)
  TireSmoke.svelte      — continuous white smoke puffs at the contact patches
                         while a wheel slides; LIT so it dims at night (TSL)
  CarExhaustFlames.svelte — downshift/limiter exhaust pops + the blue nitrous pilot
                         jet (TSL, from the three.js webgpu_tsl_vfx_flames example);
                         tips come from the spec
  NitrousPurge.svelte    — the nitrous purge: the pedal held with the spray gate
                         shut (no throttle or N/R — the controller's `purging`)
                         vents the line at the hood in a cold white jet from the
                         spec's purgeVents (a puffPool STREAM, TireSmoke's
                         continuous pattern; the drain hiss rides the nitrous
                         voices in carAudio, blended under the spray)
  CarHeadlights.svelte  — car-local lights (nose is -Z); lamp anchors from the spec
  CarTaillights.svelte  — tail glow + brake flare on the GLB's own lamp-housing
                         emissive (`model.lampMaterial`, optional — a TSL
                         re-materialise of the baked bucket, per-vertex
                         front/rear split on the baked z; a car with no match
                         skips the bake and keeps only the SpotLight throw
                         below) + the two red
                         SpotLights at the spec's tailLamp anchors that THROW the
                         lamps' light on the road behind (POP_LIGHT rules:
                         permanent mount, intensity-driven, world-unit distance).
                         SPOTS because three has no per-object light mask and no
                         occlusion for an unshadowed lamp: omni ones lit the cabin
                         and the mirrors through the bodywork from inside the shell
  CarImpacts.svelte     — hit/scrape sparks off the chassis hull's contact point:
                         a rising edge = burst + dust cough, pressed-and-sliding =
                         continuous spark stream. Pure CONSUMER of the signal
                         `sim/hullContacts.ts` publishes onto carSim — no Rapier
                         imports here (sparkPool + a small puffPool). Takes the
                         hull from TestGame as a prop for the spark bounce
                         volume; sparks run IN the contact interface (slide
                         share + jitter, NO normal kick — the published normal
                         points INTO the car) and bounce off the body
  NitrousAfterimage.svelte — renders nothing; drives the afterimage effect's runtime
                         boost from the nitrous flow (the lensState contract)
debug/                  — the debug TOOL, both halves: the 3D rig and its readout.
                         Both are on the same B switch (`carView`), and the HUD
                         one is the only HTML component outside the HUD shell —
                         it belongs with the rig it explains, not with the
                         scene's chrome
  DebugHud.svelte       — the NUMBERS behind the rig, bottom-left. Reads
                         `carDebugHud` (the 30 Hz mirror, published only while
                         this is up) + `carHud`, never `carSim`. SELF-GATED on
                         `carView.mode`, so TestGameHud mounts it unconditionally
                         and stays a shell: driveline / grip / forces / the four
                         corner load bars / the wheel-ring legend
  DebugRig.svelte       — the car's SKELETON, in two layers (B view: model → rig →
                         both). SKELETON (rig + both): hull wireframe / wheels with
                         per-corner STATUS RINGS / the LAYOUT'S driveline, torque-
                         tinted / struts. ANALYSIS (rig only): the four suspension
                         RAYS + contact patches, and at the CG the heading /
                         velocity / accel vectors, the slip-angle wedge and the
                         friction circle. Pure visualization, never feeds physics
                         (complements the Studio-gated Rapier collider debug in
                         extensions/physics)
audio/                  — the engine NOTE
  carSounds.ts          — the scene's SOUND MANIFEST, declared on the engine's registry
                         (urls, gains, positional params, pool depth — data only)
  CarEngineAudio.svelte — anchor groups + the scope + the tick task; voices are
                         core/audio's, created at initCarAudio once buffers land
  carAudio.ts           — all mixing: rpm voice bands, rpm-driven loudness (never
                         input), pop takes jittered per hit, chassis scrape (loop on
                         grind, shriek on hull hits); layers/anchors/pitch from the spec
                         (files are SHARED across cars) — ticked from carSim
                         (weatherAudio contract — never $effect)
world/                  — THE MAP: everything map-shaped (one track so far — a
                         second map is a sibling + the one <Track /> mount line
                         in TestGame.svelte)
  Track.svelte          — the test track: GLB load (decoders via PROPS — the
                         scene shares ONE DRACO/KTX2/Meshopt instance with the
                         car's load), scene pose (×1.5, −60° yaw — NAMED
                         constants now, the minimap needs them as a matrix),
                         the static colliders, the minimap build and the
                         track's half of the shadow policy
  trackColliders.ts     — hand-rolled static colliders for the track GLB
  trackMap.ts           — the MINIMAP'S OUTLINE, built once from the same GLB:
                         Asphalt rasterized into a 512² occupancy grid →
                         marching squares → RDP, out as one SVG path of closed
                         rings (outer + holes, filled `evenodd`)
  trackMapState.svelte.ts — the outline's handoff to the HUD (scene is inside
                         <Canvas>, HUD is outside it); written twice a visit,
                         not per frame
TrackMinimap.svelte     — bottom-left track map: the outline above, plus the car
                         from `carHud.mapX/mapZ/mapYaw`. CarCluster's palette and
                         drawn-glow rules, and its NO PANEL CHROME call too — the
                         map floats, with a drawn shadow pass for contrast
ChaseCamera.svelte      — chase cam; borrows the app camera (rules below) + the
                         nitrous FOV kick, the launch dolly kick and the shift jolt
RearViewMirror.svelte   — NFS-style rear-view strip: a backward camera on the car
                         fills a small RT (top-of-screen overlay quad on the active
                         camera, LENS_LAYER's first resident since the lens effects
                         moved into the post pipeline)
CarCluster.svelte       — bottom-right instrument cluster: ONE svg gauge pod —
                         tacho + shift lights + seven-segment gear window + backlit
                         LCD speed readout, flanked by a boost/vacuum gauge and the
                         live N2O bottle gauge; dial facts from the spec
clusterSegments.ts      — the cluster's seven-segment geometry (segment polygons +
                         the glyph table), so the digital windows draw their unlit
                         segments too instead of being text in a big font
units.ts                — UNITS_PER_METER + G: the SI ↔ world boundary (track scale)
```

## Multi-car — the spec is the car

Everything car-specific is DATA in `cars/`; the code (sim/, fx/, audio/, the
cluster, the scene) is car-agnostic and reads `currentCar()` once per mount
(TestGame.svelte's own top-level script) — see the "Switching cars" note
below for what "per mount" means now that there's a Garage.
**Adding a car** is: one `cars/<id>.ts` exporting a `CarSpec` (see `types.ts`
for every field and its contract), plus one entry in `CARS` (garage.svelte.ts).
No component edits. The GLB contract a new model must match: wheel materials
named `<wheelMaterialPrefix>*` with all four wheels merged per mesh (CarWheels
splits them by bounding box — and the chassis hull EXCLUDES them, cars/hull.ts),
nose −Z, ground plane at y=0; the body paint is one shared material named
`model.paintMaterial`, swapped at load for a MeshPhysicalMaterial (same name)
and re-coloured from the order sheet (`model.paints` — first entry the default)
by the paint shop (HUD button — no key, it is pointer UI) — no re-export to
re-spray; the measured anchors (axles,
exhaust tips,
lamps) go in the spec's geometry. The chassis collider needs no spec numbers —
it IS the model (the hull is computed at load).

`model.lampMaterial` is the ONE OPTIONAL piece of that contract: the lamp-
housing material name, front+rear merged into one mesh, for
fx/CarTaillights.svelte's glow — a car without a matching material (or
without the field at all, cars/gtir.ts) still gets the real SpotLight throw
onto the road, just no glowing housing on the model. If a car's GLB shipped
that material with no emissive baked in at all (cars/rs3.ts's didn't), bake
one in at the ASSET level rather than faking the look in code: append the new
image/texture as raw bytes after the existing buffer (see rs3.ts's own header
for the exact method) so Draco-compressed geometry elsewhere in the same file
is never re-encoded and can't drift. **The GLB is also assumed
authored in real metres** (`units.ts`'s header) so `model.scale` can just be
`UNITS_PER_METER` — cars/gtir.ts's GLB isn't, and carries its own conversion
factor instead; see its header before assuming every car's geometry fields
are as simple as the GR86's. If the wheel assembly's materials don't already
share one case-insensitive prefix in the source file (cars/rs3.ts's didn't —
tire/brake/disk/hub were four separate names), rename them at the ASSET level
(the JSON chunk's material name strings only — geometry/Draco data untouched)
rather than widening `wheelMaterialPrefix` into something that could also
match an unrelated material.
Engine audio files are SHARED across cars — a new car voices them via
`audio.layerRpm` (where each layer sits on ITS tacho) + `audio.pitchScale`.

**Switching cars** is the Garage shop (Garage.svelte, HUD button, same shape
as the paint shop): picking a car writes `carGarage.currentId`
(garage.svelte.ts), and Scene.svelte keys its `<TestGame />` mount on that id
— so a pick unmounts and remounts the whole scene against the new spec, the
same rebuild a scene re-entry does. Nothing about that is car-code's problem
EXCEPT the one module-level singleton that used to snapshot the booting car's
data at import time: `sim/carPaint.svelte.ts`'s order sheet is read fresh
from `currentCar()` on every call now, not captured once, and TestGame.svelte
resets the latched paint id on mount if it isn't on the new car's sheet — see
both files' own headers before adding another car-keyed singleton.

`layout` is spec-level plumbing: RWD is the fully implemented, validated model.
Two things read it, and both must: the drivetrain's driven-axle LOAD
(`spec.ts` `drivenAxleLoad`: RWD rear-bias + transfer, FWD front-bias −
transfer, AWD full weight) and the debug rig's driveline (`spec.ts`
`drivenAxles` — which axle, as `[front, rear]`; a hard-coded driveline would draw
an FWD spec with a live rear axle it does not have). But FWD and AWD HANDLING FEEL
(front-slip understeer, torque split, handbrake-while-
driven) is deliberately unwritten — the current model is rear-slip-centric
(looseness, driftAlign, "the fronts are never the axle that lets go") and
should not be guessed at without the cars to tune against. cars/rs3.ts (AWD)
and cars/gtir.ts (FWD) exist now and exercise the LOAD/driveline plumbing for
real, but each carries only a Grip tune — its own `tunes.drift` is a literal
copy of `tunes.grip` (both required by the `Record<HandlingMode,
HandlingTune>` contract), rather than a rear-slip-model Drift tune faking a
front-slip character this engine can't yet compute honestly. Don't treat
either car's numbers as a validated AWD/FWD handling feel — they're a
starting point for whoever writes that model, same as the GR86 was for RWD.

## Controls

Arrows drive (↑ throttle, ↓ brake), Space handbrake, Q/E shift down/up, either
Shift nitrous, L headlights, K main beam, G handling setup, H gearbox mode
(manual ↔ automatic — the H-pattern you are giving up; free of both Studio's
bare-letter binds and the engine's Ctrl+H, which needs the modifier),
M ignition (one key,
toggles on and off), U speed units (km/h ↔ mph — a DISPLAY latch, `carUnits`; the
telemetry publishes both numbers regardless),
B view (model → debug rig → both). B is also the debug switch: the rig's
skeleton and its bottom-left readout (`debug/DebugHud.svelte` — both halves of
the tool live in `debug/`) come up together in `rig` and `both`, and
the rig's analysis overlays (suspension rays, CG vectors, friction circle) only
in `rig`. The paint shop opens from the HUD's Paint Shop button (no key: it is
pointer UI, and every pad button the input map could spare is taken) — the
CURRENT car's order sheet as a top bar (the GR86's: Track bRED, Halo White,
Raven Black, Steel/Pavement metallic, Neptune pearl, Trueno metallic, Solar
Shift colour-flip, Ridge Green, Yuzu) with finish chips beside the title:
selecting a colour applies its FACTORY finish, the chips override finish
without touching colour, all applied live. No backdrop, no pause — the world
stays interactive around the bar. The Garage button opens the same shape of
bar for the OTHER kind of choice — which car — one card per `CARS` entry with
its power/torque/weight/top speed/gear count/layout read straight off its
spec; picking one remounts the scene onto that car (see "Switching cars"
above).
Launching is a ritual: sit in N, rev into the 4–6k window (the shift lights
turn green and fill as you go), tap E — a REV-MATCH LAUNCH drops the clutch
clean, and the closer to 6k the harder it plants (≈1 g at the top; the cluster
flashes PERFECT LAUNCH, the tyres chirp); miss the window and the soft street
launch is what you get.
M starts a realistic sequence: the turnon sound cranks, RPM revs to ~2k then
settles to idle, and only when the sound ends does the idle bed fade in and the
car become driveable. M again cuts everything instantly — bed, pops, nitrous all stop,
the car coasts to a silent stop. Reverse is a GEAR,
not a pedal: Q past 1st through N into R, then pull away on ↑ — the pedals never
swap meaning, ↓ is only ever the brake. The keys are chosen so Studio's
dev-mode shortcuts (w a s z t r c v m) never fight the car (Shift is a modifier,
invisible to those bare-letter binds), and L/K/G also dodge the engine's own
Ctrl+H — EXCEPT M, which is in Studio's set: accepted because Studio is dev-only,
and Settings now flags the chip amber so anyone it bites can rebind it.

**Those are DEFAULTS, not the keymap.** Input is the engine's slot system: the
scene declares `sim/carControls.ts` (one slot per input — label, group, default
bindings) and the engine owns the keys, rebinding in Settings ▸ Controls,
persistence, the gamepad and the blur release. See `src/extensions/input/CLAUDE.md`.

Either Shift is a wet nitrous kit on a throttle switch: it only sprays while held
WITH ↑ open in a forward gear (gear ≥ 1). Both Shift keys are ONE pedal — simply
two bindings on one `nitrous` slot; the held-code tracking that makes that
work, and the blur release that stops a Shift let go while unfocused from
sticking the pedal, are the engine's. The kit's NUMBERS are the
car's (spec hardware: `nitrousTorqueGain`, +45% crank torque, applied by the
drivetrain INSIDE its traction limit — so a shot in 1st/2nd becomes wheelspin,
3rd+ is real thrust, and Drift + spray in 3rd lights the tyres — plus the bottle,
4 s of full spray and ~14 s to refill, and the flow ramp, ~0.13 s in / ~0.25 s
out); the controller's task owns the live level (it refills even while parked),
the smoothed flow and the telemetry publish. `carSim.nitrous` (flow) and
`carSim.nitrousTank` (level)
drive the blue flames, the cluster's N2O gauge, the chase camera's FOV kick and
the afterimage smear (`NitrousAfterimage.svelte` easing `uAfterimageBoost` — the
effect is default-enabled at damp 0, so the smear only exists while nitrous
does).

Held with that gate SHUT (no throttle, or N/R — the standstill/not-driving half
of the same pedal) the kit PURGES instead: the controller's `purging` vents the
line at the hood, `carSim.nitrousPurge` (smoothed 0..1, a solenoid snap — faster
in/out than the spray's ramp) driving `fx/NitrousPurge.svelte`'s cold white
plume from the spec's `geometry.purgeVents` and, in carAudio, the drain-loop
hiss blended under the spray (`NITRO_PURGE_MIX` — same voice, no fourth source;
the engage/release one-shots ride the combined edges). It costs a trickle of
bottle (`PURGE_COST`, a quarter of spray rate — ~16 s of continuous show-off on
a full kit), and it works through the idle branch, so the body sleeps on while
the parked car hisses (the FX owns its own invalidate).

**Pedals and switches are read differently, and that split is the whole reason
`sim/carSwitches.svelte.ts` still exists.** The PEDALS are continuous, so
`controller.ts` reads them straight off the map in the physics task —
`carControls.pressed('throttle')`, `carControls.axis('steer')` — which is always
current and safe there. The SWITCHES latch, so `TestGame.svelte` subscribes with
`carControls.on(slot, 'press', …)`: an edge from the key event itself, fired
exactly once per real press. Never `justPressed` in a physics task — that runs
`ceil(accumulator / rate)` times per frame and would fire zero or several times per
press (the CarWheels substep hazard again).

The engine has no opinion about what latching MEANS — that a headlight is a switch,
that flicking to main beam turns the lamps on, that the ignition runs a startup
sequence. `carSwitches.svelte.ts` owns all of it (`carLights`, `carIgnition`,
`carHandling`, `carView`, `carUnits`, plus the HUD→scene restart token), and those survive
Restart and scene exit on purpose. Leaving the scene deactivates the map, which
zeroes the pedals; the lights you left on stay on.

## The driving model

ONE dynamic body for the chassis (no per-wheel suspension). The longitudinal half
is a real drivetrain — torque curve → clutch → gearbox → traction limit at the
driven axle (`sim/drivetrain.ts`, all SI, numbers in the car's spec `cars/gr86.ts`).
Steering is DIRECT yaw-rate control — the target is the lesser of what the front wheels
geometrically point at (v·tan δ / wheelbase) and what the tyres can hold
(μ·g / v). Pitch AND roll are both disabled on the body
(`enabledRotations={[false, true, false]}`) — only yaw is free. **Rapier's
`enabledRotations` locks WORLD axes, not the body's own** (it rotates the local
inertia tensor into world space first, then zeroes the chosen world axis), so a
lock picked for the spawn heading stops protecting the car's actual roll axis the
moment it yaws away from that heading. World Y (yaw) is the only axis that's
heading-independent, so it's the only one that can be left free while the other
two stay a real, always-on guarantee. (Roll-only — `[true, true, false]` — is
what lets the car occasionally tip up onto two wheels, and with nothing gating
the drivetrain on the chassis being upright, a flipped car could still drive.)

### Two setups, one car

`cars/gr86.ts` is the HARDWARE (engine, gearbox, mass, aero, brakes) and never varies.
`sim/handling.ts` is the SETUP CONTRACT — tyre μ, the steering rack, and the oversteer
knobs — and the GR86 carries two tunes (in its spec), picked by `carHandling.mode`
(G, or the HUD switch). The controller and `drivetrain.step()` read
`tunes[mode]` **fresh every physics step**; nothing caches a tune, so switching
mid-corner is legal.

> Both tunes were revised for a friendlier, more arcade feel — more lateral grip,
> quicker steering response, and an easier-to-trigger, easier-to-catch drift. The
> exact numbers below are current; the specific MEASURED figures throughout this
> section (peak yaw °/s, circle diameters, settle times) predate that revision and
> haven't been re-measured — treat them as illustrating the mechanism, not as
> current numbers. The spec's own inline comments (in `cars/gr86.ts`) are the
> source of truth.

- **Grip** is the car (0-60 in 5.7 s, 140 mph governed — both the drivetrain's,
  unaffected by this file), tuned friendlier than the real car for cornering grip
  and steering response. `looseBase` / `driftAlign` are still 0 with `powerYawBoost`
  still 1, which collapses every term below back to the base kinematic model — Grip
  never picks up a drift term, only its own numbers changed.
- **Drift** is an ARCADE tune (the reference is NFS Underground 2), not the real
  car: it rotates roughly where you point it, the velocity vector lags behind, and
  an assist pulls the nose back so a slide is something you hold rather than
  survive. It costs almost nothing in a straight line — 0-60 in 6.2 s against
  Grip's 5.7 — because the looseness comes from the friction circle rather than
  from throwing away rear traction.

> **The stability rule: nothing may depend on the SIGN of the slip angle except
> `driftAlign`.** This is the one that has already been got wrong. An oversteer
> moment pointed along `sign(beta)` and scaled by wheelspin has a gradient at
> beta → 0 of `oversteerYaw · loose / seedAngle` ≈ 12 rad/s per rad, against
> `driftAlign`'s 2.4 — so every bump's slip angle fed back into five times more
> rotation than the aligning term could remove. beta = 0 was a DIVERGENT
> equilibrium: the car could not be driven in a straight line, and the drift never
> developed either, because at beta ≈ 0.3 the two terms roughly cancelled.

The model that replaced it, in the order the code computes it:

- **A loose rear buys yaw AUTHORITY, not yaw.** `powerYawBoost` multiplies what the
  steering may ask for — the geometric demand `v·tan δ / L` **and** the grip cap
  `μ·g / v`, since lifting the cap alone does nothing below ~25 km/h where the
  geometric term binds. Because it multiplies the steering, no steering means no
  yaw and a straight line is straight by construction. It never appears as a term
  added to the yaw target.
- **Looseness is `max(looseBase, slip, brakeLoose · brake, throttleLoose ·
powerLoad)`, or 1 on the handbrake** — whichever source is loosest wins, they do
  not stack. Each also cuts lateral grip in `drivetrain.ts`; a source that only
  raised yaw authority would make the car corner harder rather than slide. All are
  safe under the stability rule, because looseness only ever multiplies the
  STEERING's authority — provoking the car dead straight asks for no yaw and
  produces none.
  - **`looseBase` must stay SMALL** (0.15). It was 0.6, and that was the floatiness:
    the car ran **32° of slip angle just coasting through a gentle corner**, so it
    was permanently sideways with no contrast between planted and provoked. The
    ratio that makes the tune feel good is **2° coasting against 32° on the
    throttle** — looseness has to be EARNED by an input, never baked into the tyre.
    It also caps `driftAlign`, so raising it loosens the car twice over.
  - `throttleLoose` (0.7) is **the friction circle and the main drift control** —
    scaled by the drivetrain's `powerLoad`, the share of the rear's grip budget the
    drive force is spending. A tyre has one budget; grip spent pushing the car
    along is not available to hold it sideways, and that is true well before the
    tyre spins. This is why the throttle works in gears that never light the rears
    up (32° in 2nd, ~10° in 4th) and why lifting catches the slide — off throttle
    `powerLoad` is just engine braking, ~0.1, and a 32° drift closes to 8° in half
    a second.
  - **Keying the slide off wheelspin alone was the trap.** Only 1st and 2nd ever
    reach the traction limit, so getting sideways in 4th needed the handbrake, and
    dropping `tireMuLong` far enough to fix that cost 2.4 s off 0-60. The friction
    circle costs nothing: `tireMuLong` stays at 0.8 and Drift does 0-60 in 6.2 s
    against Grip's 5.7.
  - `brakeLoose` (0.9) is **trail-braking oversteer and the deliberate entry** —
    the big-brake kit moves ~2 800 N (nearly half the static rear load) off the
    rear axle. Tap ↓ into the corner to set the car, then ↑ to hold the angle; measured, a 0.4 s
    tap peaks at 23° and holds ~20° while the car drives out of it.
- **Drift's `latGripGain` is the SAME as Grip's** (1.6). With `looseBase` near
  zero the boost is ≈1 and the yaw cap matches what the bleed can service, so a
  coasting Drift car corners exactly like a Grip one. Running it lower to "add
  slide" just made everything vague — the contrast is the feel, not the baseline.
- **`maxDriftAngle` fades the boost out, and that is what makes a drift settle**
  instead of spinning: the boost shrinks with slip angle while `driftAlign` grows,
  so they cross. **`maxDriftAngle` is therefore the knob for "too slidy"** — it
  sets where the drift settles. Measured on the real per-step math: **2°**
  coasting, **32°** on the throttle in 2nd, **43°** off the brake, **54°** in a
  donut — all stable, and centring the wheel unwinds to zero with no overshoot.
- **`powerYawBoost` is the knob for "too punchy"**, because the yaw cap is what
  binds the moment you touch the wheel. At 4.5 it put the cap at ~94°/s on the
  throttle at 90 km/h — nearly 3× Grip — and the slide snapped in rather than
  building. At 2.6 that is ~39°/s against Grip's 32 (1.35×, not 1.7×) and the
  drift develops over ~0.5 s. Peak yaw across the speed range, Drift vs Grip:
  114 / 77 / 39 °/s against 83 / 57 / 32 at 30 / 50 / 90 km/h.
- **Drift's steering rack is only slightly quicker than Grip's**, and that is
  deliberate. It was 0.62 rad of lock at `steerResponse` 8, which was most of the
  punchiness: input is a keyboard, so a binary key press has nothing smoothing it
  but `steerResponse`, and at 8/s a 0.2 s tap was already at 80% of a bigger lock.
  0.55 rad at 5.5 keeps enough countersteer authority to catch a slide without the
  car darting on every tap.
- **`driftAlign` is the auto-catch, and it MUST scale with rear grip** — the scene
  applies `driftAlign × (1 − loose)`. A spinning tyre aligns nothing, so the
  aligning moment has to fade exactly as the rear lets go. As a constant it did the
  reverse: the harder you loosened the rear, the harder the car fought you, so
  **donuts were impossible** — full lock and full throttle at walking pace gave a
  130 m circle. With the scaling, the same input settles into a 7–14 m circle at
  ~33°/s. Because only `1 − looseBase` = 40% of it is ever applied off the
  throttle, the raw value wants to be much larger than it looks (3.6).
  - Lifting is a real input because of this: looseness falls back to `looseBase`,
    which roughly doubles the aligning moment and closes the slide.
  - It is still what ends a slide, what opposite lock is helping, and what makes
    the straight line self-correcting. Zero in Grip.
- **The yaw CAP runs on the full lateral μ, the sideways bleed on the reduced
  one.** The fronts are never the axle that lets go, and it is the fronts that set
  how fast a car can rotate — capping rotation with the _rear's_ lost grip makes
  the car unable to turn at exactly the moment it should be sliding.
- **Grip's numbers are not close to drifting, and it is worth knowing by how
  much**: `tireMuLong` 1.05 means only 1st gear ever beats rear traction, and
  `slipGripLoss` 0.35 leaves 65% of the lateral tyre under _total_ wheelspin —
  Grip is built to shrug off wheelspin, not slide on it.
- **Full lock is per-tune, so `carSim.steerAngle` is published in radians** and
  `CarWheels` renders that. Re-deriving `steer × maxSteerAngle` at the consumer
  would show the Grip lock while Drift steered at 0.62 rad.

### The rest of the cornering model

- **Cornering is the μ, not the damp rate.** Sideways velocity is bled off each
  step, but the bleed is CAPPED at μ·g — that cap is the entire cornering model,
  and the exponential under it only settles the last little bit. μ runs from
  `handbrakeMuLat` (rears locked) to `latMu(tune)` = `tireMuLat × latGripGain`,
  interpolated across the drivetrain's `gripFactor` = `(1 − slipGripLoss·slip) ×
(1 − looseBase)`, so the handbrake slides and wheelspin steps the back out.
  Without the cap the bleed is an infinitely strong
  constraint (~70 g at the spec's `gripRate`) that snaps the car straight no matter what
  `gripFactor` says, and the handbrake becomes a turn-tighter button.
- **On a PLANTED car the yaw cap and the bleed cap must use the same μ.** Holding
  the yaw cap costs exactly v·ω = μ·g of bleed per second, so they cancel and a
  planted car never slides. Raise one without the other and the car understeers
  out of every corner. `latGripGain` scales both; it is the one knob for "the car
  won't turn at speed", and 1 is the real car. Drift deliberately breaks this — see
  its `latGripGain` and yaw-cap bullets above; a car that never slides is the point
  in Grip and the failure mode in Drift.
- **Speed-sensitive rack:** `steerFalloffSpeed` has to span the speeds the car is
  actually driven at. It was 1.8 m/s once, i.e. fully applied by walking pace,
  which made it a no-op and left `maxSteerAngle` (then 40°, not the ≈29° its own
  comment claimed) as the low-speed feel — that pair was the twitchiness.

- **The model is SI; the world is not.** The car's spec and tunes hold the
  numbers (torque curve, 6MT ratios, tyre μ, drag) in metres/kg/newtons, and
  the controller converts at exactly one boundary: `UNITS_PER_METER = 2.5`
  (units.ts), the
  same 2.5 the car's visual group is scaled by (the track is authored at 2.5
  units/metre). Forces and velocities scale by it, rad/s does not. The car's
  `gravityScale` is that constant too — the shared `<World>` pulls at 9.8
  _units_/s², which on this track is 3.9 m/s². Validated against the real GR86 **on
  the Grip tune**: 0-60 mph 5.7 s (6.1 published), 140 mph governed, redline in
  1st at ~50 km/h. Drift is a setup, not a claim about the car — don't re-validate
  against it.
- **Physics runs at a FIXED rate — 60 Hz by default** (`physicsState.framerate`;
  the Studio panel also offers 120 and 200). Fixed is what makes it deterministic;
  the number itself is a cost/resolution choice, not a repeatability one. A
  `usePhysicsTask` therefore runs 0..n times per rendered frame — `ceil` of the
  accumulator, so the count is NEVER constant. Every damping constant in the
  driving model is consequently a RATE in 1/s applied as `damp(rate, delta)` =
  `1 - exp(-rate * delta)`, and every timer is in SECONDS (the limiter's 0.05 s
  fuel cut, the 0.28 s shift cut, the nitrous bottle) — never a "fraction kept per
  step" or a step count, either of which silently retunes the car the moment the
  rate moves. That discipline is what makes the rate a free knob; keep it.
  The rate was 200 while the driving model was being tuned, and the tune was
  re-validated as rate-independent by construction rather than by re-measuring:
  the numbers in this file (0-60, yaw °/s, circle diameters) are claims about the
  MODEL, and the model is the same at any fixed rate.
- **The gearbox is manual by default** — Q/E walk R ↔ N ↔ 1…6 with no auto-engage and
  no auto-drop to 1st. You can slot any gear while standing, and a 5 m/s grace
  window (up from 3, for friendlier shifting) lets you shift R/N ↔ 1st while still
  creeping (dead stop not required); the only other refusals are physical: reverse
  above 5 m/s forward (and vice
  versa), and money-shift downshifts that would pass the limiter.
- **H switches the box to AUTOMATIC** (`carGearbox`, a latched switch like the
  rest; the cluster's second label chip reads MANUAL / AUTO). Nothing about the
  CAR changes — same six gears, same clutch, same launch. What changes is who
  taps: `drivetrain.ts`'s `autoShift` asks through the same `requestShift` the
  keys do, so every refusal above still applies and there is only ever one
  gearbox to keep in step.
  - **FORWARD GEARS ONLY.** R and N stay the driver's call, because an automatic
    still has a selector and here that selector is Q/E — which also keeps Q/E
    live as a tiptronic override, and keeps the REV-MATCH LAUNCH ritual working
    in auto (sit in N, rev into the window, tap E, the box takes it from there).
  - The schedule is the CAR's (spec `autoUpshiftRpm` / `autoDownshiftRpm`,
    `[lifted, wide open]`), interpolated across a SMOOTHED pedal
    (`autoDemandRate`) rather than the raw one: the throttle is a key, so it is
    0 or 1 and nothing else, and smoothing it is the only thing that gives the
    lifted half of the schedule anything to mean. A blip pulls away and upshifts
    early; a held pedal reaches the wide-open numbers in about a second and holds
    every gear to 6900.
  - Three rules keep it honest, and all three are load-bearing rather than taste:
    **upshift only if the next gear is still above `lugRpm` at the ROAD SPEED**
    (which is what stops a standing burnout from walking the box to 6th — the
    revs are on the limiter, the road is doing 4 m/s), **downshift only if the
    lower gear lands clear of the upshift point** (or the box kicks down, pulls
    to the upshift rpm and changes straight back), and **stopped means 1st**,
    taken directly rather than a gear at a time (hard braking from 100 km/h is
    over in ~2.3 s, less than the coast-down schedule needs to walk six gears,
    and pulling away in 4th on a slipping clutch is the one thing an automatic
    must never do).
  - An automatic UPSHIFT also LOCKS its gear against kickdown for
    ~4 × `autoShiftHold`, lugging excepted. Around 30 km/h the up and down
    schedules overlap, and with a key for a pedal the demand swings far more than
    an ankle does: without the lock, blipping the throttle in traffic gets
    1→2→1→2 inside a second and a half.
  - **KICKDOWN is the pedal's RISING EDGE, not the smoothed demand.** The demand
    is the right input for choosing when to change UP and useless as an answer to
    "overtake, now": by the time it has climbed into the wide-open half of the
    schedule, the moment is gone. So a stab asks the WIDE-OPEN downshift question
    (`autoDownshiftRpm`'s second number — the one that already means kickdown)
    directly, and asks it THROUGH the settle timer and the upshift lock, because
    a driver flooring it has overruled both. It still goes through
    `requestShift`, and it repeats the anti-hunt margin, so it can neither money-
    shift nor land the box back at its own upshift point.
  - **Three things stop an UPSHIFT, and they are one rule seen three ways**: an
    upshift is a torque cut followed by a torque step, and there are moments a
    car cannot absorb one. On the BRAKES it is about to want the lower gear
    anyway; mid-CORNER (`DriveInput.cornering`, the controller's lateral load /
    slip angle, one step stale) the tyres are already spending their budget
    sideways; mid-SLIDE (`slip`) re-engaging onto a spinning axle is how a twitch
    becomes a spin. None of them block a DOWNSHIFT — that is how drive comes
    back. Braking also moves the box onto the KICKDOWN downshift schedule
    instead of the coast-down one, so it arrives at the corner in the gear it
    will leave in.
- **The engine feel is in the numbers on purpose**: a torque CURVE through GEARS
  (acceleration falls off and snaps back on every upshift), a PROGRESSIVE CLUTCH
  across a shift (below), a slipping clutch below
  `launchSpeed` (launches hold ~3200 rpm), engine braking scaled by gear, a
  bouncing fuel-cut limiter, and a traction limit at the driven axle with load
  transfer (flooring 1st spins the wheels; the leftover is `slip`, which the
  controller turns into lost lateral grip). See `sim/drivetrain.ts`'s header.
- **THE CLUTCH IS A PEDAL AND A DISC, and they are different numbers.** `pedal`
  is how far it is up, `bite` is how hard the disc is clamped; what reaches the
  road is their product (`pass`), and what the REVS follow is the disc's speed
  coupling (`lock`). A launch is exactly where the distinction earns its keep —
  the pedal is DUMPED while the disc slips like mad — and holding them as one
  number would force `clutchMinBite` to mean two things at once.
  - A shift is a CLUTCH ACTION, not a dead cut: `clutchOpen` of the window on the
    floor, then a smoothstepped re-engagement over the rest, so the torque BUILDS —
    that ramp is where a shift gets its bite. (A dead cut — zero torque for the
    whole `shiftTime`, full torque the step the timer hits zero — reads as a mute
    button followed by a kick.)
  - **The revs are MATCHED across the shift** (`revMatchRate`): while the clutch
    is open the engine is pulled onto the speed the gear it is going into will
    impose. That is the blip on a downshift and the drop on an upshift, and it
    matters more here than in a real car because the throttle is a KEY — nothing
    makes a keyboard driver lift, so without it every upshift re-engaged straight
    off the limiter.
  - **Whatever the match fails to close is the SHOCK** (`clutchShock`): the
    engine's own inertia over the engagement time, signed by the mismatch —
    engine faster than the gear shoves the car, slower is the engine-braking
    kick. It rides the same road as any other crank torque, THROUGH the traction
    limit, so a big enough mismatch chirps the tyres instead of teleporting the
    car. A launch is excluded (it has the plant and the boost; counting both
    would pay for one clutch drop twice).
  - **ENGINE BRAKING NEEDS A CLOSED CLUTCH** — it is scaled by `lock`, which
    is what stops a car rolling to a stop in gear being dragged backwards
    through zero by an engine it is barely connected to.
  - **CREEP is the same fact from the other side**: a slipping disc DRAGS, and at
    idle that drag is what a real car pulls away on before the throttle has said
    anything. `creepTorque` fades as the clutch homes and again with road speed
    (`creepSpeed`), and the gearing does the rest for free — 1st walks, 6th does
    not move. R creeps backwards. **The BRAKE beats it**, settled in the
    drivetrain rather than downstream, because brake force only exists above
    0.05 m/s and a creep that survived the pedal would walk the car off the line
    in hops the brake could only answer after the fact.
  - The cost is a real one and worth knowing: **a car in gear with the engine
    running is never "parked"**, so it does not sleep and the renderer does not
    idle. The car sleeps with the engine off, in N, or on the brake. Set
    `creepTorque: 0` to switch it off.
- **REV-MATCH LAUNCH**: slot 1st out of N with the revs in the 4–6k window
  (spec `launchWindowMinRpm/MaxRpm`, judged at the SHIFT TAP — the 0.28 s cut that
  follows lets the revs climb out of it, that climb is the player's timing)
  and the clutch drops CLEAN, with DEPTH in the window setting how hard
  (`launchQ` 0→1 across it): bite scales `clutchMinBite`→1, and the boost —
  rear μ up to the spec's `launchGripGain` (+100%) plus WOT up to `launchTorqueGain`
  (+50%, nitrous-style, inside the traction limit) — is `launchBoost`: held
  through the drop, then decaying at `launchBoostDecay` (~1.4 s tail) into
  1st so the slam outlives the engagement. At 6 k that is ≈1 g off the line,
  ~3× the soft launch's thrust; the window floor is barely above the street
  launch. The revs hold where you caught them until the clutch homes. The
  hold ends on the clutch homing or a lift; a lift or gear change kills the
  boost instantly (no reward for aborted launches). In N with the revs in
  the window the cluster's five shift lights turn GREEN and fill with depth
  (launch meter — overrides the shift indication, which has no job in N);
  on the landing the HUD flashes the caught band UPPER-MIDDLE of the screen
  for ~1.5 s — STREET LAUNCH (4–5k) / JUICY LAUNCH (5–5.5k) / PERFECT LAUNCH
  (5.5–6k), tier latched at the catch (`state.launchTier` →
  `carSim.launchTier` → `carHud.launchTier` → TestGameHud's LAUNCH_LABELS
  one-shot keyframe) — and the launch KICKS THE CAMERA (ChaseCamera: dolly
  toward the car + FOV widen, both off `carSim.launch` — snap in with the
  drop, ease out with the boost tail; the dolly is a per-frame delta on the
  rig distance so the player's zoom survives, clamped to 60% of base). The
  tyres chirp through the drop and tail (`state.launch` → `carSim.launch` →
  carAudio's squeal).

## Colliders — the hard-won rules

- **The car's contacts are NOT its grip — there are no ground contacts at
  all.** The ground contact is FOUR RAYCAST SPRINGS (`sim/suspension.ts`, cast
  at `wheelPatches` from the controller's step); the chassis collider is purely
  the bump stop and the thing that hits barriers. History, because it explains
  the friction props: when contacts WERE the ground contact (undertray box +
  wheel balls) they had to be FRICTIONLESS (`friction={0}` + Min rule) — a body
  driven at the centre of mass has contact friction acting as static friction
  against the drive force, and at real gravity the cap (≈0.65·m·g) sat ABOVE
  the drivetrain's entire force range: every Newton of throttle was cancelled
  and the car could not move at all. The wheels then became rays (a rigid ball
  is an infinitely stiff spring — a 3 cm kerb under one wheel had to lift the
  whole car inside one step; a spring takes ~0.2 s over the same lip), and
  with nothing left to fight the drivetrain the props moved to
  `friction={1}` + Multiply (the track collider's own μ) so barrier scrapes
  drag instead of slide. All grip — longitudinal AND lateral — is modelled in
  the drivetrain/task; contacts keep their normal impulses plus cosmetic
  friction. **A parked car is held by the tyres' STATIC friction**
  (`controller.ts`'s `restGrip`, capped at μ·g like everything else), so it
  holds any slope up to the tyre's own μ and rolls away on anything steeper —
  which is what a tyre does. That replaced "it can creep on slopes steeper than
  rolling resistance holds (~0.75°), hold Space if it matters": rolling
  resistance was never the thing holding it, because nothing below 0.05 m/s was
  applying any force at all.
- **The chassis is a ROUNDED CONVEX HULL computed from the car's own GLB**
  (`cars/hull.ts`, fed to one `<Collider shape="roundConvexHull">` directly
  under the RigidBody): every mesh except the wheels (material-prefix
  filtered — tyre bottoms at model y 0.01 would make the body a ground contact
  and fight the rays), decimated to ≤ ~4 k points (one global stride + every
  mesh's 8 bbox corners so extremes survive the stride), interior meshes cost
  nothing (quickhull discards inside points) — decimated to ~8 k REAL
  surface vertices (what <AutoColliders> feeds `ColliderDesc.convexHull`, but
  one hull for the whole car; do NOT add every mesh's 8 bbox corners — those
  phantom points (roof-height corners at the nose/tail tips, box corners on
  every curved bumper) are exactly a boxy-too-big hull). The 5 cm MARGIN is a
  small edge FILLET: Rapier DILATES round hulls by
  the border radius, so every edge — nose, tail, belly, roofline — GLANCES
  OUTWARD everywhere, so the point cloud's belly is CLAMPED (points below
  `BELLY_LINE + HULL_MARGIN` lift up) to land the dilated bottom exactly on
  the 0.134 bump-stop line — the margin can grow and the hull can
  never become a ground contact ahead of the springs. Net size: doors at
  0.91 + 0.05 = 0.96, mirrors a touch wider, roof
  1.31 + 0.05, ends at their true taper + 5 cm. It is the sole MASS carrier, with EXPLICIT properties — mass +
  centerOfMass (cogHeight × the weight-bias lever rule, 15.5 cm ahead of the
  origin on the GR86) + principalAngularInertia (yaw = the spec's
  `hardware.yawInertia`; pitch/roll are LOCKED axes, their components are
  box-equivalent placeholders from the hull bounds) + identity frame — because
  Threlte's Collider only takes that branch when ALL THREE extras are present;
  missing one silently falls back to geometry-derived `setMass`. Steering is
  DIRECT yaw-rate control (`setAngvel`), so inertia scales contact response
  only — the driving model never feels these numbers move. THE POINTS
  ARE PRE-BAKED to world units (×model.scale) and the Collider sits at WORLD
  SCALE 1 with no scaled group: Threlte's `scaleColliderArgs` vertex-scales
  `convexHull` args but NOT `roundConvexHull` — it falls into the positional
  [x,y,z] branch and would multiply the point array by a scalar (the
  roundCuboid fourth-arg quirk's bigger sibling, verified in the installed
  @threlte/rapier source).
- **Track collision is hand-rolled** (`world/trackColliders.ts`), not `<AutoColliders>`:
  the trimesh flags cannot be passed through AutoColliders, and without
  `TriMeshFlags.FIX_INTERNAL_EDGES` a flat tessellated road produces ghost
  contacts at internal triangle edges — bumps and snags on perfectly flat
  asphalt. Each mesh's root-relative transform is baked into the vertices (same
  trick as CarWheels). Caveat: with the flag, trimesh contacts become
  effectively ONE-SIDED — a track GLB with flipped winding would let bodies fall
  through. Known seam: `Ground` sits 1.1 cm below `Asphalt` in the track GLB — a
  small lip at asphalt edges the balls roll over.
- **Only Asphalt/Metal trimesh + a Ground FLOOR collide** (`world/trackColliders.ts`,
  filtered by material name — exporter node names are not stable). The GLB's
  other two meshes are deliberately OUT: `Decals` is 31 k triangles of road
  paint a hair off the deck — as its own collider every decal boundary edge is
  a REAL edge (FIX_INTERNAL_EDGES only smooths edges within one trimesh), and
  the chassis rolling over paint was a ghost-contact factory (the "sometimes
  snags on nothing" stutter); `Leafs_Mat` foliage is thin double-sided quads
  along the roads — edge-on at speed, invisible walls (the car drives through
  bushes now — acceptable, the barriers still stop it). **The `Ground` dirt
  plane is NOT a trimesh at all**: the GLB's is a unit quad scaled ×230 — two
  460 m triangles — and convex-vs-trimesh contact manifolds degrade when the
  triangles are ~100× the dynamic collider, which read as rate-independent
  micro-jitter on the dirt (it survived 200 Hz physics unchanged). It is flat,
  so it becomes an analytical cuboid FLOOR (top face at the plane's own height;
  the 1.1 cm lip at asphalt edges is unchanged). A new mesh in a re-export
  collides only if its material is Asphalt/Metal (trimesh) or Ground (floor) —
  check that before blaming collision oddities.
- **The track GLB is measured, not guessed**: car spans model y 0.01 (tire
  bottoms) .. 1.31 (roof), wheel centres at y 0.335 (`geometry.hubY`), axles z
  ±wheelbase/2, track x ±0.78. The spec's measured anchors (axles, lamps,
  exhaust tips) come from those numbers; the chassis collider needs no
  measuring — the hull IS the model (cars/hull.ts reads it at load).
  If the model is ever replaced, re-measure the anchors (the accessor min/max
  in the GLB JSON is readable without decoding Draco).

## Shadows — the car casts, the track casts too, everything receives

`DOCS/testperf.md` is this scene's performance reference; read it before
touching anything on the frame path. The one rule that lives here because it is
a scene-content decision, not an engine one:

**`castShadow` is a policy, never a blanket flag — the car's half lives in
`TestGame.svelte`, the track's half in `world/Track.svelte`.** A blanket
`castShadow = receiveShadow = true` on every mesh in both GLBs is wrong in
both directions at once. `SkyLight` is a `SunLight`
fitting two cascades to the view camera (`core/skybox/CLAUDE.md`), so an
oversized caster cannot drag the box off the car — but an oversized caster
still pays: every enabled caster re-renders into the 2048² map each frame it
is armed (the car moves, so `needsUpdate` is armed every frame), and the
track's `Metal` mesh alone spans ~2 970 × 2 540 world units.

The car casts, minus its interior/engine materials (`CAR_NON_CASTERS` — 117 176
of its 324 640 triangles, never in its silhouette).
`TRACK_CASTS_SHADOWS` is **on**, scoped to `TRACK_CASTERS` (`Metal` +
`Leafs_Mat`, 262 663 of the track's 313 725 triangles — Ground/Asphalt/Decals
stay excluded, they can only ever shadow themselves) — so the car gets
barrier and tree shade, at the cost of that geometry re-rendering into the
shadow map twice a frame (once per cascade) in a scene that is already
fill-bound. **Flipped without a profiled measurement** — watch the Stats HUD
(triangles/programs/frame time) if the car judders near barriers or tree
lines, and trim `TRACK_CASTERS` down to `Metal` alone first (the actual visible
caster; `Leafs_Mat` is the cheaper 71 982 to drop) before reaching for
anything more invasive. Full numbers: `testperf.md` §1.1's update note.

## The suspension — the car leans, the physics doesn't

`sim/suspension.ts` is the ONE owner of the car's body attitude, and its three
consumers are the car MODEL (TestGame.svelte poses the visual group), the WHEELS
(`fx/CarWheels.svelte`) and the debug rig — one owner because the lean must be
the same lean everywhere; owned by the rig alone, the skeleton would lean and
the car drawn over it would not. It is a PER-CAR
instance (`createSuspension(spec)` — the controller creates it beside its
drivetrain, the scene advances the visual half and passes the instance down):
every tuning knob is the spec's `suspension` block, so a second car cannot
inherit the GR86's ride.

- **The ATTITUDE produces no forces** (the springs themselves do — see the
  surface section below). The chassis is one dynamic box with
  `enabledRotations={[false, true, false]}` — the PHYSICS car cannot pitch or
  roll at all, and that lock is a real guarantee (see the driving-model section).
  What leans is the model. Nothing here feeds back.
- **The input is the model's own acceleration, not a measurement.**
  `carSim.accelFwd` is `(driveForce + resistForce) / mass` — literally the
  longitudinal force the controller hands Rapier — and `carSim.accelLat` is the
  sideways delta-v the grip model applied, over the step. A finite difference of
  the body's interpolated world pose would need TWO derivatives per frame and a
  one-pole just to be readable; this is exact, noiseless, free, and
  available a frame earlier. It also inherits the grip clamp: `accelLat`
  saturates at μ·g, so a car already sliding at the limit stops leaning harder.
- **Each corner is a SPRING-DAMPER, not a one-pole**, and that is the difference
  between the body arriving at an attitude and MOVING to one — stab the brakes
  and the nose dives, overshoots ~7% and settles. `springZeta` (spec, 0.62) buys the
  overshoot; at 1 it is a soft slide into place, over 1 it is mush. Semi-implicit
  Euler with `delta` clamped to 1/30, so a backgrounded tab doesn't return to a
  car mid-pogo; verified identical at 60/30/20 fps.
- **The four compressions convert to heave/pitch/roll over the car's REAL lever
  arms**, so the feel needs one constant (`squatPerG`, spec) rather than separate
  pitch and roll gains. Measured: 1.6° nose-down at 0.8 g braking, 1.2° nose-up
  under power, ~4.5° roll at the cornering limit, hard-stopped at 3.1°/5.2°. A
  real GR86 rolls 3-4° at max lateral.
- **THE COMPRESSION MOVES THE BODY, NOT THE WHEELS**, and having it the other way
  round is the bug this all came out of: the rig dived under power, squatted
  under braking and leaned INTO its corners. The corner compressions were right;
  the wrong END of the strut was moving. The wheels ARE the contact balls — on
  the road, immovable — so `suspension.travel` is the per-corner counter-offset
  that keeps each tyre planted while the body moves around it, measured off the
  attitude matrix rather than assumed equal to the compression (the matrix drops
  the warp mode a rigid body can't express; a real chassis absorbs it in
  torsion). `CarWheels` adds it in `positionNode`, divided by `visualScale`
  because the module speaks world units and the baked wheel geometry is model
  metres — the same conversion the roll rate does in the other direction.
- **The update task lives on the SCENE, not on a child.** Two children need the
  pose and one of them (DebugRig) is only mounted in two of the three view modes,
  so the owner has to be something always mounted — and registering it on the
  scene also makes it run FIRST, since tasks sharing a constraint fall back to
  mount order and parents mount before children. Render stage, never physics: the
  CarWheels rule (`ceil(accumulator / rate)` substeps per frame is never
  constant, so a spring integrated in physics time pulses against the body Rapier
  is interpolating underneath it).
- `suspension.reset()` on scene exit AND on Restart — the springs hold state across
  a teleport otherwise, and a car restarted mid-brake respawns nose-down.

## The surface — the car drives on the ground, not on the horizon

A flat-world model has a tell: a hill
costs nothing to climb and gives nothing back going down. Four things fix that;
all of them are no-ops on flat ground, which is what protects the tune.

- **THE SPRING FORCE IS AIMED AT THE GROUND NORMAL, not straight up**
  (`suspension.ts`'s `step` — the standard raycast-vehicle rule). Aimed UP it
  balanced gravity exactly on any surface, because both forces were vertical and
  their horizontal sum was therefore zero whatever the ground was doing: no
  gravity-along-slope term existed anywhere in the model. Aimed at the normal the
  support is `f·n`, whose tangential part IS that term, so the hill pulls for
  real and the TYRES hold it. The normal is capped at 60° from vertical
  (`MIN_NORMAL_Y`) before it is used as a direction: a trimesh edge, a barrier
  face or a kerb cheek can hand back a near-horizontal normal, and firing 1290 kg
  along that is a cannon. The RAW normal is still what the fx lay marks with —
  only the force is capped.
- **The car's BASIS is projected into that plane** (`controller.ts`). The body
  cannot pitch or roll, so its own axes stay horizontal however steep the ground
  is, and a drive force along a horizontal nose pushes INTO a hill rather than up
  it. Projecting the nose and the right vector into the measured ground plane is
  what puts the thrust, the brakes and the sideways bleed where the tyres
  actually are, and what makes `speedMs` the speed along the ROAD.
- **Grip scales by each axle's LOAD SHARE, not by a count of rays that hit**
  (`suspension.loadShare`, smoothed at `CONTACT_RATE` and clamped to 1). The
  spring rate is derived from the live weight as `weight / (4 · restSag)`, so a
  compression of exactly `restSag` IS a quarter of the car — the reading is
  exact, not a proxy. A binary count deletes a quarter of the car's grip the
  moment one wheel goes light over a crest, which is wrong twice over: the
  springs still have to carry the whole car, so that corner's load has already
  MOVED to the others. One lifted front wheel reads ~0.95 where the count read
  0.5.
- **The visual road-follow splits SLOPE from KERB.** Four corner deviations
  decompose exactly into three modes over a rectangle of patches — pitch, roll
  and WARP (the diagonal, which a rigid body cannot express and a real chassis
  absorbs in torsion). They want opposite treatment: pitch and roll are the
  surface the car is standing on and it should sit on them fully (`slopeMax` is a
  safety rail at ~19°/30°, not a feel knob), the warp is one wheel on something
  and stays clamped at `roadMax`. Clamping them together — a per-corner
  `clamp(dev, ±roadMax)` — caps the SLOPE at the kerb limit, and
  the car renders 2° nose-up on a 10° climb, visibly floating out of the hill.
- **Stopping is the tyres' job** (`controller.ts`'s `restGrip`). Below
  `REST_SPEED` the rolling model has nothing to say — `resistForce` is gated on
  `rolling > 0.05`, the sideways bleed's cap goes to zero with the corner,
  `linearDamping` is 0 on the body by design — so the parked branch must not
  hand the body straight back with whatever velocity it still has. **A car that
  has stopped would GLIDE on in its last direction for ever**, under Rapier's own
  sleep threshold so it never even settles, while the branch publishes
  `speedMs = 0` and the wheels stand still: a car sliding on stationary wheels,
  which is the one thing tyres never do. Static friction capped at μ·g takes
  it out — including the sideways half, which is the difference between coming to
  a stop and coming to a stop still sliding — and the branch publishes the honest
  speed. "Nothing is asking the car to move" is measured off the DRIVE FORCE, not
  the throttle key, because the clutch creeps an idling car in gear and a rest
  friction that ignored that would quietly delete creep.

## The minimap — the road, not a drawing of the road

`world/trackMap.ts` + `world/trackMapState.svelte.ts` + `TrackMinimap.svelte`.
The outline is the track GLB's `Asphalt` meshes, rasterized and contoured ONCE
when the GLB lands, so there is no second asset to keep in step and a track
re-export moves the map for free. The rejected alternative is the obvious one:
a top-down orthographic camera rendered into a texture is a **second full scene
render every frame**, in a scene `DOCS/testperf.md` already calls fill-bound.

- **The pipeline is rasterize → marching squares → RDP**, all one-time (~35 ms
  measured on this track's 19 488 asphalt triangles, behind the loading veil).
  Rasterization fills cell CENTRES by a point-in-triangle test **and** stamps
  each triangle's three EDGES with a DDA line, and both halves are load-bearing:
  centres alone drop anything thinner than a cell, edges alone leave a long
  straight (two big triangles) hollow. **`GRID` is RELATIVE, not absolute** —
  the grid is fitted to the circuit's own bounds, so what it buys is
  cells-per-road-width. This track's asphalt spans 557 world units, which at 512
  is ~1.1 units a cell; a circuit several times the size wants it raised.
- **RDP is what makes it read as drawn rather than pixelated**, and it is also
  the size: it collapses the staircase a grid contour is made of, taking this
  track from tens of thousands of points to 540 (a 6.3 kB path, 4 closed rings).
- **Holes come out free, and that is why the contours must be closed.** The
  ambiguous marching-squares saddles (cases 5 and 10) are resolved the same way
  every time — which resolution is arbitrary, consistency is not, because a
  mixed one opens a contour and an open contour cannot be filled. The component
  fills the lot `evenodd`, so the infield punches through with no winding
  bookkeeping anywhere.
- **The track group's pose is passed to the builder as a MATRIX, not read off
  `root.matrixWorld`** (`Track.svelte`'s `TRACK_SCALE` / `TRACK_YAW`, hoisted out
  of the markup for exactly this). The GLB's scene object is attached to that
  group by a child component, so whether its world matrix is live when the
  effect runs is a mount-ordering question — and the wrong answer is silent: a
  map rotated 60° off the coordinates the car marker is plotted in. Transforms
  INSIDE the GLB are read relatively (`rootInv × mesh.matrixWorld`), the same
  order-independent trick `trackColliders.ts` bakes with.
- **The car comes from `carHud`, never `carSim`** — `mapX`/`mapZ` in half-unit
  buckets (~0.2 m, a fifth of a pixel on this instrument) and `mapYaw` in whole
  degrees, so a parked car writes nothing. Yaw is exact from two quaternion
  components because pitch and roll are LOCKED axes. The telemetry publishes the
  BODY's yaw; turning that into an SVG rotation (negated — svg's y axis points
  down) is the picture's job, and lives in the component.
- **The marker is CLAMPED inside the plate.** The map is fitted to the asphalt
  and the car can leave it (the dirt plane runs 460 m past the circuit), so an
  unclamped marker walks off the instrument. Riding the edge, dimmed, is the
  honest reading: "off the map, that way".
- **NO PANEL CHROME — it floats, exactly as the cluster's gauges do.** A gauge
  carries a dark face because a NEEDLE needs a dial behind it, and a map does
  not. What keeps the outline legible instead is a SHADOW pass — a wide
  dark copy of the same path under the halo, plus `paint-order: stroke fill` on
  the labels — so the map holds against pale asphalt and a bright sky without
  boxing the corner off. Same rule as the glows either way: drawn, never
  filtered.

## Telemetry, wheels, camera

- **`carTelemetry.svelte.ts` is the plain-object / `$state`-mirror split** the
  sky uses: `carSim` is written every physics step and read by
  `CarWheels`; `carHud` is quantised and published at 30 Hz for
  `CarCluster.svelte` (`publishCarHud` counts SECONDS, so the 30 Hz holds at any
  physics rate). The HUD must never read `carSim` — one Svelte invalidation per
  field per step, for a needle nobody can follow.
  - **`carSim` also carries a DEBUG FEED** — `spin`, `velLat`, `yawRate`,
    `driveForce`, `resistForce`, `powerLoad`, `gripFactor`, `loose`, `muLat`,
    `clutch`. All of it was already computed by the drivetrain or the controller;
    publishing it is what lets the debug rig draw the model instead of guessing at
    it. **That is the rig's one rule and it has been broken twice** — its steer
    angle was once `steer × maxSteerAngle` (showing the Grip lock while Drift
    steered at 0.62 rad) and its wheel spin was once `speedMs × (1 + slip·0.8)`
    (a fudge for the real overspeed `drivetrain.state.spin` integrates). If the
    rig needs a number, publish the number.
  - **The cluster is ONE svg, and every glow in it is DRAWN, not filtered.** A
    blur filter re-rasterizes everything it covers each time that thing moves, so
    the needle, the rev sweep and the shift LEDs get their halo from a second,
    wider, translucent copy of the same shape, and `filter: drop-shadow()` is used
    only on the PRINTED SCALE (never changes → the browser caches the raster) and
    the gear digit (changes on a shift, not on a frame). The gear and speed
    windows are real seven-segment cells (`clusterSegments.ts`), which is what buys
    the unlit ghost segments behind the digits and lets the ignition BLANK the
    panel instead of hiding it. Two things are honestly derived rather than
    published: the boost gauge reads MANIFOLD PRESSURE modelled off the real
    throttle and rpm (a naturally aspirated car sits in the vacuum half, and
    `cluster.hasTurbo` decides whether the positive half is live or drawn dead —
    it is display-only and must never feed back into the drivetrain, which models
    torque, not airflow), and the startup SELF-TEST (needle sweep + bulb check
    while `carIgnition.on && !ready`) is a keyframe, which is legal because it is
    an event with a fixed duration and not a smoothed value — the thing the
    no-transitions rule exists to prevent.
  - **`carDebugHud` is a SECOND 30 Hz mirror**, for `debug/DebugHud.svelte`, and
    it is published **only while the rig is up** (`carView.mode !== 'model'`,
    gated inside `publishCarHud` — the same condition the panel self-gates on, so
    the mirror and its one consumer cannot drift apart). It is roughly twice the
    cluster's field count and invisible in normal play, and a `$state` write
    nobody reads is still an invalidation. `publishCarHud(dt, suspension?)` takes
    the suspension for it: the four springs live on the controller's instance
    (the rig reads that directly), and the HUD is a sibling tree that can reach
    neither.
- **`CarWheels.svelte` deforms vertices in `positionNode`**, so it also writes
  `positionPrevious` — a vertex-deforming material owns both ends of the
  velocity buffer or motion blur smears it against its rest pose. Its steer
  angle and roll rate come from `carSim`, not from raw key state — the rack is
  speed-sensitive, so re-deriving it here would show full lock while the physics
  used a third. **THE ROLL IS PER AXLE AND IT IS THE DRIVETRAIN'S, NOT A FUDGE**:
  the driven axle turns at `speedMs + carSim.spin` (the real contact-patch
  overspeed, the same number the tacho reads through the gearing), the undriven
  one at `speedMs`, and the handbrake locks the rears whatever the layout —
  exactly what the rig draws, from exactly the same fields. One shared
  accumulator at `speedMs × (1 + slip·0.8)` would be wrong three ways at once:
  all four wheels would carry the
  spin (a RWD burnout lights the fronts), the overspeed would be capped at 0.8× road
  speed where the real one is a free m/s (12 m/s of spin over a 4 m/s car in
  1st), and it would multiply ROAD speed — so a STANDING BURNOUT, the one case
  the player is staring straight at the tyre, would turn the wheels at exactly
  zero while the engine sits on the limiter. **THE ROLL IS INTEGRATED IN RENDER TIME, NOT PHYSICS TIME**, and
  that distinction is the difference between a smooth wheel and a car-only
  stutter. Threlte's simulation stage
  takes `ceil(accumulator / rate)` substeps per frame, so at 200 Hz against
  60 fps it steps 4/3/3/4/3/3… — a `usePhysicsTask`
  integration advances the wheels by 20 ms, then 15 ms, then 15 ms of rotation
  on consecutive frames: a ±17% pulse in wheel rotation on a 20 Hz beat,
  underneath a chassis that
  Rapier's synchronization stage is smoothly INTERPOLATING to the frame's own
  time — body smooth, wheels pulsing, on the object the player is staring at.
  It is a `{ before: autoRenderTask }` task, which uses the frame's delta and
  runs after that synchronization. The cost is that `carSim` is up to one substep
  old rather than exactly current: invisible, where the pulse is not.
  **Dropping to 60 Hz does not retire this rule, it makes it load-bearing.** The
  substep count per frame is `ceil`, so it is never constant at any rate — and at
  60 Hz on a high-refresh display it is 0 or 1, i.e. frames where a physics-time
  integration would not advance the wheels AT ALL. A 100% pulse instead of a 17%
  one. The rule is rate-independent: a physics task moves simulation state, a
  render-stage task moves pixels.
- **`SkidMarks.svelte` (fx/) lays rubber while the car slides** — one world-anchored
  mesh (mounted beside ChaseCamera, NOT in the car: marks never move with the
  body), a fixed ring buffer of quads written at the tyre contact patches.
  Intensity is the squeal driver's TWIN (carAudio.ts — loosest source wins,
  never a sum) minus the two sources that aren't actually sliding (cornering
  load sings but doesn't scrub; the launch chirp is the drop): rears get
  wheelspin/slide/handbrake/launch/brake, fronts slide/brake. Fading is
  ENTIRELY in the shader — per-vertex `aMark` (birth, intensity, edge, grain)
  against a `uTime` uniform, so a mark ages without a single attribute
  re-upload; segments go out via `addUpdateRange`, only while laying. A
  stationary burnout creeps its lay point along the nose (the patch grows and
  overlapping quads darken — depthWrite off). Wheel offsets come from GR86
  geometry ×2.5 (track half 0.775 m is the real car's — the GLB's measured
  pivots stay in CarWheels); the mark height is the EMPIRICALLY TUNED body-space
  `LAY_Y = 0.8` — a road line derived from the wheel-contact colliders
  (hubY − wheelRadius + epsilon) checks out against rapier in isolation but
  renders UNDER the surface in-browser; don't re-derive it without explaining
  that. **`LAY_Y` is the height on FLAT GROUND AT REST**: each wheel
  adds its suspension ray's offset off the rest road line
  (`suspension.groundY(i) − suspension.restGroundY`), the strip's width vector
  is tilted into the ground plane, and each segment carries the ray's ground
  NORMAL (`suspension.normal`) — so marks follow slopes, cambers and kerbs and
  look identical on the flat. A wheel whose ray found nothing lays nothing (no
  tail either). TireSmoke's `SMOKE_LIFT` follows the same rule. The material also carries polygonOffset (−2/−2), belt and
  braces against the near-plane-0.001 depth precision at chase distance.
  On-demand: invalidate only while laying or within the 15 s fade window. One
  draw call, DoubleSide. THE MATERIAL IS LIT,
  NOT UNLIT — MeshStandardNodeMaterial, albedo ~0.05, normals written
  per segment from the wheel's ray (they were pinned face-up once, before the
  ground-following): a fixed unlit gray lifted by the night exposure is LIGHTER than
  night asphalt, so marks read whitish-gray after dark; lit, they darken with
  the environment (and take fog) like the road — darker than asphalt by day,
  near-black at night. THE QUADS ARE INDEXED, NOT 6-VERT — four verts per
  segment (aL, aR, bL, bR) with both a-verts carrying the previous segment's
  values: the 6-vert version's shared diagonal was a visible triangle/diamond
  pattern. ORGANIC LOOK = lay-time randomness + the vendored perlin PNG (from
  the shared `fx/noiseTextures.ts`, so it is never disposed here): two
  world-space samples at
  different scales multiply into a scratch/mottle that also raggers the soft
  rim — stable (world-anchored, no shimmer), continuous along the strip, and
  not one obvious pattern. Plus per-segment width jitter ±12%, tapered starts
  from 0, and one SHORT tail-off segment where a slide ends (capped at
  TAIL_MAX). **THE MESH LEAVES THE FRAME WHEN THE LAST MARK HAS FADED**, and
  the draw range follows the ring until it first wraps. An expired quad is NOT
  free: `transparent` + `depthWrite: false` means it is still rasterised and
  still blended — a lit standard material with two texture fetches, writing
  alpha 0 over the road — so ungated, one slide cost 16 384 blended triangles
  a frame for the rest of the session. Same reason for the draw range: an
  unwritten quad is degenerate and invisible, but it still pays a vertex
  transform in every pass. Enter/exit hysteresis (MARK_ON 0.3 / MARK_EXIT 0.22) stops
  threshold chatter laying confetti.
- **`debug/DebugRig.svelte` is the car's SKELETON** — what the kinematic model
  actually drives, drawn at the RigidBody's unscaled level (world-unit body
  space, so it inherits Rapier's interpolated pose). B cycles the view:
  `model` → `rig` → `both` (`carView` in carSwitches.svelte.ts, a latched switch).
  It takes the VIEW MODE, not a boolean, because it draws **two layers**: the
  SKELETON in both `rig` and `both`, and the ANALYSIS overlays only in `rig`,
  where there is no car for them to bury. The analysis math is SKIPPED in `both`,
  not merely hidden.
  - **THE RIG NEVER GUESSES.** Everything it draws is published by the model —
    `carSim` plus the shared `suspension` instance. See the `carTelemetry` bullet
    above for the two times that rule was broken and what it cost.
  - **The DRIVELINE is the LAYOUT'S** (`drivenAxles(spec)`), which is the whole
    "which wheels are turning" reading. A DRIVEN axle gets a diff, two
    half-shafts and a driveshaft from the transfer puck (AWD grows a second one
    forward, and a front-driven car's puck moves forward to the axle it feeds);
    an UNDRIVEN axle gets **nothing** — a dead axle really is just hubs and
    struts, and total absence is the least ambiguous answer. Driven wheels roll
    at `speedMs + carSim.spin`, undriven at `speedMs`, so wheelspin visibly
    happens at one end of the car. The live driveline is tinted by torque (dim
    bronze coasting → gold on `powerLoad` → red on `slip`). The HANDBRAKE locks
    the REAR wheels whatever the layout, because a handbrake is a rear brake, and
    on a rear-driven car it stops the driveshaft with them (the MODEL's wheels
    lock with them too now — `fx/CarWheels.svelte` reads the same feed, so the
    skeleton and the car agree). Half-shafts rather than a solid bar because independent suspension means
    one bar could not follow both hubs. Roll is accumulated PER WHEEL, not per
    axle — a shared accumulator snaps a locked rear back on release.
  - **Each wheel wears a STATUS RING** on its outboard face, and the priority
    order is a hierarchy of "the worst thing true of this wheel": airborne
    (violet, from `suspension.grounded`) → locked (blue) → spinning (red) →
    braking (orange) → driving (green→amber by `powerLoad`) → coasting (grey).
    `debug/DebugHud.svelte`'s legend repeats it, and the two orders have to be
    kept in step by eye — the panel is HTML hex, the rig is `THREE.Color`.
  - **The four SUSPENSION RAYS are drawn** (analysis layer) from where they are
    cast to what they hit, with a contact-patch disc sized and tinted by
    `suspension.loadRatio(i)` — the PHYSICAL compression, deliberately a different
    reading from the `compressionRatio` the struts show. The rays ARE the car's
    ground contact — the one part of the model with no other picture; without
    them an airborne wheel looks exactly like a loaded one. `suspension` exposes
    `rayOriginY` / `maxToi` / `wheelRadius` / `loadRatio` for this; the tyre fx
    read `groundY(i)` / `restGroundY` / `normal` (the same cast, with its normal).
  - **At the CENTRE OF MASS** (`centerOfMass(spec)` — the same point cars/hull.ts
    hands Rapier; one lever rule, two consumers): heading, velocity and combined
    acceleration arrows, the slip-angle WEDGE between heading and velocity (a
    triangle fan whose rim is rewritten per frame — the angle is the reading), and
    the FRICTION CIRCLE: a ring at the live `muLat`·g inside a dim ring at the
    tune's full μ. The accel arrow uses the SAME units per g as the rings, so the
    arrow reaching the bright ring IS the tyre saturating and the gap between the
    rings is the grip wheelspin/brake/looseness has cost. It is a LATERAL budget —
    the longitudinal cap is the drivetrain's own `tireMuLong × drivenAxleLoad`, a
    different number, so a braking arrow may honestly overshoot. **This group
    takes the pose's TRANSLATION and not its rotation**: its arrows are physical
    vectors in the body's yaw frame, and leaning them by a cosmetic roll would be
    drawing the fake into the measurement.
  - Strut compression is not modelled here — it was once (finite-differencing the
    rig root's world pose), which is why the skeleton leaned and the car drawn
    over it did not. That model lives in **`sim/suspension.ts`** and the rig only
    READS it.
  - The chassis is drawn as the wireframe HULL — the same point cloud the
    collider is built from, passed in by the scene, so the shape Rapier holds and
    the shape drawn cannot drift apart (the 5 cm margin is not drawn) — and it is
    the one part whose pose is the gauge rather than the collider's: the real body
    cannot pitch or roll (`enabledRotations` leaves only yaw), so the attitude is
    drawn ON the shape instead of beside it. Rest pose and size still true.
  - **~24 materials**, all `MeshBasicNodeMaterial`. Identical node graphs share a
    compiled program, but each material still builds its own graph the first time
    it RENDERS (the `fx/puffPool.ts` lesson), so the first press of B pays them in
    one frame — a debug tool hitching once on the frame you asked for it. Hidden
    layers cost nothing until shown (`_projectObject` skips them).

  The task runs at
  `{ before: autoRenderTask }` (render time) for the CarWheels reason — a
  physics-task integration pulses against the interpolated body. 'rig' view
  hides the car's MESHES and only meshes: the headlight projectors and the
  exhaust pop light / tail spots live in the same subtree, and toggling a
  LIGHT's visibility changes the lights array hashed into every lit material's
  cache key → full scene recompile (the POP_LIGHT rule). Only meshes VISIBLE at
  hide time are recorded and restored — a blanket hide-all/restore-all re-shows
  the GLB's merged wheel meshes that CarWheels keeps hidden after baking, and
  since
  CarWheels mutates the SHARED material those ghosts roll with it: duplicate
  spinning wheels in 'model' and 'both' after a rig visit. The Rapier collider debug
  (extensions/physics panel, Studio-gated) draws world colliders; this draws
  the car's kinematics — they complement.

- **`fx/puffPool.ts` is the smoke primitive** — ONE mesh, ONE material, ONE draw
  call, shared by TireSmoke and the exhaust puffs. Read its header before
  touching either: a pool of N meshes means N material instances, and the
  reason that is expensive is not the reason it looks like.
  Identical node graphs really do share a compiled WGSL program and pipeline
  (three keys them by generated source), but each MATERIAL still builds its own
  node graph the first time it renders — a main-thread NodeBuilder analyze +
  WGSL generation, per material, paid on the frame that material first becomes
  visible. A burnout spawns ~40 puffs/s, so 31 of those builds would land in
  the first second of the first slide — the first-puff hitch. Geometry is
  the SkidMarks pattern: `count` quads, positions in WORLD space written per
  frame, per-vertex `aPuff` (birth, life, strength, seed) written once at spawn
  and aged shader-side against `uTime`. Billboarding is CPU-side against the
  camera's right/up basis — the same arithmetic as a per-mesh
  `quaternion.copy(camera.quaternion)`, minus N matrix compositions. **No
  boot warm**: the mesh is permanently in the graph, so its one
  pipeline compiles on the scene's first rendered frame for free, and dead
  puffs are DEGENERATE (four verts on a point) rather than hidden. The one
  accepted difference: puffs in a pool do not sort against each other by
  depth, because they are one mesh — at these alphas it reads as more stable,
  not wrong. **The MOTTLE is three noise octaves, not two**: roil + clump as
  before, plus a third, much finer read of the same `perlinTex` (already
  bound — no new texture load) at its own scale/drift, blended in narrowly
  (0.75..1) as a detail pass rather than a third source of erosion holes.
  Scaled down from `webgpu_volume_fire.html`'s (vendored three.js-dev example)
  raymarched "detail noise multiplies base density" idea to one extra texture
  sample — needed because TireSmoke's HEAT (below) can now grow a puff past 2x,
  big enough for the original two frequencies to read as one smooth blob
  again. **`ageTint`, optional per pool**: a colour a puff is BORN at, mixed
  toward `color` across its life by the same age `t` erosion uses — one flat
  tint for a puff's whole life is the sticker tell restated in colour instead
  of alpha, and fresh material doesn't always look like dispersed material
  (TireSmoke uses it: sootier off the rubber, pale gray once thinned). Omitted
  by every other consumer (exhaust cough, nitrous jet, impact dust) — flat
  reads fine for those, so it costs them nothing.
- **`TireSmoke.svelte` (fx/) is the squeal made visible** — a `puffPool` of 64,
  spawned CONTINUOUSLY at the contact patches while a wheel slides: rate =
  2 + 8×intensity puffs/s per wheel, so a brief squeak is a wisp and a burnout
  builds a proper cloud. Intensity is the squeal/marks TWIN with ALL SIX
  sources — cornering load included (max banking sings hot enough to smoke a
  little): rears get wheelspin/slide/handbrake/launch/brake/cornering, fronts
  slide/brake/cornering. LIT, not unlit (the skid-marks lesson):
  MeshStandardNodeMaterial, near-white albedo — bright gray against day
  asphalt, dims with the environment at night instead of glowing; the billboard
  normal points at the camera, so no normalNode. **Puffs are born OUTBOARD of
  the wheel's own centreline** (`SMOKE_OUTBOARD` — half the tyre's width, the
  same measured number SkidMarks' ribbon uses, plus a little for the fender
  lip), not on it: a puff spawned dead-centre on the wheel starts inside the
  tyre/fender's own depth, so the bodywork's opaque geometry clipped the
  growing quad in a hard flat line instead of a soft cloud edge. Velocity =
  lazy rise + a LAGGED share of the car's motion (smoke trails behind a moving
  car) + a small rearward roll off the spinning tyre (rears roll harder) + a
  matching OUTWARD kick (bigger on the rears) that carries the puff clear of
  the fender instead of drifting back into it; perlin roil + cellular clumps +
  soft radial rim. **A per-wheel HEAT, 0..1** (`HEAT_UP`/`HEAT_DOWN`) climbs
  over ~4s while that wheel is actively smoking and falls back faster once it
  stops, scaling newly-spawned puffs' SIZE (`s0`/`grow`) — so a held burnout's
  cloud keeps thickening the longer it runs instead of streaming at one
  constant puff size the moment it crosses `SMOKE_ON`. Deliberately never
  touches spawn rate or lifetime: both are already tuned close to the pool's
  ceiling (the POOL bullet below — a two-wheel burnout wants ~26 of the 64
  alive, a four-wheel slide ~52), and a bigger puff costs fill rate, not ring
  slots, so it cannot cause the early-recycle popping raising either of those
  would. Uses `puffPool`'s `ageTint`: a sootier, burnt-rubber gray at birth
  mixing to the pale dispersed gray as the puff ages, rather than one flat
  tint for its whole life. World-anchored at TestGame root
  (`target={chaseAnchor}`, same body-space wheel offsets as SkidMarks — both
  from the spec's geometry via `wheelPatches`, one shared source). The task runs
  `{ before: autoRenderTask }`, i.e. after Rapier's synchronization, so a puff
  spawns at the pose that is about to be drawn.
- **`CarExhaustFlames.svelte` (fx/) pops fire on downshifts and limiter bangs**
  (adapted from three's `webgpu_tsl_vfx_flames`). The exhaust tips are
  MEASURED, not placed by hand: the GLB's Draco `Nickel_Smooth` mesh decoded
  offline (node + the draco wasm from `node_modules/three`), rear-most
  vertices clustered — two rings at model (±0.446, 0.293, 2.053), nose −Z.
  `DEBUG_TIPS` (currently false) draws wireframe cones there; the constants
  move with a model swap. Mount is car-local (inside the ×2.5 group, model
  metres). Each tip is additive THREE radial planes (0°/60°/120° about the
  jet axis — two crossed read flat from halfway angles) + a rear-facing blob
  (a chase cam sees the jets edge-on) + a soft GLOW halo that flares on
  ignition (~150 ms) — the same flash value blows the flame width up at
  birth, which is the bang. Per-tip material instances — identical node
  graphs, so shared compiled programs, but independent intensity/flash/phase
  uniforms, which is how one pipe can bang harder than the other. No
  billboarding (the jet shoots REARWARD with the car).
  **THE POP THROWS REAL LIGHT** — one `PointLight` on the same flash value as
  the glow halo (nitrous floor included, colour crossfading to blue with the
  palette), so a bang lights the road and the car's rear instead of glowing at
  nothing, and a spray leaves a steady blue wash. Three rules come with it, all
  spelled out at `POP_LIGHT_*` in the file:
  - **It is mounted permanently and only `intensity` moves.** Gating a light
    with `visible` — or toggling `castShadow` — RECOMPILES EVERY LIT MATERIAL
    IN THE SCENE. three's `_projectObject` skips invisible objects before
    `renderList.pushLight()` (`Renderer.js:3082`), and
    `LightsNode.customCacheKey()` hashes each light's `id` and `castShadow`, so
    the lights array is part of every material's cache key. Per-pop toggling
    would be a full recompile several times a second. `CarHeadlights`
    follows this (`light.intensity = on ? m.intensity : 0`); so does the pop
    light.
  - **It is one of the scene's SEVEN lights** (sky key + sky fill + two headlight
    projectors + the `CarTaillights` pair), i.e. deliberately over
    `DOCS/best-practices.md` §4's three-light guideline.
    The standing cost is one more light evaluated per fragment of every lit
    material, always, even at intensity 0 — there is no way to have it
    available and not pay. The budget that pays for it is the shadow scoping
    in `DOCS/testperf.md` §1.1. It does not cast shadows: a
    shadow-casting PointLight is six shadow renders.
  - **ONE lamp for both pipes**, because two sources 0.9 m apart lit for 150 ms
    are not resolvable. The per-pipe asymmetry survives anyway — `fire()`
    slides the light along X toward whichever pipe won the energy roll.
  - `POP_LIGHT_DISTANCE` is in **WORLD units, not the model metres the rest of
    the file is authored in**: `PointLightNode` compares `light.distance`
    against a view-space length, so the car's ×2.5 group does not scale it.

  The trigger is the physics task watching
  `carSim.gear` drops into ≥1 (N/R never pop) sized by rpm, plus `limiting`
  rising edges. NO TWO POPS ALIKE: every pop rolls a STYLE — CRACK (short,
  sharp, can double-bang 60–130 ms later), BURN (long, lazy, slow noise) or
  BALL (wide fireball, big white core, heavy embers) — driving amplitude,
  decay, length, width, shader stretch/noise-speed/core-size via `uStyle`
  (branchless step/mix selects), per-tip energy shares (≈18 % effectively
  one-pipe) and per-tip noise phase. NITROUS recolours and extends the whole
  stack: `carSim.nitrous` (written by TestGame's task, same parent-first
  ordering) drives `uNitro`, a GLOBAL uniform that crossfades every layer's
  palette to a cold one (flame gradient indigo→royal→electric→ice via a second
  gradient texture, icy ember rims, deep-blue glow), so pops landing mid-spray
  bang blue. The same flow floors both tips' energy (a steady PILOT jet, no
  style roll — max(), so a pop on top still reads as a bang) and floors the
  flash faintly so the glow halos stay lit while spraying. SMOKE: every bang
  also coughs puffs — a `puffPool` of 16 (see the puffPool bullet above).
  WORLD-ANCHORED, unlike the flames:
  parented to the scene root (not the car), spawned at the tip's world
  position, so a puff hangs in the air while the car drives away; velocity
  inherits a lagged share of the car's motion plus a rearward jet (at speed
  they nearly cancel — the puff hangs where it was coughed). NORMAL blending
  (smoke dims what is behind it — the opposite job to the additive flames),
  graphite colour, perlin ROIL crawling through the quad + cellular clumps +
  a soft radial rim. Puffs update BEFORE the tips-visible early return — a puff
  outlives its bang. While a pop is visible the component owns
  an `invalidate()` reason (stationary rev-match case — driving is already
  covered by the chase camera). Noise textures come from `fx/noiseTextures.ts`
  (`public/textures/noises/{voronoi,perlin}.png`, copied from the vendored
  three.js-dev example assets), SHARED with SkidMarks and TireSmoke — one fetch
  and one GPU texture per file for the whole scene, and therefore never
  disposed by a single consumer.
  **TWO TASKS, ON PURPOSE.** The TRIGGER stays in `usePhysicsTask`: a limiter
  bounce is a rising edge of `carSim.limiting` that can come and go inside one
  rendered frame, so polling it per frame would silently drop bangs. Everything
  VISUAL — energy decay, the uniforms, tip visibility, the group scale, the
  smoke pool, the `invalidate()` — is a `{ before: autoRenderTask }` task, never
  the physics task: the simulation stage takes `ceil(accumulator / rate)`
  substeps, so a physics task runs 3–4× per drawn frame and its `uTime`
  advances by the SUBSTEP TOTAL — 20 ms / 15 ms / 15 ms on
  consecutive frames at 200 Hz against 60 fps — and the flame's own noise
  animation would pulse on a 20 Hz beat. **WARM WINDOW** (still needed, for the TIPS
  only): the six tip materials are invisible until the first pop, so their
  pipelines compiled on it — a visible hitch on the first downshift. The window
  force-shows both tips at their zero-alpha defaults, and it runs while
  `warmupState.active` — the ENGINE's warm gate (`$core/utils/CLAUDE.md`), so
  the veil is still up and the gate's quiet detector waits for the tips'
  pipelines instead of lifting before them — with the local ~0.3 s countdown as
  the floor for entries that never warm (the Studio panel's instant `setScene`
  has no veil). It lives INSIDE the visual task, after that task's own
  visibility write — anything set at mount would be overwritten before a frame
  ever rendered. The smoke pool needs no warming (see puffPool).

- **`sim/hullContacts.ts` is the one place that reads what the chassis hull is
  actually TOUCHING** — not the ground contact (the raycast springs in
  `suspension.ts` are), but kerbs, barrier bases, a fence scrape. Polled once
  per physics step from TestGame.svelte's own `usePhysicsTask` (right after
  `controller.step`, needs the hull's `bind:collider` as well as the body) and
  published onto `carSim.hullContact*` for anyone to read — `debug/DebugRig.svelte`
  (flashes/tints the hull) and `fx/CarImpacts.svelte` (sparks/dust) both
  consume the SAME numbers rather than each re-deriving them, which is the
  whole point — a second copy is a second place for the same bug.
  **It reads manifolds, never events** — a `sensor` collider (the car's one
  collider is the load-bearing hull, so this would delete its collisions
  outright) throws away position/normal/force; `oncollisionenter` only fires
  the FIRST step of a touch, and a scrape is every step AFTER the first;
  `oncontact` hands back a force with no position. So instead, every step:
  `world.contactPairsWith(hull)` → `world.contactPair(hull, other)` → the
  manifold.
  **It does NOT read solver contacts** (`numSolverContacts()` /
  `solverContactPoint(i)` / `contactImpulse(i)`): verified against
  the installed `@dimforge/rapier3d-compat` directly, a rounded convex hull
  (`roundConvexHull`, what `cars/hull.ts` builds) driven into a static
  `trimesh` (what the barriers are, `world/trackColliders.ts`) genuinely gets
  stopped by the solver — the collision is real — but `numSolverContacts()`
  and `contactImpulse()` report **zero** for that shape pair, for the entire
  duration of the touch, in the installed Rapier/Parry version. Against the
  floor (an analytic `cuboid`, a well-supported pair) those same calls work
  fine. Reading solver contacts is exactly how you build a sparks rig that
  fires on the ROAD and never on a fence/wall hit.
  `numContacts()` / `contactDist(i)` / `localContactPoint1/2(i)` / `normal()`
  ARE populated for every pair this scene has, so this module reads those
  instead: **touching** is `contactDist(i) <= 0` on the DEEPEST contact of the
  DEEPEST manifold this step (a trimesh hands back several manifolds for what
  is visibly one scrape — the deepest stands in for "the strongest" now that
  there is no impulse to rank by), the **contact point/normal** come from
  `localContactPoint1/2`/`localNormal1/2` (whichever side is "ours", per
  `flipped` — local to the COLLIDER, which per `cars/hull.ts` has no offset
  from the RigidBody, so it doubles as the body-local point `DebugRig` draws
  with, no further transform needed) forward-transformed to world by the
  collider's own `translation()`/`rotation()`, and **"how hard"** comes from
  the car's OWN tracked velocity at that point (`v + ω×r`, the same maths the
  old version used for the slide/scratch signal, which never depended on
  solver contacts in the first place) rather than from the solver's absent
  impulse: its component AGAINST the normal is the HIT severity
  (`carSim.hullHitDv`, a real closing speed in m/s), its component ALONG the
  surface is the SCRATCH signal (`carSim.hullSlideMs` + the unit
  `hullSlideDirX/Y/Z`). A HIT is the RISING EDGE of "touching" (wasn't last
  step, is now, closing fast) rather than a Δv-spike test on impulse, with a
  short cooldown against `contactDist` flickering at the threshold for one
  step. `carSim.hullHitSeq` increments on every real hit — the one-shot signal
  a consumer polls for, since the decaying `hullHitFlash` alone can't tell
  "still fading from the last hit" from "a fresh one just landed".

- **`CarImpacts.svelte` (fx/) is the chassis hitting the world, drawn** — a
  pure CONSUMER of `sim/hullContacts.ts`'s signal, with no Rapier imports of
  its own. Two effects off one `carSim.hullContact*` feed: a HIT (the rising
  edge of `hullHitSeq` → a wide spark burst + a cough of dust, sized by
  `hullHitDv / HULL_HIT_FULL_DV`) and a SCRATCH (`hullContact` &&
  `hullSlideMs` above a floor → a continuous spark stream off the scrape
  point, rate scaled by slide speed — there is no per-step "how hard pressed"
  number to also scale it by: the impulse it would come from is unavailable for
  this shape pair (see `sim/hullContacts.ts`'s header); slide speed
  alone still reads as a scrape scaling with how fast it's grinding). Still
  polls from a `usePhysicsTask`, not a render task — `hullHitSeq` can rise and
  `hullContact` can come and go entirely inside one physics step, and this
  runs AFTER `hullContacts.ts` publishes for that same step because
  TestGame.svelte (which owns that publish) mounts first — tasks sharing a
  constraint fall back to mount order. Ballistics + streak-building stay a
  `{ before: autoRenderTask }` task (fx/puffPool.ts's camera-basis rule).
  Pooled, hoisted callbacks, `autoInvalidate: false` — §4 throughout.
  **THE NORMAL POINTS INTO THE CAR, and the emission respects that**:
  `hullNormal*` is oriented toward the chassis COM (the sign the closing-speed
  read needs). Spawning 5 cm INSIDE the skin, kicking along
  the normal and floor-clamping that component fires every spark through the
  chassis; kicking along the flipped normal just buries the stream in the
  wall instead — so the emission does NEITHER: sparks get a share of the
  slide velocity plus an isotropic jitter cone and run IN THE INTERFACE
  between the two surfaces (which is where real grind debris goes), spawned
  2 cm out along the flipped normal. The solids settle the leftovers —
  wall-aimed sparks are depth-occluded and die, and body-aimed ones RICOCHET:
  the pool's `update()` takes an optional oriented box (`SparkBounceVolume`)
  and CarImpacts feeds it the hull BOUNDS (no `margin` — the collider's ~0.13
  fillet would put the face outside the paint, popping every newborn spark to
  it) at `carSim.body*`'s pose, published per step by `publishCarPose` from
  TestGame's own physics task. Inside the box = pushed out through the
  nearest face, velocity reflected only when it still drives inward
  (restitution 0.35, tangential scrub 0.75 — a ricochet, not a bounce
  animation). The same flip keeps the burst's DUST off the paint.
  **`sparkPool.ts` is its primitive**, puffPool's hot sibling: one ADDITIVE
  `MeshBasicNodeMaterial` mesh — a spark is white-hot metal and ADDS light
  rather than dimming, the opposite job to smoke, and it must not be dimmed by
  the night exposure exactly when it should read brightest. A spark is a
  STREAK, not a billboard: the quad is built on the spark's own velocity axis
  (a CYLINDRICAL billboard — the axis is physical and never turned by the
  camera, only rolled about it to face the viewer) and stretched by a shutter
  time's worth of motion (`streak × speed`), which is the smear that separates
  sparks from orange dots. COOLING is age- AND position-driven (the head is the
  particle, the tail is where it was: white → yellow → orange → dull red),
  plus a hard SPUTTER — a `step()` on a per-spark hash, because a tumbling
  spark genuinely blinks out; a field that only fades reads as embers. No
  noise textures: a spark is smaller than one texel of the perlin PNG, so the
  variety comes from the per-spark seed. The dust is a small LIT puffPool
  (road grit, normal-blended — what stops a hard hit reading as fireworks in
  a vacuum). World-anchored at TestGame root (sparks are shed, not carried).

- **`audio/CarEngineAudio.svelte` + `audio/carAudio.ts` are the engine NOTE, positional**. Six
  loops (`public/sounds/engine/`: `idle` + `rpm1..5`) crossfaded by rpm — the two
  layers bracketing the tacho blend while each plays at `rate = rpm/anchor`, so
  pitch rises continuously instead of stepping at band edges. LOUDNESS ANSWERS
  THE TACHO, NEVER THE PEDALS: level = idle→limiter mapped 0.45→0.8 (`BED_IDLE`/
  `BED_REDLINE`, one-pole `LEVEL_SLEW`) — a throttle term was here first and read
  as an echo of the key: lift or downshift and the bed ducked to a 0.22 mutter
  in ~250 ms. Now a downshift blip leans in, engine braking on a lift eases the
  level down at exactly the rate the tacho falls, and the pedals change nothing.
  LIFT-OFF IS THE BED ALONE: no
  one-shot sample — a recorded "release" carries its own pitch envelope and speaks
  twice over a bed already tracking rpm down. EXHAUST POPS: `fire()` in
  CarExhaustFlames also calls `triggerExhaustPop(energy, rightTip)` — every VISUAL
  pop is voiced (downshift bursts sized by rpm, limiter stutters, anti-lag
  double-bangs; N/R and the nitrous pilot jet never call fire, so they stay
  silent). Take choice is a FUZZY crossover on the pop's energy (`exhaustpop1`
  mild below ~0.55, `exhaustpop2` aggressive above ~0.8, coin-flip between) and
  every hit is jittered — volume by energy × randomness, rate 0.88–1.12, a fresh
  randomized lowpass per hit (thunder-clap contract: no two bangs alike). Pops
  are POOLED positional voices (`poly` on the declarations)
  placed at the dominant tip via a per-play `position` (model metres, same
  TIP_L/TIP_R space; polyphonic, so double-bangs overlap), the pool stealing
  oldest past its depth — and at the PANNER-DEFAULT distance curve
  (ref 1/rolloff 1), which POP_GAIN is tuned against (~1/distance
  attenuation; see carSounds.ts's HIT_POS). NITROUS: three voices — `nitrosstart` on ENGAGE
  (flow crosses up through ~0.02), its REVERSE `nitrosend.opus` (made offline via
  ffmpeg `areverse` — buffer sources can't play backwards) on RELEASE (the first
  frame the flow falls while on; pedal lift and bottle-dry are both releases),
  and the `nitrosdrain` LOOP while spraying, volume following `carSim.nitrous`
  (the same flow the flames/camera/HUD read). One-shot semantics (`poly: 1`
  declarations — the registry's cut-and-restart): a re-engage mid-play just goes
  again. IGNITION: the `ignition` slot
  voices the transitions (`turnon.opus` / `turnoff.opus`) and gates everything
  combustive — bed, pops, nitrous all stop when the switch is off. Switching on
  starts a realistic startup: the turnon sound cranks, RPM revs to ~2k then
  settles, and only when the crank's sound ends does `carIgnition.ready` flip true
  (the tick polls the handle at frame rate) and the
  idle bed fade in — throttle, brake and shifting are gated on `ready`. Switching
  off cuts instantly: bed silences under the turnoff shot, `ready` clears, the car
  coasts to a stop. Edge-triggered on the press, and the bed cuts instantly on
  turnoff so the shot lands over silence. GEAR SHIFT: `gear_shift.opus`, one
  bark per engagement — the drivetrain's one-step `shifted` flag is folded into
  `carSim.shiftSeq` in the controller (a SEQ, not a boolean, because physics
  substeps several times per audio tick — `hullHitSeq`'s own contract), Q/E
  taps, the automatic's own shifts and its stopped drop-to-1st all land on it
  since they all run through engage(). Edge-detected in the tick, one-shot
  semantics, synced edge state on detach like the scrape hit, and not
  separately gated on ignition — the controller already gates shifting on it.
  HANDBRAKE: `handbrake_pull.opus` / `handbrake_release.opus`, the ignition
  pair's own shape off `carSim.handbrake` — pull on the rising edge, release
  on the falling, a plain boolean edge (no seq: the handbrake is a HELD level
  that changes at most once per frame, not a one-step event). Cabin-mounted
  between the seats (the lever is the speaker; the squeal's handbrake term
  already voices the tyres it locks). Not gated on ignition — a cable isn't
  combustive, and the handbrake works with the engine off.
  TYRES: `tires_squal_loop.opus`, one voice under the car (axle height at the CG) —
  level = the LOOSEST of wheelspin (ramping from the TC lamp's own 0.15), |slip
  angle| (8°–25°, speed-gated; the cluster's slide flag reads 10°),
  handbrake-at-speed, HARD BRAKE (the pedal at speed, fading below ~20 km/h
  so stops don't end in a squeak), CORNERING LOAD (`carSim.latLoad`, the
  share of the lateral μ·g budget the corner demands — Grip's planted max
  banking lights no other signal, so it sings from ~75% of budget and pins at
  full lock at speed) and LAUNCH (`carSim.launch`, the rev-match chirp — the
  launch boost, full through the drop and easing off with the tail into 1st);
  sources never sum (the looseness model's own rule). Attack 12/s vs release 4/s
  with a snap to 0 so the release asymptote can't hiss. Not
  gated on ignition — tyres aren't combustive. TC LAMP: the cluster's `spinning` indicator gates on the tune's `tractionControl`
  flag — in Drift mode `tractionControl` is false, so wheelspin there is the setup,
  not a system intervening, and the lamp stays off. SCRAPE: the hull-contact
  half of what fx/CarImpacts.svelte draws, voiced off ONE take
  (`metal_scraping.opus`) as two voices — a LOOP under the sills whose level and
  rate ride the same grind the spark stream's rate does (`hullSlideMs` over
  CarImpacts' own 1.4–22 m/s thresholds, duplicated in carAudio and
  ChaseCamera — keep them in step), and a hit SHRIEK on `hullHitSeq`'s rising edge: a
  pooled positional voice at the CONTACT point (a per-play `position`, `hullLocal`
  ÷UPM into the body anchor's model metres — the pops' TIP_L/R rule),
  volume/rate/lowpass jittered (thunder-clap contract), DEADLINE-stopped at
  0.22–0.72 s via `{ duration }` because the take is a 2.4 s scrape and a hit
  is a fraction of one. Not gated on
  ignition — metal on metal isn't combustive either. Edge state SYNCS (never
  resets) on park/detach, or re-entry would voice a hit that landed while
  parked. Frame-rate edge polling is safe because `HIT_COOLDOWN` (90 ms)
  outlasts any frame. The take itself is treated like the bed's wavs: mono
  downmix via explicit `pan` BEFORE the normalization gain (a plain `-ac 1`
  after `-af volume` sums the boosted channels and clips — measured), peak-held
  at ≈-3 dBFS, and built as a SELF-CROSSFADE loop (tail blended with the
  content just before the loop head, so the file's last sample is the source
  sample that precedes its first; join-jump 2941 vs p95-of-deltas 5857 —
  verified, the bed wavs' own standard). The pop wavs are PEAK-NORMALIZED to -3 dBFS
  offline (+6.03/+8.05 dB pure gain — a transient must slam past the bed's
  continuous RMS or it's inaudible) on top of `POP_GAIN` at runtime. The six wavs are
  CUT FOR LOOPING (ffmpeg: self-crossfade construction — each file is the
  crossfade of itself, extracted so its last sample flows into its first;
  verified join-jump < p95 of normal sample deltas), HEAD-TRIMMED to their settled
  segment (measured: every layer had a 1–3.5 s darker/unstable intro that
  replayed as a periodic character wobble each loop wrap — rpm2's head sat
  649 Hz below its settled centroid), and loudness-matched to one
  RMS (-8.4 dBFS) — a new take without that treatment will click on wrap,
  wander, and pump; recover originals via git. Scene-owned, on the ENGINE's
  registry (DOCS/AUDIO.md step 6 — the acceptance pass): the sounds are declared
  in audio/carSounds.ts and mixed in audio/carAudio.ts through the facade, with
  registry handles (live volume/rate, per-play jitter + `position`, `poly` pools,
  `{ duration }` deadlines, the sfx bus) and no raw THREE.Audio left — which is
  also why capture takes now include the car (the offline render replays exactly
  what the facade was told). The tick follows the weatherAudio contract:
  CarEngineAudio.svelte mounts only anchor groups and calls
  `initCarAudio(scope, anchors)` once buffers land, and the module mixes from
  `carSim` in a task, never `$effect`. NO WebGPU compute audio: the
  three.js example is offline batch (process whole buffer → read back → play
  once); live rpm needs per-frame pitch, which three's `setPlaybackRate`
  (setTargetAtTime-smoothed resampling) already does on the audio thread with
  zero readback latency. The tick lives only while the scene is mounted; unmount
  is the scope's `release()`, and tab-hide parking is the engine's (AudioRuntime
  parks loops). `LAYER_RPM` anchors are guesses at the wavs — tune by ear; if
  layers ever get compute-processed, the declaration is where a raw AudioBuffer
  would slot in, not the mixer.
- **`ChaseCamera.svelte` BORROWS the app camera** (`core/Camera.svelte` — the one
  holding the AudioListener) via `<CameraControls>` + `useFollow` from
  `@threlte/extras`, rather than mounting a second `makeDefault` camera. One
  camera keeps the listener, the sky's framing and the post-processing pipeline
  pointed at what is on screen (`Renderer.svelte` rebuilds the whole pipeline on
  a camera swap). It also widens the lens while nitrous flows (`NITROUS_FOV_KICK`,
  60 → 72 at full spray, a `useTask` damped onto `carSim.nitrous`), KICKS on
  rev-match launches (dolly in + FOV widen off `carSim.launch`, snap with the
  drop, ease out with the boost tail), NUDGES on shifts (edge-detected off
  `carSim.gear`: upshift = kickback — dolly out + widen on the post-cut surge;
  downshift = kick in — dolly in + narrow on the engine-braking grab, in sync
  with the exhaust bang; subtle by design — half the launch's magnitude and
  ramped through a one-pole (`SHIFT_ATTACK`) so no frame ever steps, ±`SHIFT_DOLLY`
  /`SHIFT_FOV_KICK`, decaying at `SHIFT_KICK_RATE`), SLAMS on hull hits
  (edge-detected off `carSim.hullHitSeq` — the same one-shot signal
  CarImpacts/carAudio poll; severity off `hullHitFlash`, NOT `hullHitDv`,
  because the seq ticks in the physics stage while this task observes at frame
  rate and `hullHitDv` is overwritten by every still-touching substep — the
  flash is set only on real arrivals and encodes the severity, DebugRig's own
  `FLASH_TIME × (0.5 + 0.5×s)`; dolly in + FOV widen, `HIT_DOLLY`/`HIT_FOV_KICK`,
  max-merged impulse decaying at `HIT_DECAY`, ramped at `HIT_ATTACK` so even a
  slam swells over ~2 frames) and FLINCHES on grinds (a sustained pull-in plus
  a phase-driven TREMBLE on both dolly and lens while `hullSlideMs` is over the
  scrape thresholds — the same 1.4–22 m/s CarImpacts/carAudio use, keep all
  three in step; wobble 4.5–8 Hz rising with the grind, dolly tremble
  unsmoothed, lens tremble low-passed by the FOV pole) — the kicks are per-frame
  deltas on the rig distance, so the player's wheel zoom survives under them
  (base recovered every frame; the sustained pull-ins — launch, hit, grind
  flinch — share one 60%-of-base cap so together they can never shove the
  camera inside the car; the grind tremble rides on top, clamped by
  MIN/MAX). **IDLE ORBIT — the standstill showcase: 5 s under 0.3 m/s and the
  rig orbits the car at 0.18 rad/s (a full 360, a lap in ~35 s) until it
  moves again** (task block in this file; state reset on borrow so a fresh
  spawn gets its own five seconds). trackRotation is GATED OFF while it runs
  — the first cut left it on and its proportional pull-back rejected the
  orbit's additive push at a rate × smoothTime offset (~3.6°): the camera
  nudged aside and stopped, a proportional controller rejecting a
  disturbance, not a lagging orbit. Re-enabled the instant the car rolls, the
  same term swings the camera back behind it through its own 0.35 s
  smoothing — the exit transition is free. Any pointer button held on the
  canvas pauses the orbit (the player's hand is the director); released, it
  picks up where it left off. The FOV is
  borrowed and returned with the pose, re-adopted on every borrow so a re-entry
  can't animate from a stale value, and the task only invalidates on frames
  where the lens actually moves.

  **The rig reads the car's pose from the MAIN stage, which is only correct
  because Rapier's synchronization is pinned ahead of it.** `useFollow` and
  `<CameraControls>` both register plain main-stage
  tasks with no ordering option, and `@threlte/rapier` only constrains
  synchronization to `after: simulation, before: renderStage` — it sorts AFTER
  the main stage by default. Left there, the camera frames the car one frame
  behind where the car is drawn,
  and `useFollow`'s `lookAhead` velocity (`Δposition / delta`) takes its
  numerator from the previous frame and its denominator from the current one.
  The pin lives at the stage, not here — `core/utils/PhysicsWorld.svelte`
  (`DOCS/testperf.md` §1.7).

  Two things not to conclude from that. It is **not** the cause of the car's 4K
  stutter — that is fill rate, closed in §2.6. And **nothing in this file should
  be "corrected" to compensate for a stale pose**: the
  `lookAhead`/`followSmoothTime` values are the feel, not a workaround.

  Two rules come with borrowing:
  - **Save the pose on entry, restore it on exit.** `Camera.svelte` sets its
    vantage once, in `oncreate`, and never re-asserts it — leave the camera at
    the car and every other scene inherits that framing.
  - **Gate on the scene AND on Studio's editor camera.** `useFollow`'s task
    `invalidate()`s whenever it does work, so ungated it pins the on-demand
    render loop at full rate from every scene; and `CameraControls.update()`
    writes position + `lookAt` unconditionally, so it must stand down when
    `camera.current` is Studio's editor camera (`userData.editorCamera`) — the
    collision `extensions/flypath/FlyPath.svelte` documents.

- **`RearViewMirror.svelte` is the rear-view strip** — a 4:1 mirror image of the
  road behind the car, top-centre of the screen (classic NFS). It is NOT a
  `reflector()`: a planar reflector's image is the active camera mirrored across
  its plane, and a chase camera behind the car can only ever see its own side of
  anything mounted on the car — "what is behind me" needs a camera facing
  backwards. So: a fresh `PerspectiveCamera` (layer-0 mask ONLY — see the layer
  rules in `core/skybox/layers/skyLayer.ts`; it therefore skips `LENS_LAYER`,
  so the strip cannot feed back into itself, and `PRECIPITATION_LAYER`, the
  cost gate) rides the chase anchor at the tail, level with a touch of pitch
  down; a `{ before: autoRenderTask }` task (the physics-pose rule — the camera
  reads the body's synced transform) fills a 1024×256 HalfFloat RT with
  HeightField's save/clear/render/restore shape, and an overlay quad
  parented to the ACTIVE camera shows it at a constant screen fraction
  (recomputed from the live `fov` every frame, so the nitrous/launch lens
  kicks resize the world around a steady strip; the quad sits at distance 2,
  past the camera's near of 1).
  - **The RT holds RAW linear HDR** (render-target passes skip the output
    colour transform) and the quad is drawn by the base pass like any lit
    surface — so the mirror is tone-mapped exactly once, in pipeline AND
    low-quality bypass mode. The image is flipped on BOTH axes, for different
    reasons: x for MIRROR semantics (a car overtaking on the right appears on
    the right of the strip, as in a real mirror — an unflipped backward camera
    would put it on the left), y because WebGPU's texture origin is top-left
    while the plane's `uv()` is bottom-left — an RT sampled with a raw `uv()`
    lands upside down (webgpu-notes.md §4's vertical-mirror warning).
  - **The overlay quad is `LENS_LAYER`'s first resident since the rain/frost
    lenses became post effects.** The active camera enables the bit while
    this component is up and gives it back on exit (`skyLayer.ts` keeps the
    layer for exactly this); every internal camera is constructed fresh with
    a layer-0 mask, so nothing re-samples the strip. `transparent` +
    renderOrder 999 draws it after smoke and every other scene transparent;
    depthTest/Write and fog are off. The CASING is a rounded-rectangle SDF
    measured in pixel-proportional space (uv ×STRIP_ASPECT — the one space
    where the corner radius and the ring thickness read uniform on a 4:1
    strip), bottom→top shaded so it reads as a lit rim, with a faint shadow
    onto the glass; the outer edge is an AA feather + `alphaTest` cutout —
    DISCARDED fragments write nothing at all, so the MRT trade below is
    bounded by the VISIBLE SHAPE, not the quad rectangle. The glass forces
    alpha 1 in its `colorNode` — an RT's own alpha channel is clear-colour
    garbage, never an opacity (feeding it through made the mirror
    semi-transparent); `opacityNode` carries the shape mask alone. Known MRT trade
    (postprocessing/CLAUDE.md §“Non-output attachments do not blend”): the
    retained pixels stamp their ~zero velocity over the velocity attachment
    underneath — nothing visible is lost (opaque or the 1px AA band), motion
    blur leaves the mirror sharp (reads as a digital mirror) and AO /
    bloom-Material-mode see the quad's flat inputs under it. A pipeline
    composite would avoid that but is engine surgery for one scene.
  - **Shadows are NOT suspended for the pass.** `SkyLight.svelte` arms
    `shadow.needsUpdate` once per frame and the first pass to render pays it;
    this pass is that first one, so the frame still renders the shadow map
    exactly once and the mirror shows correct shadows (the headlights never
    cast — `LIGHT_CAST_SHADOW`).
  - **The task never invalidates** — TestGame's follow rig already pins the
    render loop while the scene is mounted (testperf.md §2.3); the mirror
    rides whatever frames render. It stands down (no RT fill, quad
    unparented) on Studio's editor camera and while the anchor is missing.
