# TestGame (`src/scenes/TestGame/`)

A standalone tech demo game: a drivable GR86 in a small city, on top of the engine
(Threlte/Rapier/sky/on-demand rendering) but **not part of it**. Nothing here is
engine architecture — do not generalise from this code into `core/` or
`extensions/`, and keep engine docs free of TestGame specifics. The scene pair is
`TestGame.svelte` (3D) + `TestGameHud.svelte` (overlay), mounted like any other
scene via `Scene.svelte` / `SceneHud.svelte`.

```
TestGame.svelte         — the scene: city + car + the driving physics task
TestGameHud.svelte      — HUD shell (controls hint, back-to-menu, restart) + the
                         upper-middle launch flash (STREET / JUICY / PERFECT)
CarCluster.svelte       — bottom-right instrument cluster (tacho ring, gear, speed,
                         live N2O bottle gauge)
CarWheels.svelte        — per-vertex steering/rolling wheel deformation (TSL)
SkidMarks.svelte        — world-anchored ring buffer of rubber quads laid at the
                         tyre patches while the car slides; fades in-shader (TSL)
TireSmoke.svelte        — continuous white smoke puffs at the contact patches
                         while a wheel slides; LIT so it dims at night (TSL)
CarExhaustFlames.svelte — downshift/limiter exhaust pops + the blue nitrous pilot
                         jet (TSL, from the three.js webgpu_tsl_vfx_flames example)
CarHeadlights.svelte    — car-local lights (nose is -Z)
CarEngineAudio.svelte   — the car's positional engine bed, mounted inside the ×2.5
                         group; all mixing lives in carAudio.ts
ChaseCamera.svelte      — chase cam; borrows the app camera (rules below) + the
                         nitrous FOV kick, the launch dolly kick and the shift jolt
NitrousAfterimage.svelte — renders nothing; drives the afterimage effect's runtime
                         boost from the nitrous flow (the lensState contract)
carInput.svelte.ts      — this scene's own keymap (arrows / Space / Q / E / Shift) +
                         the latched switches (lights, ignition, handling tune) + the
                         HUD → scene restart signal
gr86.ts                 — the real car's HARDWARE, pure SI (metres/kg/newtons/seconds)
handling.ts             — the two SETUPS (Grip / Drift): tyre μ, steering rack, oversteer
drivetrain.ts           — pure engine → clutch → 6MT → rear-axle traction step
carMath.ts              — `clamp` / `damp`, shared by drivetrain.ts and TestGame.svelte
carTelemetry.svelte.ts  — carSim (200 Hz plain object) / carHud (30 Hz $state mirror)
carAudio.ts             — the engine NOTE + exhaust pops: rpm voice bands, rpm-driven
                         loudness (never input), pop takes jittered per hit — ticked from
                         carSim (weatherAudio contract — never $effect)
cityColliders.ts        — hand-rolled static trimesh colliders for the track GLB
```

## Controls

Arrows drive (↑ throttle, ↓ brake), Space handbrake, Q/E shift down/up, either
Shift nitrous, L headlights, K main beam, G handling setup, M/N ignition on/off.
Launching is a ritual: sit in N, rev into the 4–6k window (the shift lights
turn green and fill as you go), tap E — a REV-MATCH LAUNCH drops the clutch
clean, and the closer to 6k the harder it plants (≈1 g at the top; the cluster
flashes PERFECT LAUNCH, the tyres chirp); miss the window and the soft street
launch is what you get.
M starts a realistic sequence: the turnon sound cranks, RPM revs to ~2k then
settles to idle, and only when the sound ends does the idle bed fade in and the
car become driveable. N cuts everything instantly — bed, pops, nitrous all stop,
the car coasts to a silent stop. Reverse is a GEAR,
not a pedal: Q past 1st through N into R, then pull away on ↑ — the pedals never
swap meaning, ↓ is only ever the brake. The keys are chosen so Studio's
dev-mode shortcuts (w a s z t r c v m) never fight the car (Shift is a modifier,
invisible to those bare-letter binds), and L/K/G/N also dodge the engine's own
Ctrl+H — EXCEPT M, which is in Studio's set: accepted because Studio is dev-only,
rebind if it ever bites. Input is this scene's own `svelte:window` keymap
(`carInput.svelte.ts`),
not the shared keymapper — that needs a per-scene rework first.

