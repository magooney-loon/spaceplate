# TestGame (`src/scenes/TestGame/`)

A standalone tech demo game: a drivable GR86 in a small city, on top of the engine
(Threlte/Rapier/sky/on-demand rendering) but **not part of it**. Nothing here is
engine architecture — do not generalise from this code into `core/` or
`extensions/`, and keep engine docs free of TestGame specifics. The scene pair is
`TestGame.svelte` (3D) + `TestGameHud.svelte` (overlay), mounted like any other
scene via `Scene.svelte` / `SceneHud.svelte`.

```
TestGame.svelte         — the scene: city + car + the driving physics task
TestGameHud.svelte      — HUD shell (controls hint, back-to-menu, restart)
CarCluster.svelte       — bottom-right instrument cluster (tacho ring, gear, speed)
CarWheels.svelte        — per-vertex steering/rolling wheel deformation (TSL)
CarHeadlights.svelte    — car-local lights (nose is -Z)
ChaseCamera.svelte      — chase cam; borrows the app camera (rules below)
carInput.svelte.ts      — this scene's own keymap (arrows / Space / Q / E) + the latched
                         switches (lights, handling tune) + the HUD → scene restart signal
gr86.ts                 — the real car's HARDWARE, pure SI (metres/kg/newtons/seconds)
handling.ts             — the two SETUPS (Grip / Drift): tyre μ, steering rack, oversteer
drivetrain.ts           — pure engine → clutch → 6MT → rear-axle traction step
carTelemetry.svelte.ts  — carSim (200 Hz plain object) / carHud (30 Hz $state mirror)
cityColliders.ts        — hand-rolled static trimesh colliders for the track GLB
```

## Controls

Arrows drive (↑ throttle, ↓ brake), Space handbrake, Q/E shift down/up, L
headlights, H main beam, G handling setup. Reverse is a GEAR, not a pedal: Q past
1st through N into R, then pull away on ↑ — the pedals never swap meaning, ↓ is
only ever the brake. The keys are chosen so Studio's dev-mode shortcuts
(w a s z t r c v m) never fight the car, and L/H/G also dodge the engine's own
Ctrl+H. Input is this scene's own `svelte:window` keymap (`carInput.svelte.ts`),
not the shared keymapper — that needs a per-scene rework first.

Held keys and switches are separate in that module: `carInput` is polled per
physics step, while the latched switches — `carLights` (`on` / `high`) and
`carHandling` (`mode`) — flip on the keydown edge, ignore auto-repeat, and survive
`resetCarInput` and Restart. Blur and scene exit release the pedals, not the
lights or the setup.

## The driving model

ONE dynamic body for the chassis (no per-wheel suspension). The longitudinal half
is a real drivetrain — torque curve → clutch → gearbox → traction limit at the
rear axle (`drivetrain.ts`, all SI, GR86 numbers in `gr86.ts`). Steering is
DIRECT yaw-rate control — the target is the lesser of what the front wheels
geometrically point at (v·tan δ / wheelbase) and what the tyres can hold
(μ·g / v). Roll is disabled on the body (`enabledRotations`), so the car cannot
tip sideways; pitch survives for slopes.

### Two setups, one car

`gr86.ts` is the HARDWARE (engine, gearbox, mass, aero, brakes) and never varies.
`handling.ts` is the SETUP — tyre μ, the steering rack, and the oversteer knobs —
and there are two, picked by `carHandling.mode` (G, or the HUD switch). The scene
and `drivetrain.step()` read `HANDLING_TUNES[mode]` **fresh every physics step**;
nothing caches a tune, so switching mid-corner is legal.

