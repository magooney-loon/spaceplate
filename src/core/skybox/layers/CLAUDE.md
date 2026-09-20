# Sky render layers (`src/core/skybox/layers/`)

Every renderer that draws on/around the dome, grouped by family:

```
skyLayer.ts      — shared plumbing (see below) — ALL layers use it
celestial/       — Stars, Moon, Meteors, Nebula + milkyWay.ts
clouds/          — CloudDeck
precipitation/   — Rain, RainCurtains, Snow, HeightField + heightField.ts,
                   LensDriver + lensState.svelte.ts
                   (the CPU half of the two lens POST effects — see below),
                   WetnessDriver + wetSurface.svelte.ts + wetSurface.ts
                   (wet ground — the one thing here a SCENE calls into)
lightning/       — Lightning + flashState.ts
fauna/           — Birds (GPU-compute flock)
atmosphere/      — DustMotes: near-camera ambient decoration, not precipitation
```

All layers are **descriptor consumers**: they read slices of `descriptor` from tasks,
never props, never `$state` (the descriptor contract in `../CLAUDE.md`). They mount only in procedural
mode (the `environment`/`cube` modes replace the whole group) and none of them reach the
environment map — `Sky.svelte` bakes the dome mesh alone into the cube camera, so the
deck, moon or a flash never burns a hotspot into the ambient term.

## Shared plumbing (`skyLayer.ts`) — the invariants

- **`instancedDisc(count, sides = 8)`** — a regular polygon **circumscribing** the unit
  circle, for any particle whose falloff dies at radius 1. A square spends `(4 - π)/4` =
  **21.5% of every sprite's fragments** shading and alpha-blending corners that are
  guaranteed zero; an octagon spends 17% fewer for four extra vertices per instance,
  which on a fill-bound layer is roughly a 60:1 trade. The apothem is 1, so the drawn
  disc and the shader are unchanged — Snow swapped geometry and nothing else.
  `sides = 4` reproduces `CENTERED_QUAD` exactly, which is the check that the
  construction is right. **Wrong tool for Rain**: its streaks are long thin quads whose
  gradient fills the whole shape, so there are no dead corners to reclaim.
- **`instancedQuad(count, corners)`** — one shared four-vertex quad + per-instance
  attributes, rather than writing each per-particle value four times (Rain: 0.25 MB
  instanced vs 1.52 MB per-vertex). The corner arrives as `positionLocal.xy`. Note
  instancing does NOT relieve WebGPU's 8-`maxVertexBuffers` cap — that is why Meteors
  still packs its scalars into two vec4s. Escaping it needs storage buffers.
- **`pinFarPlane(clip)`** — load-bearing, not an optimization. The camera's far plane is
  **144** while the dome sits at radius **1000**; an honestly-projected layer is clipped
  away entirely, and pinning sorts the layer behind all scene geometry for free. Every
  pinned layer also needs `frustumCulled={false}` (bounding volume beyond the far plane
  → culled before it draws).
- **`projectClip(localPosition)`** — the honest-depth counterpart for near-camera
  layers (rain streaks) that must be occluded by scene geometry. Written
  out because those layers read `positionLocal` as their quad corner — feeding it from
  `material.positionNode` would be circular.
- **`billboardClip` / `streakClip`** — must be ONE pure expression: no `.toVar()`, no
  assignment outside an `Fn()` stack. TSL assignments outside one fail with only a
  console warning ("No stack defined for assign operation") and the call is silently
  dropped — an early Stars did exactly that and rendered thousands of zero-area
  triangles.
- **`altitudeOf(center, radius)`** — the ONLY way to read a dome particle's altitude.
  `positionWorld` is the ±1 quad corner since instancing, not the particle. The
  copy-paste era's drifted versions dimmed every meteor 16x.
- **`skyLayerMaterial(opts)`** — transparent, `depthWrite = false`, and
  **`fog = false` is non-negotiable**: sky layers sit at radius ~1000 against fog tuned
  for a 144-unit far plane; any density resolves the whole sky to flat fog colour (and
  additive layers would fog _toward_ a colour instead of dimming). `toneMapped: true`
  only for layers compositing into the dome's exposure space (CloudDeck, Moon);
  emissive layers (stars, meteors, nebula, lightning) stay untone-mapped or night's
  0.62 exposure dims the one bright thing in a dark frame.
- **`SKY_LAYER_USERDATA`** — engine furniture: never selectable, hidden from the
  Studio tree.

## Ordering (decided in `Skybox.svelte`, where everything mounts)

- **Draw order** = render queue + `renderOrder`: 1 (Nebula, Stars, Meteors), 2 (Moon),
  2.2 (Birds — under the deck, over the moon), 2.5 (CloudDeck — occludes the moon),
  2.55 (RainCurtains — below the deck they fall from), 2.6 (bolt), 3 (Rain streaks,
  Snow), 3.1 (Rain rings), 3.2 (Rain burst), 3.25 (Rain near field), 3.3
  (DustMotes — nearest), 4 (the faint lightning sky wash). The lens overlays are
  post-processing chain effects and don't participate in draw order at all (see
  _The lenses left_ below).