Either Shift is a wet nitrous kit on a throttle switch: it only sprays while held
WITH ↑ open in a forward gear (gear ≥ 1). Both Shift keys are ONE pedal — key
edges go through `setCarInputKey` (held-code tracking), so releasing one while
the other is down keeps the pedal down, and `resetCarInput` clears the held set
so a Shift released while blurred can't stick it. Everything else about the
system is owned by the scene's task — the bottle (4 s of full spray, ~14 s to
refill, runs even while parked), the flow ramp (~0.13 s in, ~0.25 s out) and the
telemetry publish. The one hardware number, `NITROUS_TORQUE_GAIN` in `gr86.ts`
(+45% crank torque), is applied by the drivetrain INSIDE its traction limit — so
a shot in 1st/2nd becomes wheelspin, 3rd+ is real thrust, and Drift + spray in
3rd lights the tyres. `carSim.nitrous` (flow) and `carSim.nitrousTank` (level)
drive the blue flames, the cluster's N2O gauge, the chase camera's FOV kick and
the afterimage smear (`NitrousAfterimage.svelte` easing `uAfterimageBoost` — the
effect is default-enabled at damp 0, so the smear only exists while nitrous
does).

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
(μ·g / v). Pitch AND roll are both disabled on the body
(`enabledRotations={[false, true, false]}`) — only yaw is free. **Rapier's
`enabledRotations` locks WORLD axes, not the body's own** (it rotates the local
inertia tensor into world space first, then zeroes the chosen world axis), so a
lock picked for the spawn heading stops protecting the car's actual roll axis the
moment it yaws away from that heading. World Y (yaw) is the only axis that's
heading-independent, so it's the only one that can be left free while the other
two stay a real, always-on guarantee. (This used to be `[true, true, false]` —
roll-only — which is why the car could occasionally tip up onto two wheels, and
once tipped over nothing gated the drivetrain on the chassis being upright, so a
flipped car could still drive.)

### Two setups, one car

`gr86.ts` is the HARDWARE (engine, gearbox, mass, aero, brakes) and never varies.
`handling.ts` is the SETUP — tyre μ, the steering rack, and the oversteer knobs —
and there are two, picked by `carHandling.mode` (G, or the HUD switch). The scene
and `drivetrain.step()` read `HANDLING_TUNES[mode]` **fresh every physics step**;
nothing caches a tune, so switching mid-corner is legal.

> Both tunes were revised for a friendlier, more arcade feel — more lateral grip,
> quicker steering response, and an easier-to-trigger, easier-to-catch drift. The
> exact numbers below are current; the specific MEASURED figures throughout this
> section (peak yaw °/s, circle diameters, settle times) predate that revision and
> haven't been re-measured — treat them as illustrating the mechanism, not as
> current numbers. `handling.ts`'s own inline comments are the source of truth.

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
  no auto-drop to 1st. You can slot any gear while standing, and a 5 m/s grace
  window (up from 3, for friendlier shifting) lets you shift R/N ↔ 1st while still
  creeping (dead stop not required); the only other refusals are physical: reverse
  above 5 m/s forward (and vice
  versa), and money-shift downshifts that would pass the limiter.
- **The engine feel is in the numbers on purpose**: a torque CURVE through GEARS
  (acceleration falls off and snaps back on every upshift), a clutch fully OPEN
  for the length of a shift (0.28 s torque cut), a slipping clutch below
  `launchSpeed` (launches hold ~3200 rpm), engine braking scaled by gear, a
  bouncing fuel-cut limiter, and a traction limit at the rear axle with load
  transfer (flooring 1st spins the wheels; the leftover is `slip`, which the
  scene turns into lost lateral grip). See `drivetrain.ts`'s header.
- **REV-MATCH LAUNCH**: slot 1st out of N with the revs in the 4–6k window
  (`PERFECT_LAUNCH_MIN/MAX`, judged at the SHIFT TAP — the 0.28 s cut that
  follows lets the revs climb out of it, that climb is the player's timing)
  and the clutch drops CLEAN, with DEPTH in the window setting how hard
  (`launchQ` 0→1 across it): bite scales `clutchMinBite`→1, and the boost —
  rear μ up to `LAUNCH_GRIP_GAIN` (+100%) plus WOT up to `LAUNCH_TORQUE_GAIN`
  (+50%, nitrous-style, inside the traction limit) — is `launchBoost`: held
  through the drop, then decaying at `LAUNCH_BOOST_DECAY` (~1.4 s tail) into
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
  velocity buffer or motion blur smears it against its rest pose. Its steer
  angle and roll rate come from `carSim`, not from raw key state — the rack is
  speed-sensitive, so re-deriving it here would show full lock while the physics
  used a third.
- **`SkidMarks.svelte` lays rubber while the car slides** — one world-anchored
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
  pivots stay in CarWheels); y=0 body space + LIFT 0.90 (tuned by eye to the
  asphalt) is the road at the car. On-demand: invalidate only while laying or
  within the 15 s fade window. One draw call, DoubleSide. THE MATERIAL IS LIT,
  NOT UNLIT — MeshStandardNodeMaterial, albedo ~0.05, normals pinned up once
  at init: a fixed unlit gray lifted by the night exposure is LIGHTER than
  night asphalt, so marks read whitish-gray after dark; lit, they darken with
  the environment (and take fog) like the road — darker than asphalt by day,
  near-black at night. THE QUADS ARE INDEXED, NOT 6-VERT — four verts per
  segment (aL, aR, bL, bR) with both a-verts carrying the previous segment's
  values: the 6-vert version's shared diagonal was a visible triangle/diamond
  pattern. ORGANIC LOOK = lay-time randomness + the vendored perlin PNG
  (public/textures/noises/, first consumer): two world-space samples at
  different scales multiply into a scratch/mottle that also raggers the soft
  rim — stable (world-anchored, no shimmer), continuous along the strip, and
  not one obvious pattern. Plus per-segment width jitter ±12%, tapered starts
  from 0, and one SHORT tail-off segment where a slide ends (capped at
  TAIL_MAX). Enter/exit hysteresis (MARK_ON 0.3 / MARK_EXIT 0.22) stops
  threshold chatter laying confetti.