- **Grip** is the car as validated (0-60 in 5.7 s, 140 mph governed). Every number
  in it is what used to be hard-coded in `gr86.ts` / `TestGame.svelte`, and
  `looseBase` / `driftAlign` are 0 with `powerYawBoost` 1, which collapses every
  term below back to the original model — Grip is a no-op against the old behaviour.
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
  - **`looseBase` must stay SMALL** (0.1). It was 0.6, and that was the floatiness:
    the car ran **32° of slip angle just coasting through a gentle corner**, so it
    was permanently sideways with no contrast between planted and provoked. The
    ratio that makes the tune feel good is **2° coasting against 32° on the
    throttle** — looseness has to be EARNED by an input, never baked into the tyre.
    It also caps `driftAlign`, so raising it loosens the car twice over.
  - `throttleLoose` (0.55) is **the friction circle and the main drift control** —
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
  - `brakeLoose` (0.8) is **trail-braking oversteer and the deliberate entry** —
    braking moves ~2 100 N (a third of the static rear load) off the rear axle. Tap
    ↓ into the corner to set the car, then ↑ to hold the angle; measured, a 0.4 s
    tap peaks at 23° and holds ~20° while the car drives out of it.
- **Drift's `latGripGain` is the SAME as Grip's** (1.3). With `looseBase` near
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
- **Drift's `latGripGain` is LOWER than Grip's** (1.05 vs 1.3), which is not a typo:
  the cap and the bleed both run on it and Drift _wants_ them to disagree. A cap
  that asks for more cornering than the bleed can service is precisely a slide.
- **Grip's numbers are not close to drifting, and it is worth knowing by how
  much**: `tireMuLong` 1.05 means only 1st gear ever beats rear traction, and
  `slipGripLoss` 0.55 leaves 45% of the lateral tyre under _total_ wheelspin
  (μ never below 0.88 — more grip than most road cars have at their best).
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
  constraint (~70 g at `GRIP_RATE`) that snaps the car straight no matter what
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

- **The model is SI; the world is not.** `gr86.ts` and `handling.ts` hold the
  numbers (torque curve, 6MT ratios, tyre μ, drag) in metres/kg/newtons, and
  `TestGame.svelte` converts at exactly one boundary: `UNITS_PER_METER = 2.5`, the
  same 2.5 the car's visual group is scaled by (the city is authored at 2.5
  units/metre). Forces and velocities scale by it, rad/s does not. The car's
  `gravityScale` is that constant too — the shared `<World>` pulls at 9.8
  _units_/s², which in this city is 3.9 m/s². Validated against the real GR86 **on
  the Grip tune**: 0-60 mph 5.7 s (6.1 published), 140 mph governed, redline in
  1st at ~50 km/h. Drift is a setup, not a claim about the car — don't re-validate
  against it.
- **Physics runs at a fixed 200 Hz** (`physicsState.framerate`), so a
  `usePhysicsTask` runs 0..n times per rendered frame. Every damping constant in
  the driving model is therefore a RATE in 1/s applied as `exp(-rate * delta)`,
  never a "fraction kept per step" — the latter silently retunes the car whenever
  the physics framerate moves.
- **The gearbox is fully manual** — Q/E walk R ↔ N ↔ 1…6 with no auto-engage and
  no auto-drop to 1st. You can slot any gear while standing, and a 3 m/s grace
  window lets you shift R/N ↔ 1st while still creeping (dead stop not required);
  the only other refusals are physical: reverse above 3 m/s forward (and vice
  versa), and money-shift downshifts that would pass the limiter.
- **The engine feel is in the numbers on purpose**: a torque CURVE through GEARS
  (acceleration falls off and snaps back on every upshift), a clutch fully OPEN
  for the length of a shift (0.28 s torque cut), a slipping clutch below
  `launchSpeed` (launches hold ~3200 rpm), engine braking scaled by gear, a
  bouncing fuel-cut limiter, and a traction limit at the rear axle with load
  transfer (flooring 1st spins the wheels; the leftover is `slip`, which the
  scene turns into lost lateral grip). See `drivetrain.ts`'s header.

## Colliders — the hard-won rules