- **Task order** falls back to mount order among `before: autoRenderTask` tasks; the
  dependencies all point one way — Lightning publishes the flash and CloudDeck,
  RainCurtains and Rain each read it in the same frame, so Lightning mounts first.
- **Anything that MOVES the camera must run in the main stage, not here.** Six layers
  anchor themselves to `camera.current` in a `before: autoRenderTask` task (Rain, Snow,
  LensDriver, HeightField, Lightning, SkyFog), and a camera driver competing for
  the same constraint loses to mount order — `<Skybox />` is a static import in
  `App.svelte`, so a dynamically-imported driver mounts later and can never get ahead of
  it. `extensions/flypath` was exactly that, and every one of them read the pose a
  frame stale for the whole of a flythrough. The main stage is `before: renderStage`
  structurally, which is the fix; see `extensions/flypath/CLAUDE.md`.
- **A "was that a cut?" test is a SPEED, never a per-frame distance.** Rain and
  LensDriver reject an implausible camera step so a teleport does not lean every streak
  flat or flood the glass. `TELEPORT_SPEED` (480 u/s) is a speed rather than a raw
  per-frame distance precisely so it means the same thing at any frame rate — a
  per-frame distance threshold means something different at 144Hz than in a 30fps
  offline capture take, which is what let a flythrough that read as motion live get
  classified as a cut in the recording of it. Same normalisation `ctx.shutterScale`
  applies to motion blur, and the same rule the engine clock imposes on every task's
  `delta` (`core/utils/CLAUDE.md`).

## Families

### `celestial/`

- **Never `THREE.Points` for sized points on WebGPU** — every point clamps to 1 px and
  `sizeNode` is silently ignored (`DOCS/webgpu-notes.md` §1.1). Quads only.
- `milkyWay.ts` defines the galactic band ONCE because Stars (density) and Nebula (the
  unresolved glow) must agree — if they drift, the star band and the light band
  separate and the illusion collapses. The band is asymmetric (bulge toward
  `MILKY_WAY_CORE`) on purpose; an even ring is the clearest "generated sky" tell.
- **The star field does not rotate**, so it's sampled on the visible **spherical cap**
  rather than the full sphere: nothing applies a diurnal rotation and the centres are
  baked at build time, so a star below the horizon fade's zero point (`HORIZON_MIN`,
  −0.06) is invisible for the whole session. Uniform in `cos(theta)` over the
  restricted range is still uniform by area, so the "band and nest are the only
  anisotropy" contract holds, and a rejection loop would have been the biased way to
  do it. `count` means **visible** stars (2900). Add a rotation one day and the cap
  has to go with it.