- **`TireSmoke.svelte` is the squeal made visible** — a pool of 32 billboarded
  quads (the exhaust puffs' architecture: per-puff material instances with dyn
  uniforms, one node graph/one program), spawned CONTINUOUSLY at the contact
  patches while a wheel slides: rate = 2 + 8×intensity puffs/s per wheel, so a
  brief squeak is a wisp and a burnout builds a proper cloud. Intensity is the
  squeal/marks TWIN with ALL SIX sources — cornering load included (max
  banking sings hot enough to smoke a little): rears get
  wheelspin/slide/handbrake/launch/brake/cornering, fronts
  slide/brake/cornering. LIT, not unlit (the skid-marks lesson):
  MeshStandardNodeMaterial, near-white albedo — bright gray against day
  asphalt, dims with the environment at night instead of glowing; the
  billboard quaternion (copied off the app camera per update) orients the
  plane's +Z normal at the camera for free, so no normalNode. Velocity = lazy
  rise + a LAGGED share of the car's motion (smoke trails behind a moving
  car) + a small rearward roll off the spinning tyre (rears roll harder);
  perlin roil + cellular clumps + soft radial rim, aging shader-side against
  uTime. World-anchored at TestGame root (`target={chaseAnchor}`, same
  body-space wheel offsets as SkidMarks); scene gate hides the pool.
- **`CarExhaustFlames.svelte` pops fire on downshifts and limiter bangs**
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
  billboarding (the jet shoots REARWARD with the car) and no extra light (the
  scene is at the three-light cap). The trigger is the physics task watching
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
  also coughs puffs — a pool of 16 billboarded quads, one material instance
  per puff with dyn uniforms (birth/life/strength/seed — the tips' own
  one-node-graph/one-program trick). WORLD-ANCHORED, unlike the flames:
  parented to the scene root (not the car), spawned at the tip's world
  position, so a puff hangs in the air while the car drives away; velocity
  inherits a lagged share of the car's motion plus a rearward jet (at speed
  they nearly cancel — the puff hangs where it was coughed). NORMAL blending
  (smoke dims what is behind it — the opposite job to the additive flames),
  graphite colour, perlin ROIL crawling through the quad + cellular clumps +
  a soft radial rim; aging is shader-side against the shared uTime, the task
  only drifts (with drag), grows and billboards (camera quaternion copy).
  Puffs update BEFORE the tips-visible early return — a puff outlives its
  bang — and the scene gate hides the pool on exit. While a pop is visible the component owns
  an `invalidate()` reason (stationary rev-match case — driving is already
  covered by the chase camera). Noise textures:
  `public/textures/noises/{voronoi,perlin}.png`, copied from the vendored
  three.js-dev example assets.