- **The car body is FRICTIONLESS** (`friction={0}` +
  `CoefficientCombineRule.Min` → min(0, μ) with anything). A one-box car applies
  its drive force at the centre of mass, so contact friction is static friction
  against it — at real gravity the cap (≈0.65·m·g ≈ 20 500 world units) sits
  ABOVE the drivetrain's entire force range (launch ≈ 3 800, traction limit
  ≈ 15 600) and every Newton was cancelled: the car could not move at all. All
  grip — longitudinal AND lateral — is modelled in the drivetrain/task; contacts
  keep normal impulses only. Trade-off: a parked car can creep on slopes steeper
  than rolling resistance holds (~0.75°); hold Space (handbrake force) or a
  brake key if that ever matters.
- **The chassis is a `roundCuboid`** (r = 0.18 m) and it IS the ground contact:
  the box spans model y 0.06..1.16, a touch above the tire plane, so the resting
  tires sink ~5 cm (imperceptible from the chase cam). Rapier's rounding
  DILATES outward (total half-extent = h + r), so r is subtracted from each
  half-extent to keep the outer size; the rounded edges are what lets the belly
  glide over seam lips and kerbs instead of face-stopping. (Four frictionless
  wheel-contact balls at measured pivots were tried on top of this and reverted
  — they never lined up with the visual wheels in-browser; see git history
  before revisiting.)
- **City collision is hand-rolled** (`cityColliders.ts`), not `<AutoColliders>`:
  the trimesh flags cannot be passed through AutoColliders, and without
  `TriMeshFlags.FIX_INTERNAL_EDGES` a flat tessellated road produces ghost
  contacts at internal triangle edges — bumps and snags on perfectly flat
  asphalt. Each mesh's root-relative transform is baked into the vertices (same
  trick as CarWheels). Caveat: with the flag, trimesh contacts become
  effectively ONE-SIDED — a track GLB with flipped winding would let bodies fall
  through. Known seam: `Ground` sits 1.1 cm below `Asphalt` in the track GLB — a
  small lip at asphalt edges the balls roll over.
- **The track GLB is measured, not guessed**: car spans model y 0.01 (tire
  bottoms) .. 1.31 (roof), wheel centres at y 0.335, axles z ±wheelbase/2, track
  x ±0.78. The chassis collider offsets come from those numbers; if the model
  is ever replaced, re-measure (the accessor min/max in the GLB JSON is
  readable without decoding Draco).

## Telemetry, wheels, camera

- **`carTelemetry.svelte.ts` is the plain-object / `$state`-mirror split** the
  sky uses: `carSim` is written every physics step (200 Hz) and read by
  `CarWheels`; `carHud` is quantised and published at 30 Hz for
  `CarCluster.svelte`. The HUD must never read `carSim` — 200 Svelte
  invalidations/second per field for a needle nobody can follow.
- **`CarWheels.svelte` deforms vertices in `positionNode`**, so it also writes
  `positionPrevious` — a vertex-deforming material owns both ends of the
  velocity buffer or motion blur smears it against its own rest pose. Its steer
  angle and roll rate come from `carSim`, not from raw key state — the rack is
  speed-sensitive, so re-deriving it here would show full lock while the physics
  used a third.
- **`ChaseCamera.svelte` BORROWS the app camera** (`core/Camera.svelte` — the one
  holding the AudioListener) via `<CameraControls>` + `useFollow` from
  `@threlte/extras`, rather than mounting a second `makeDefault` camera. One
  camera keeps the listener, the sky's framing and the post-processing pipeline
  pointed at what is on screen (`Renderer.svelte` rebuilds the whole pipeline on
  a camera swap). Two rules come with borrowing:
  - **Save the pose on entry, restore it on exit.** `Camera.svelte` sets its
    vantage once, in `oncreate`, and never re-asserts it — leave the camera at
    the car and every other scene inherits that framing.
  - **Gate on the scene AND on Studio's editor camera.** `useFollow`'s task
    `invalidate()`s whenever it does work, so ungated it pins the on-demand
    render loop at full rate from every scene; and `CameraControls.update()`
    writes position + `lookAt` unconditionally, so it must stand down when
    `camera.current` is Studio's editor camera (`userData.editorCamera`) — the
    collision `extensions/flypath/FlyPath.svelte` documents.