- Everything else in the star material is **constant across a star's quad** — altitude,
  airmass, both twinkle lobes, the flicker depth, extinction, the prismatic flutter, the
  colour — and is lifted into two `varying()`s (Snow's `flakeAlpha` trap, below) rather
  than riding the fragment stage. The core/halo falloff is the one genuinely
  per-fragment term and is written as **multiplies, not `pow()`** — `disc` is exactly 0
  over most of the quad and `pow` is `exp2(n·log2(x))`, which is undefined for `0 · −inf`.
- Star placement is also rejection-sampled against a build-time CPU port of the
  Shadertoy "Star Nest" march (see Stars.svelte): the fractal's clumping — star
  clouds carved into the band's river, knots/filaments/voids off it — at zero
  per-frame cost (the demo's raymarch is ~8x the Nebula's fragment budget). The
  nest field is frozen (one static slice of the demo's fly-through); change its
  constants and the placement stats in the comments were measured, not guessed —
  re-measure before retuning.
- Moon is a **sphere**, phase from the surface normal (better than the sketched
  billboard: an equirect map wraps properly). Tidally locked. `frustumCulled={false}`
  mandatory (see pinFarPlane). **There is no phase parameter in the material**, which is
  what the sphere bought: the terminator is `dot(normal, sunDirection)`, so when the
  model's moon lag started advancing through the synodic cycle
  (`../model/CLAUDE.md`) this file rendered every phase with no change at all. The one
  thing it owes the cycle is `newMoonFade` — a new moon is invisible because it crosses a
  bright sky dark side out, and geometry cannot know that; without the fade the
  earthshine term draws a dim blob two degrees from the sun disc.

### `clouds/`

- CloudDeck is the heavy-weather mass with **parallax**, which SkyMesh's plane-projected
  clouds cannot have at any coverage — the dome carries the coverage channel, this
  layer carries the depth. `NormalBlending` + `BackSide` + **tone-mapped**: a storm deck
  must be able to DARKEN the sky behind it (additive can only add light) and must live
  in the dome's exposure space or it survives exposure changes as a stuck-on decal.
- **The mass deck is a marched SLAB, not a projected plane** (`steps` slices between two
  apparent altitudes, front to back, alpha early-out at 0.95 — the loop shape from
  three's `webgpu_volume_cloud`). The motive is parallax: a plane-projected field only
  answers to camera _rotation_, so it slides with translation like a decal. Octaves per
  slice are kept low (fbm3 + fbm2 ridge) — the slices manufacture the detail.
  - **No 3D texture, on purpose.** The example's 128³ volume is 2 MB and 2.1M CPU noise
    calls at boot, and it is a ball rather than a tiling field, so it cannot scroll —
    which would cost the wind accumulator, a hard requirement. The noise stays analytic
    and the slices are sheared apart to decorrelate them.
  - **`uStrength` multiplies the accumulated alpha, never the per-step density.** In the
    density it lands in the exponent, and a half-strength deck comes out nearly as
    opaque as a full one — silently retuning every weather that rides `massFrom`/`massTo`.
  - `steps` is baked into the shader (a TSL `Loop` count), so it is a mount-time
    constant; `opticalDepth` is what makes the deck denser, and it is divided by `steps`
    so the look is step-count independent.
- **Wind scroll is a self-accumulated UV offset. Never drive `SkyMesh.cloudSpeed` with
  `wind`** — that uniform is multiplied by absolute elapsed time inside SkyMesh, so
  changing it teleports the whole cloud pattern. The deck accumulates its own offset in
  a task, which is the sanctioned home for wind-driven motion.

### `precipitation/`

- `heightField.ts` is the world knowledge the vertex-node particles lacked: a small
  orthographic depth-ish map (rendered by `HeightField.svelte` looking straight down,
  the sky group hidden for the pass — it is mounted outside and before the group it
  hides). **Contract: `.r` = surface world Y, `.a` = 1 where something was drawn.** Consumers
  treat `a == 0` as "no surface", so a missing pass degrades gracefully instead of
  hanging drops in mid-air. **World XZ → map UV is flipped on BOTH axes, for two
  unrelated reasons**: X because a straight-down `lookAt` with `up = +Z` builds its
  view basis along world −X, and Z because a render target is sampled with `v = 0` at
  the top — a Z mirror here is self-concealing, since it mirrors about `z = cameraZ`
  and vanishes whenever the camera sits on the world X axis with a symmetric scene.
  The render target is created
  at module scope so its identity is stable before any material bakes
  `texture(target.texture)` into its node graph — swapping a texture under a live
  material invalidates its cache key. **Resolution is per graphics preset**
  (`Skybox.svelte`'s `HEIGHT_FIELD_SIZE`, 320/192), resized in place at runtime via
  `setHeightMapSize` — the texture's identity survives the resize, so consumers baked
  against it need no rebuild (same contract `SkyLight`'s `shadowMapSize` resize relies
  on).
- **`sampleHeightFieldSlope` answers "which way is downhill" for splashes that must sit
  IN a sloped surface, not just at its height** — a forward-difference gradient (two
  extra samples over `sampleHeightField`'s one), read only by Rain's impact rings, not
  by `surfaceAt`'s per-streak call (that would triple the height-field reads for the
  9000 streaks that only ever need "has it hit yet", never the tilt). Rain's ring block
  turns the gradient into TWO things from the same first-order Taylor step, not two
  separate mechanisms: `slope.x·dx + slope.y·dz` (`dx`/`dz` being the offset from the
  sampled impact point) is simultaneously the ring's TILT — replacing the old flat
  `surfaceLocalY` placement, which floated over one edge and clipped into the other on
  a bank — and, once `dx`/`dz` include an accumulated downhill offset
  (`SLOPE_SLIDE_SPEED × progress`, clamped by `SLOPE_MAX` so a curb's near-vertical edge
  can't fling a ring sideways), the ring's SLIDE. On flat ground `slope` is zero and
  both collapse to the original flat, static placement exactly.
- **TSL builds a node in whatever stage CONSUMES it, and only `AttributeNode` lifts
  itself to a varying** — arithmetic on top of one is simply re-emitted per stage.
  `opacityNode` is a fragment node, so naming a motion term in it drags the whole solve
  along: two `fract` wraps, four sin/cos sway terms, a height-field texture fetch,
  three smoothsteps and two matrix multiplies **per blended fragment**, and at these
  sprite sizes most fragments arrive in 2×2 quads the rasteriser shades whole — the
  real cost behind snow's frame rate (`DOCS/best-practices.md` §3.6), not quad area or
  instance count. The rule: **anything constant across a particle's quad goes through
  `varying()`**, as one product rather than one varying per term — Snow's `flakeAlpha`.
  Rain's three materials (streaks, rings, bursts) now follow the same rule.
- Rain/Snow animate entirely in the vertex node (a `fract()` sawtooth through a
  camera-anchored box, zero CPU per particle) — that design is why the height field
  exists as a texture rather than geometry queries. **This is why compute shaders are not
  the answer to precipitation cost**, three's `webgpu_compute_particles_rain/snow`
  notwithstanding: those examples compute because their drops carry persistent state
  (velocity, ripple timers, collision response). Ours are closed-form in `time`, which is
  strictly cheaper than a dispatch, and their cost is FILL RATE — shaded, blended
  fragments — which no amount of compute reduces. Compute here would buy features (real
  bouncing, accumulation), not frames. `Birds` is the layer where the argument does hold.
- **Precipitation is on `PRECIPITATION_LAYER`, purely as a cost gate** (skyLayer.ts).
  Rain is 12 000 instances across three meshes and Snow 11 000, and DemoScene's two cube
  captures each render the whole scene **six times** at 30/15 Hz — the periodic-hitch
  shape. Measured per-frame triangles before/after excluding them from those captures:
  rain median 600k → 312k and its p99 spike frames 1.06M → 478k; snow median 392k → 260k,
  p99 696k → 430k; clear unchanged (the control). The floor reflector still gets them,
  because its virtual camera is a clone and inherits the bit. (LENS_LAYER itself now has
  no residents — see its note in `skyLayer.ts`.)
- **Every axis of that motion is a self-accumulated distance, never `elapsed × rate`.**
  Same rule as CloudDeck's scroll — an unbounded elapsed term multiplied by a uniform
  that moves displaces the whole field by `elapsed × Δrate`, which would sweep the
  entire drop field sideways for the duration of any weather blend and stop dead when
  it finished. Rain's fall (`uFallTime`) and horizontal drift (`uWindTravel`), and
  Snow's `uFallTime` / `uWindDrift`, all accumulate instead. A drift that must be
  re-evaluated at a past time (Rain's splashes) takes a **rollback distance**, not an
  absolute one.
- Amounts come from `rainAmount`/`snowAmount` (the `precipitationType` split; sleet
  renders both). Snow's flakes dim with the light hints, so a night snowfall reads
  faint and cool.
- **A drop is a LENS, so the streaks carry a forward-scattering lobe** toward the key
  (`uBacklight`) ADDED on top of their ambient tint — the same dot product `DustMotes`,
  Rain's own burst glint and `SkyFog`'s `sunInscatter` take, and for the same reason
  (inscattered light is light arriving, so it adds and never mixes). It is what makes
  backlit rain blaze and frontlit rain nearly vanish, which is the whole look of rain on
  film. Two things are deliberately unlike `SkyFog`'s otherwise-identical lobe: the
  exponent is far broader (2.5 vs 6 — a streak is the smear of a whole fall, not a point
  glint, and at 6 the curtain only lights within a few degrees of the key), and the gain
  IS gated on the key's attenuated intensity, because fog scatters light that reached it
  from anywhere while a drop can only forward-scatter light that actually arrived.
- **Lightning lights the rain**, via `flashState` — the same capped envelope the deck,
  the fog and the dome already share, applied uniformly (air lit from inside has no
  single direction). Streak tint lifts toward white, splash light response lifts with
  it, and the distant curtains lift too.
- **The gust CURL is applied to the drawn head, deliberately outside `motionOf`.** The
  `fract` wrap in there is what pins a drop to a world position, and it is only a wrap
  while its argument stays linear in the anchor — a displacement folded inside unpins
  the whole field. It is also **faded to zero at the surface**, which is not decoration:
  the splash layers read the UNPERTURBED solution, so an un-faded curl lands a streak a
  hand's width from its own splash. Wind shear says the same thing physically.
- **Rain's near field ("hero drops") is a separate box, and has to be.** What reads at
  arm's length is a sparse foreground of big out-of-focus streaks, and a uniform 70-unit
  box puts essentially none of its drops there — a subset flag on the main field cannot
  produce them, since the drops would have to happen to be nearby. It is Snow's "flakes
  per unit³ near the camera" rule taken to its limit: ~110 instances in 10 units beats
  9000 in 70 for this job. It is also **not a `motionOf` client**, which is what makes it
  cheap: at that range the height field has nothing to say that matters, and a drop below
  the floor is hidden BY the floor for free (the layer projects honest depth, so scene
  geometry depth-tests it away). Its cost is fill rate per instance, not instance count —
  `heroCount` is the first knob to turn down, and 0 removes the layer.
- **`RainCurtains` is the storm's GEOGRAPHY**, and the one precipitation layer that is
  not a particle field. Rain's box is 70 units: inside it there is weather, outside it
  nothing, so a storm has no size and you cannot watch one arrive. At a kilometre an
  individual drop is far smaller than a pixel, so the honest (and far cheaper) answer is
  a shader — one open-ended cylinder at dome distance, far-plane pinned, shafts drawn
  into the horizon band. Three things in it are load-bearing:
  - **A cylinder, not CloudDeck's sphere**, purely as cost: the effect only ever occupies
    a band above the horizon, and a sphere rasterizes the whole sky to draw it.
  - **The seam closes by construction.** Every shaft frequency is an INTEGER multiple of
    the azimuth, which is exactly periodic over a full turn, so the pattern meets itself
    at `atan`'s ±π branch cut with no blend region. Same requirement `rainLens`'s
    `RADIAL_COLUMNS` solves, reached cheaply because here we choose the frequencies.
  - **It must fade out in fog, and nothing else will do it.** `fog = false` is the
    sky-layer material contract, so without an explicit `1 - fog` gate the curtains hang
    in front of their own fog bank at a kilometre while visibility is a hundred metres.
- **The spray above the splashes is `SkyFog`'s job, not a layer's** (`rainSprayShare` —
  see `../CLAUDE.md`). The rings and bursts draw individual impacts; the churned air over
  them is a ground-fog term, and no number of rings produces it.

#### Wet ground (`wetSurface.ts` + `wetSurface.svelte.ts` + `WetnessDriver.svelte`)

**Wetness cannot be a post effect**, which is why this is the one thing in `layers/` a
scene has to CALL rather than just mount (`applyWetness(material)`, re-exported from
`$core`). It is not a property of the frame, it is a property of a surface, and the two
things it changes feed the lighting rather than sit on top of it — a screen-space pass
has neither the normal nor the BRDF to do it with.

- **Two terms, and they are the physics, not a look.** Wet DARKENS (a water film traps
  light by total internal reflection — less escapes, so the surface reads darker and a
  little more saturated; this is why wet asphalt is nearly black) and it SMOOTHS (the
  film fills the microscopic roughness, so reflections sharpen). Everything people
  reach for instead — a blue tint, an emissive lift, a fresnel hack — is an attempt to
  fake the second without paying for it. We do not have to: the engine already bakes a
  real environment map, so dropping roughness genuinely puts the sky in the floor.
- **The puddle mask is `normalWorldGeometry`, NOT the height field**, and the height
  field was the obvious wrong answer. It is a camera-following 70-unit map that
  `HeightField.svelte` skips entirely below `precipitation <= 0.01` — so it goes stale
  through exactly the drying period when puddles are most visible. The geometric normal
  is always available, free, needs no map footprint, works at any world scale, and
  answers the actual question (water pools where it is level). Geometric rather than
  shaded, so a normal map's bumps cannot punch holes in a flat puddle.
- **Ripples are a ROUGHNESS modulation, not a normal perturbation.** Cheap (no
  `normalNode` to compose with the material's own normal map, no tangent basis), and
  honest: what rain on standing water does to a reflection is SCATTER it, and roughness
  is the scattering term in the BRDF. Perturbing the normal moves the reflection around
  instead, which is swell, not drizzle.
- **There is no activity latch and there cannot be one.** A latch is a pipeline-graph
  decision; these are MATERIAL terms compiled into every wet material's node graph, so
  "leaving them out" means recompiling the scene's materials — the most expensive
  rebuild the engine has. At rest every term is an exact identity instead.
- **The driver mounts OUTSIDE the sky group**, unlike `LensDriver` beside it. The lens
  is the camera's glass and rightly vanishes with the procedural sky; ground water is a
  property of the world, and the scene's materials go on rendering whatever is in the
  sky. Inside the group it would freeze mid-scene and have to hard-reset on teardown,
  dumping the whole floor's albedo in one frame. Weather audio is outside the layers
  for the same reason.
- **Four time constants, and the ordering is the design**: film wets in seconds and
  dries in tens of them; pooling takes a sustained downpour and outlasts the rain by
  longer still. That asymmetry is what makes weather feel like it has a memory rather
  than tracking the channel.
- **It works on a plain GLB material too**, because `NodeLibrary.fromMaterial` copies
  every enumerable key onto the node material it builds — so an own `colorNode` carries
  across. That copy happens ONCE, on first build, onto a DIFFERENT object, which is the
  one real constraint: call it before the material has rendered a frame, and don't
  expect a later assignment to the original to take.
- **`applyWetness` is idempotent, and that is load-bearing rather than tidy.** It takes
  the material's EXISTING node as its dry base, so a second call makes the first call's
  output the second's input and the surface darkens again — permanently, and only on a
  scene RE-ENTRY, since `useGltf` caches GLBs and hands back the same material objects.
  The guard is a module-level `WeakSet` inside the helper, deliberately not left to
  callers: a guard scoped to a component instance is thrown away by exactly the remount
  that causes the bug.
- Rain's impact rings read `uPuddles` (and only that, never the film): a ring on
  standing water is a ripple, a ring on merely damp ground has nothing to ripple.
- **What reads is flakes per unit³ near the camera, not instance count.** Snow's box was
  64×40×64, which spent a third of the field on flakes 25-45 units out — two or three
  pixels each, at the price of a full instance and a full blend. Shrinking the box faster
  than the count (52×34×52, 11 000 → 7 000) draws a third fewer flakes at a HIGHER
  local density. Both numbers are baked at mount, so `Skybox.svelte` remounts the layer
  on a preset change.

#### The lenses left — the rendering half lives in postprocessing, not here

The rain/frost lens meshes are not scene-pass geometry — a fullscreen quad drawn in
the scene pass would overwrite the entire `velocity` and `normal` MRT attachments
(**non-`output` attachments do not blend**), silently degrading motion blur to an
identity transform and doing the same to AO. Overlays belong after post-processing
(`core/postprocessing/CLAUDE.md`), so the rendering half is
`core/postprocessing/effects/rainLens.ts` / `snowLens.ts`: they read **linear working
colour**, not the encoded framebuffer (unbounded HDR, needing bloom's `inputClamp`
treatment), and their mip source is an `rtt()`, not `viewportMipTexture` (which copies
whatever target is bound — meaningless mid-chain).

What lives here is the CPU half:

- **`LensDriver.svelte`** — measures camera speed once for both lenses, reads the
  weather, integrates wetness and frost growth, and writes `lensState`. Renders
  nothing. Mounted **inside the sky group**, so an HDR or cube environment leaves the
  lenses off along with the rest of the group.
- **`lensState.svelte.ts`** — `flashState`'s contract with TSL readers: one writer, and
  the shared values are module-scope `uniform()`s so their identity survives a pipeline
  rebuild. `lensActivity` is the one reactive thing in it, and it is a `structuralTag`:
  a dry lens is left OUT of the graph rather than folded in with a zero uniform, because
  the droplet/crystal fields are evaluated three times per pixel fullscreen and no
  uniform value avoids that. Hysteresis in the driver keeps the latch from thrashing.

Two more things that are load-bearing rather than taste:

- **The rain lens is a WINDSCREEN, not a window.** It only exists while the camera is
  driving into the rain, so the force on the water is airflow, not gravity: the running
  drop layers are evaluated in screen-centred **log-polar** space, where the ported
  shader's own "down" axis is the radial direction and drops stream outward from the
  point the camera is heading at. Log-polar because it is conformal (drops stay round and
  GROW as they travel out, which is the perspective the flow is a projection of). Its
  seam at ±π closes cell-for-cell only if the circumference is an INTEGER number of the
  pattern's columns — that is what `RADIAL_COLUMNS` is, why the second layer's multiplier
  is 2 rather than the source's 1.85, and why the `scale` param does not size those
  layers (a zoom is `log(r) + log(k)`, a phase shift along the flow). Static drops stay
  in cartesian pattern space: they cling to the glass, they do not run.
- **Its coverage is radial too, and applied to the BLEND, not to the field**
  (`clearRadius`). The middle of the frame is where the airflow comes from — the last
  place water reaches on a real windscreen — and it is what the player is looking
  through; beading the whole frame equally reads as a dirty screen rather than as
  weather. Weighting the final `mix` rather than the drop field is what lets drops enter
  the covered region already formed instead of materialising at its boundary, and costs
  one multiply (the field is evaluated either way).
- **`uFlowTime` is a second clock, and the split is the point.** `uDropTime` is a drop's
  own life (beading, fading) and ticks whenever the glass is wet; `uFlowTime` is the
  airflow and all but stops with the camera. One clock either flowed while parked or
  froze drops mid-life while moving.
- **The activity latch threshold is per lens, read off each effect's geometry.** Wetness
  is a blend factor, so any positive value shows and its floor can sit low. Growth is a
  POSITION for the frost front, which does not reach the corners of the frame until
  ~0.086 — below that the effect is a fullscreen pass whose output is provably its input.
  A shared low floor here would keep the snow lens drawing for ~30 s of melt after every
  snowfall.

### `lightning/`

- **The bolt is a function of HEIGHT, and that is its whole cost story.** The channel
  centre, the slope that keeps it from pinching, the along-length flicker and each fork's
  centre/life/width are all `f(y)`; only the distance-to-path maths reads x. In the
  fragment stage that was 68 `sin` per pixel across a quad covering roughly half the
  frame, double-sided, additive, no depth write. They ride `varying()`s off a vertically
  subdivided quad now — the same rule and the same fix as Snow's `flakeAlpha` above,
  applied to rows of one quad instead of to a particle. The subdivision is what makes the
  interpolation faithful: `noise1` is LINEAR value noise, so the path is already piecewise
  linear with breakpoints every `1/2^(k+1)`, and 512 rows put four samples inside the
  finest octave's segment. **The ground wobble stays per-fragment** — it is the one noise
  term that is a function of x, and resolving it through vertices would need columns fine
  enough for its own sixth octave (~6 px at 1080p).
- **Compute is the wrong tool here, for a different reason than precipitation's.** The
  bolt is one quad and ten uniforms: no persistent state to integrate, no neighbours, so a
  dispatch adds work and removes none. Precipitation's argument is "closed-form in `time`
  is cheaper than a dispatch, and the cost is fill rate anyway"; this one is "there is
  nothing to dispatch." `Birds` remains the only layer where the argument holds.
- **Both meshes are warmed at mount** (`warmFrames`), drawn for two frames with their
  envelopes at zero. `visible === false` is the first line of the renderer's
  `_projectObject`, so an invisible mesh has no `RenderObject`, no built node graph and no
  pipeline — all of which then happened inside the frame that showed the first strike.
  `renderer.compileAsync()` cannot substitute: it compiles into the DEFAULT context
  namespace and the base pass renders under a private one (`core/postprocessing/CLAUDE.md`),
  so only a real frame through the real pipeline produces the variant that gets looked up.
  Same family as the light staying mounted at intensity 0, one level down.
- `flashState.ts` is the shared strike state — a mini-descriptor: plain mutable object,
  exactly **one writer** (Lightning's task, which owns the strike scheduler), any number
  of task readers (CloudDeck's in-deck glow, `weatherAudio`'s thunder, Studio's Strike
  button via `requestStrike()`). Same contract as the descriptor, one effect smaller.
- `strikeId` is a **counter**, not a boolean or timestamp: consumers store the last id
  they acted on and compare, so a listener that mounts mid-storm picks up from the next
  strike. A boolean needs a clearer (two writers); time zero is ambiguous.
- `strikeDistance` exists for audio — thunder arrives ~3 s/km later, and that gap is
  most of what makes a storm feel sized. The bolt quad itself draws at a fixed
  `distance` prop (a true-distance bolt would be a few pixels tall).
- `flash` is already attack-softened and **photosafety-capped at the source — never
  scale it back up** in a consumer.
- Both of Lightning's meshes blend additively with a **custom blend that writes no
  destination alpha**. Stock `AdditiveBlending` is `src.a + dst.a`, and a layer that
  carries its coverage in `colorNode` (as the bolt does, to keep `uBolt`'s 1.25 peak out
  of alpha's [0,1] clamp) emits `src.a = 1` over its whole quad. A downstream reader of
  frame alpha — a lens layer multiplying the frame's alpha into its own wetness, say —
  would carry that stamp through as a hard-edged rectangle on every strike; the lens
  layers do not read frame alpha, but the flag stays: the frame's alpha is the canvas's.
  **Any large additive layer that does not put real coverage in `opacityNode` owes the
  frame the same custom blend.**

### `fauna/`

- **Birds is the one layer that is NOT stateless in `time`** — and the design split
  matters more than the GPU cost it explains. Stars, Rain and Snow are pure functions
  of the TSL `time` node; a flock is separation/alignment/cohesion between persistent
  neighbours, so each bird carries position/velocity plus an **attitude vec4** (flap
  phase, roll, previous heading xz) in `instancedArray` storage buffers integrated by
  two `renderer.compute()` passes from the layer's task. Storage-in-vertex is also what
  escapes the 8-`maxVertexBuffers` cap.
  **The vertex stage reads exactly three storage buffers, and that is the budget**:
  anything else a bird must remember goes in the vec4, and anything that never changes
  (plumage shade, per-bird scale) goes in a plain instanced attribute instead. Three is
  what fits under the DEFAULT `maxStorageBuffersInVertexStage` — the renderer requests no
  `requiredLimits` at all (App.svelte builds `WebGPURenderer` with canvas / antialias /
  powerPreference only), because a limit the adapter cannot meet fails device creation and
  drops the whole app to the WebGL2 fallback. Core WebGPU defaults this limit high enough;
  **compatibility-mode adapters can report 0, where the birds material fails to build.
  That is accepted** — the flock is sky dressing, and every other layer is attribute-only.
  On the WebGL2 fallback the layer already goes dormant by design (the `isComputeBackend`
  guard), rather than erroring.
- **A bird banks, glides and has a size** — the three things the reference example does
  not do, and between them most of what stops a flock reading as animated sprites. Roll
  comes off the yaw RATE (chased, not snapped) and is applied **first** in the rotation
  chain, because it turns about the bird's own forward axis and only stays forward while
  yaw and pitch are still ahead of it. The previous heading is stored in the vertex
  node's own `(cos ry, sin ry)` convention, which is what makes the turn a plain 2-D
  cross product with no sign correction. The flap phase always advances; whether the
  wings actually beat is a separate glide term, so a bird leaving a glide picks up
  mid-stroke.
- **Several flocks and strays from ONE pass**: every bird carries its own flock ANCHOR
  in a read-only storage buffer (read in the compute pass only, so the vertex stage
  stays at three storage buffers). Six flocks of ~10 plus strays, not three of ~20:
  three anchors over 360° leaves most bearings empty, and sky dressing you have to go
  looking for is not doing its job. **Anchor spacing is a constraint, not a look** —
  two anchors must stay outside each other's ~12.5-unit interaction zone even at the
  extremes of their wander (±30), so the floor is ~72 units and the shipped layout's
  closest pair is 153. Azimuths are deliberately uneven; evenly spaced flocks read as
  generated the moment you turn on the spot. Strays are one-bird "flocks", and a speed
  FLOOR in the clamp keeps them flying loops instead of damping onto their anchors
  (birds do not hover).
- **The anchor is a seed, not a leash**: the pull target WANDERS on incommensurate
  sines (seeded per flock from the anchor, plus a smaller per-bird drift), and the
  pull strength breathes on a slow sine — a constant pull to a fixed point is a closed
  orbit, and a flock lapping one visible circuit reads as birds on rails. Gust
  turbulence scaled by the wind channel rides on top. All of it runs off the layer's
  own accumulated `uTime`, not the TSL `time` node (same self-accumulation rule as
  CloudDeck's scroll).
- **Placement is a camera contract, not taste**: anchors sit far and LOW (~6-15°
  elevation) because both stock cameras look at the origin roughly horizontally —
  anything overhead is never in frame.
- **Distance is enforced, not hoped for**: no bird below `MIN_ALT` (12 — the ground
  plane and scene furniture live under it) or inside `KEEP_OUT` (60) of the origin,
  where the stock cameras sit within ~13. Soft decelerations in the velocity pass,
  hard clamps in the position pass — neither fires at the shipped anchors. The
  centre-pull also SCALES with distance from the target (a spring, ×0.5 near to
  ×10 far), so wind bends a flock ~40 units downwind at full strength and can never
  carry it off — heavier weather grounds the birds anyway.
- **WebGPU-only by gate, not by crash**: three's WebGL2 backend cannot run the
  reference example (“TODO: Fix example with WebGL backend”), so the task checks
  `renderer.backend.isWebGPUBackend` and keeps the mesh hidden on the fallback.
- The flock is descriptor-driven like the weather: diurnal (fades on the inverse of
  the `starVisibility` ramp), grounded by precipitation/fog (it cannot be fogged —
  `fog = false` is the layer contract), bent downwind by the weather's bearing. It
  draws UNDER the deck (renderOrder 2.2 < 2.5) — where clouds are dense the birds go
  behind them; sky dressing, not actors.
- **Plumage** is a per-bird shade attribute (mostly dark/mid greys, a few pale birds)
  mixing between dark and light ends of the key-light hue — auto-lifted to a varying
  in the fragment stage, the same lift Meteors' brightness rides.
- Scale ratios come from three.js's `webgpu_compute_birds` (zone ≈ 6 wingspans, speed
  15× the limit at integration) — retune against those, not against each other.

### `atmosphere/`

- **`DustMotes` is neither precipitation nor a dome layer**, which is why it is its own
  family rather than filed under either: it doesn't fall with any purpose
  (precipitation's whole vertex-node recipe is built around a purposeful fall), and it
  isn't at radius 1000 (a mote only reads a few metres from the lens, so it uses
  `billboardClip`'s honest depth like Rain/Snow, not `pinFarPlane`).
- **The look is one dot product.** A mote's brightness is `viewDir · keyDirection`
  (camera-to-mote, dotted with the SAME `descriptor.light.direction` `SkyFog`'s
  `sunInscatter` term reads), raised to a sharpness exponent — nearly invisible face-on,
  lit up the moment the camera looks toward the sun or moon. That is the entire
  "dust in a sunbeam" effect; it needs no shadow volume and no relation to `godrays` at
  all, which is what makes it cheap enough to leave enabled by default.
- **Motion is Snow's fract-wrap recipe with the fall speed turned almost off** and a
  per-mote sine wobble on all three axes standing in for the wander snow's coherent
  swirl gives it. Wind drift is a fifth of Snow's rate (`WIND_RATE` 0.4 vs 1.1) and
  phased per-mote rather than by position — dust has no shared "sheet" the way a
  flurry does.
- **The weather gate is a single `opacity` uniform**, not per-instance culling like
  Snow's `alive`: at 260 sparse instances there is no field density worth thinning,
  only an ambiance to dim out in rain, snow, fog or a stiff wind. `windPenalty` has a
  floor (no cut below wind 0.35) so a light breeze doesn't kill the effect outright.
- **Hue and magnitude are separate varyings**, same split as Snow's `flakeAlpha` but
  two terms instead of one: `moteColor` (a vec3, pale ambient grey mixed toward the
  key's own colour by the rim term) can't fold into the same scalar product as the
  brightness terms, so it gets its own lift. Both are still vertex-stage-constant per
  mote — only the disc's inverse-distance speck is genuinely per-fragment.
- **On `AMBIENT_LAYER`** (`skyLayer.ts`), `PRECIPITATION_LAYER`'s reasoning applied to a
  different layer: a few hundred sub-pixel sparkles are not precipitation's
  periodic-hitch shape, but they are pure noise in a 128² cube-capture face and buy the
  baked env map nothing, so the same exclusion applies.