- **`CarEngineAudio.svelte` + `carAudio.ts` are the engine NOTE, positional**. Six
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
  randomized lowpass per clone (thunder-clap contract: no two bangs alike). Pops
  are CLONES parented at the dominant tip (model metres, same TIP_L/TIP_R space;
  polyphonic, so double-bangs overlap), reaped in the tick when spent and stopped
  by parkCarAudio on scene exit. NITROUS: three voices — `nitrosstart` on ENGAGE
  (flow crosses up through ~0.02), its REVERSE `nitrosend.opus` (made offline via
  ffmpeg `areverse` — buffer sources can't play backwards) on RELEASE (the first
  frame the flow falls while on; pedal lift and bottle-dry are both releases),
  and the `nitrosdrain` LOOP while spraying, volume following `carSim.nitrous`
  (the same flow the flames/camera/HUD read). One-shot semantics (clickAudio
  pattern): a re-engage mid-play cuts and restarts. IGNITION: M/N voice the
  the transitions (`turnon.opus` / `turnoff.opus`) and gate everything combustive — bed,
  pops, nitrous all stop when the switch is off. M starts a realistic startup:
  the turnon sound cranks, RPM revs to ~2k then settles, and only when the sound
  ends does `carIgnition.ready` flip true and the idle bed fade in — throttle,
  brake and shifting are gated on `ready`. N cuts instantly: bed silences under
  the turnoff shot, `ready` clears, the car coasts to a stop. Edge-triggered: the
  keydown, the bed cuts instantly on turnoff so the shot lands over silence.
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
  not a system intervening, and the lamp stays off. The pop wavs are PEAK-NORMALIZED to -3 dBFS
  offline (+6.03/+8.05 dB pure gain — a transient must slam past the bed's
  continuous RMS or it's inaudible; their peaks originally sat AT the bed's
  effective level, fully masked) on top of `POP_GAIN` at runtime. The six wavs are
  CUT FOR LOOPING (ffmpeg: self-crossfade construction — each file is the
  crossfade of itself, extracted so its last sample flows into its first;
  verified join-jump < p95 of normal sample deltas), HEAD-TRIMMED to their settled
  segment (measured: every layer had a 1–3.5 s darker/unstable intro that
  replayed as a periodic character wobble each loop wrap — rpm2's head sat
  649 Hz below its settled centroid), and loudness-matched to one
  RMS (-8.4 dBFS) — a new take without that treatment will click on wrap,
  wander, and pump; recover originals via git. Deliberately NOT core/audio:
  GlobalAudio/soundTriggers are for UI one-shots and weather beds, not a
  scene-local engine following the car's pose — same call as carInput vs the
  keymapper. The tick follows the weatherAudio contract: the component mounts
  `<PositionalAudio>` inside the car (the listener rides the camera), the module
  mixes from `carSim` in a task, never `$effect`. NO WebGPU compute audio: the
  three.js example is offline batch (process whole buffer → read back → play
  once); live rpm needs per-frame pitch, which three's `setPlaybackRate`
  (setTargetAtTime-smoothed resampling) already does on the audio thread with
  zero readback latency. Keep-alive rules apply: the tick is scene-gated, the
  scene-exit cleanup parks the loops (paused progress kept), and tab-hide parks
  too (rAF stops, the AudioContext doesn't). `LAYER_RPM` anchors are guesses at
  the wavs — tune by ear; if layers ever get compute-processed, `<PositionalAudio>`
  `src` accepts a raw AudioBuffer at the mount site.
- **`ChaseCamera.svelte` BORROWS the app camera** (`core/Camera.svelte` — the one
  holding the AudioListener) via `<CameraControls>` + `useFollow` from
  `@threlte/extras`, rather than mounting a second `makeDefault` camera. One
  camera keeps the listener, the sky's framing and the post-processing pipeline
  pointed at what is on screen (`Renderer.svelte` rebuilds the whole pipeline on
  a camera swap). It also widens the lens while nitrous flows (`NITROUS_FOV_KICK`,
  60 → 72 at full spray, a `useTask` damped onto `carSim.nitrous`), KICKS on
  rev-match launches (dolly in + FOV widen off `carSim.launch`, snap with the
  drop, ease out with the boost tail) and NUDGES on shifts (edge-detected off
  `carSim.gear`: upshift = kickback — dolly out + widen on the post-cut surge;
  downshift = kick in — dolly in + narrow on the engine-braking grab, in sync
  with the exhaust bang; subtle by design — half the launch's magnitude and
  ramped through a one-pole (`SHIFT_ATTACK`) so no frame ever steps, ±`SHIFT_DOLLY`
  /`SHIFT_FOV_KICK`, decaying at `SHIFT_KICK_RATE`) — the kicks are per-frame
  deltas on the rig distance, so the player's wheel zoom survives under them
  (base recovered every frame, launch-in clamped to 60% of base). The FOV is
  borrowed and returned with the pose, re-adopted on every borrow so a re-entry
  can't animate from a stale value, and the task only invalidates on frames
  where the lens actually moves. Two rules come with borrowing:
  - **Save the pose on entry, restore it on exit.** `Camera.svelte` sets its
    vantage once, in `oncreate`, and never re-asserts it — leave the camera at
    the car and every other scene inherits that framing.
  - **Gate on the scene AND on Studio's editor camera.** `useFollow`'s task
    `invalidate()`s whenever it does work, so ungated it pins the on-demand
    render loop at full rate from every scene; and `CameraControls.update()`
    writes position + `lookAt` unconditionally, so it must stand down when
    `camera.current` is Studio's editor camera (`userData.editorCamera`) — the
    collision `extensions/flypath/FlyPath.svelte` documents.
