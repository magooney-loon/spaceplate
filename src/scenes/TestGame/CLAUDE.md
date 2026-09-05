# TestGame (`src/scenes/TestGame/`)

A standalone tech demo game: a drivable GR86 in a small city, on top of the engine
(Threlte/Rapier/sky/on-demand rendering) but **not part of it**. Nothing here is
engine architecture — do not generalise from this code into `core/` or
`extensions/`, and keep engine docs free of TestGame specifics. The scene pair is
`TestGame.svelte` (3D) + `TestGameHud.svelte` (overlay), mounted like any other
scene via `Scene.svelte` / `SceneHud.svelte`.

```
TestGame.svelte         — the scene: city + car + the driving physics task
TestGameHud.svelte      — HUD shell (controls hint, back-to-menu)
CarCluster.svelte       — bottom-right instrument cluster (tacho ring, gear, speed)
CarWheels.svelte        — per-vertex steering/rolling wheel deformation (TSL)
CarHeadlights.svelte    — car-local lights (nose is -Z)
ChaseCamera.svelte      — chase cam; borrows the app camera (rules below)
carInput.svelte.ts      — this scene's own keymap (arrows / Space / Q / E)
gr86.ts                 — the real car's numbers, pure SI (metres/kg/newtons/seconds)
drivetrain.ts           — pure engine → clutch → 6MT → rear-axle traction step
carTelemetry.svelte.ts  — carSim (200 Hz plain object) / carHud (30 Hz $state mirror)
cityColliders.ts        — hand-rolled static trimesh colliders for the track GLB
```

## Controls

Arrows drive (↑ throttle, ↓ brake), Space handbrake, Q/E shift down/up, L
headlights, H main beam. Reverse is a GEAR, not a pedal: Q past 1st through N into
R, then pull away on ↑ — the pedals never swap meaning, ↓ is only ever the brake.
The keys are chosen so Studio's dev-mode shortcuts (w a s z t r c v m) never fight
the car, and L/H also dodge the engine's own Ctrl+H. Input is this scene's own
`svelte:window` keymap (`carInput.svelte.ts`), not the shared keymapper — that
needs a per-scene rework first.

Held keys and switches are separate in that module: `carInput` is polled per
physics step, while `carLights` (`on` / `high`) LATCHES on the keydown edge,
ignores auto-repeat, and survives `resetCarInput` — blur and scene exit release
the pedals, not the lights.

## The driving model

ONE dynamic body for the chassis (no per-wheel suspension). The longitudinal half
is a real drivetrain — torque curve → clutch → gearbox → traction limit at the
rear axle (`drivetrain.ts`, all SI, GR86 numbers in `gr86.ts`). Steering is
DIRECT yaw-rate control — the target is the lesser of what the front wheels
geometrically point at (v·tan δ / wheelbase) and what the tyres can hold
(μ·g / v). Roll is disabled on the body (`enabledRotations`), so the car cannot
tip sideways; pitch survives for slopes.

- **Cornering is the μ, not the damp rate.** Sideways velocity is bled off each
  step, but the bleed is CAPPED at μ·g — that cap is the entire cornering model,
  and the exponential under it only settles the last little bit. μ runs from
  `handbrakeMuLat` (rears locked) to `tireMuLat × LAT_GRIP_GAIN`, interpolated
  across the drivetrain's `gripFactor`, so the handbrake slides and wheelspin
  steps the back out. Without the cap the bleed is an infinitely strong
  constraint (~70 g at `GRIP_RATE`) that snaps the car straight no matter what
  `gripFactor` says, and the handbrake becomes a turn-tighter button.
- **The yaw cap and the bleed cap must use the same μ.** Holding the yaw cap
  costs exactly v·ω = μ·g of bleed per second, so they cancel and a planted car
  never slides. Raise one without the other and the car understeers out of every
  corner. `LAT_GRIP_GAIN` (in `TestGame.svelte`) scales both; it is the one knob
  for "the car won't turn at speed", and 1 is the real car.
- **Speed-sensitive rack:** `steerFalloffSpeed` has to span the speeds the car is
  actually driven at. It was 1.8 m/s once, i.e. fully applied by walking pace,
  which made it a no-op and left `maxSteerAngle` (then 40°, not the ≈29° its own
  comment claimed) as the low-speed feel — that pair was the twitchiness.

- **The model is SI; the world is not.** `gr86.ts` holds the real car's numbers
  (torque curve, 6MT ratios, tyre μ, drag) in metres/kg/newtons, and
  `TestGame.svelte` converts at exactly one boundary: `UNITS_PER_METER = 2.5`, the
  same 2.5 the car's visual group is scaled by (the city is authored at 2.5
  units/metre). Forces and velocities scale by it, rad/s does not. The car's
  `gravityScale` is that constant too — the shared `<World>` pulls at 9.8
  _units_/s², which in this city is 3.9 m/s². Validated against the real GR86:
  0-60 mph 5.7 s (6.1 published), 140 mph governed, redline in 1st at ~50 km/h.
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
