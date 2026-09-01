# Sky render layers (`src/core/skybox/layers/`)

Every renderer that draws on/around the dome, grouped by family:

```
skyLayer.ts      — shared plumbing (see below) — ALL layers use it
celestial/       — Stars, Moon, Meteors, Nebula + milkyWay.ts
clouds/          — CloudDeck
precipitation/   — Rain, Snow, RainLens, SnowLens, HeightField + heightField.ts
lightning/       — Lightning + flashState.ts
fauna/           — Birds (GPU-compute flock)
```

All layers are **descriptor consumers**: they read slices of `descriptor` from tasks,
never props, never `$state` (§14.1, see `../CLAUDE.md`). They mount only in procedural
mode (the `environment`/`cube` modes replace the whole group) and none of them reach the
environment map — `Sky.svelte` bakes the dome mesh alone into the cube camera, so the
deck, moon or a flash never burns a hotspot into the ambient term.

## Shared plumbing (`skyLayer.ts`) — the invariants

- **`instancedQuad(count, corners)`** — one shared four-vertex quad + per-instance
  attributes. Every particle layer used to write each per-particle value four times
  (Rain 1.52 MB → 0.25 MB instanced). The corner arrives as `positionLocal.xy`. Note
  instancing does NOT relieve WebGPU's 8-`maxVertexBuffers` cap — that is why Meteors
  still packs its scalars into two vec4s. Escaping it needs storage buffers.
- **`pinFarPlane(clip)`** — load-bearing, not an optimization. The camera's far plane is
  **144** while the dome sits at radius **1000**; an honestly-projected layer is clipped
  away entirely, and pinning sorts the layer behind all scene geometry for free. Every
  pinned layer also needs `frustumCulled={false}` (bounding volume beyond the far plane
  → culled before it draws).
- **`projectClip(localPosition)`** — the honest-depth counterpart for near-camera
  layers (rain streaks, lens quads) that must be occluded by scene geometry. Written
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
  additive layers would fog *toward* a colour instead of dimming). `toneMapped: true`
  only for layers compositing into the dome's exposure space (CloudDeck, Moon);
  emissive layers (stars, meteors, nebula, lightning) stay untone-mapped or night's
  0.62 exposure dims the one bright thing in a dark frame.
- **`SKY_LAYER_USERDATA`** — engine furniture: never selectable, hidden from the
  Studio tree.

## Ordering (decided in `Skybox.svelte`, where everything mounts)

- **Draw order** = render queue + `renderOrder`: 1 (Nebula, Stars, Meteors), 2 (Moon),
  2.2 (Birds — under the deck, over the moon), 2.5 (CloudDeck — occludes the moon),
  2.6 (bolt), 3 (Rain, Snow — nearest), 4 (the faint lightning sky wash),
  **10 (RainLens) / 11 (SnowLens)** — the lens layers read back the finished frame
  via `viewportMipTexture`, so everything they refract must have drawn first. That
  ordering is load-bearing, not tidy.
- **Task order** falls back to mount order among `before: autoRenderTask` tasks; the one
  real dependency is Lightning → CloudDeck (flash published and read in the same frame).

## Families

### `celestial/`

- **Never `THREE.Points` for sized points on WebGPU** — every point clamps to 1 px and
  `sizeNode` is silently ignored (`DOCS/webgpu-notes.md` §1.1). Quads only.
- `milkyWay.ts` defines the galactic band ONCE because Stars (density) and Nebula (the
  unresolved glow) must agree — if they drift, the star band and the light band
  separate and the illusion collapses. The band is asymmetric (bulge toward
  `MILKY_WAY_CORE`) on purpose; an even ring is the clearest "generated sky" tell.
- Star placement is also rejection-sampled against a build-time CPU port of the
  Shadertoy "Star Nest" march (see Stars.svelte): the fractal's clumping — star
  clouds carved into the band's river, knots/filaments/voids off it — at zero
  per-frame cost (the demo's raymarch is ~8x the Nebula's fragment budget). The
  nest field is frozen (one static slice of the demo's fly-through); change its
  constants and the placement stats in the comments were measured, not guessed —
  re-measure before retuning.
- Moon is a **sphere**, phase from the surface normal (better than the sketched
  billboard: an equirect map wraps properly). Tidally locked. `frustumCulled={false}`
  mandatory (see pinFarPlane).

### `clouds/`

- CloudDeck is the heavy-weather mass SkyMesh's fbm layer cannot render past ~0.52
  coverage. `NormalBlending` + `BackSide` + **tone-mapped**: a storm deck must be able
  to DARKEN the sky behind it (additive can only add light) and must live in the dome's
  exposure space or it survives exposure changes as a stuck-on decal.
- **Wind scroll is a self-accumulated UV offset. Never drive `SkyMesh.cloudSpeed` with
  `wind`** — that uniform is multiplied by absolute elapsed time inside SkyMesh, so
  changing it teleports the whole cloud pattern. The deck accumulates its own offset in
  a task, which is the sanctioned home for wind-driven motion.

### `precipitation/`

- `heightField.ts` is the world knowledge the vertex-node particles lacked: a small
  orthographic depth-ish map (rendered by `HeightField.svelte` looking straight down,
  the sky group hidden for the pass — it is mounted outside and before the group it
  hides). **Contract: `.r` = surface world Y, `.a` = 1 where something was drawn.** Consumers
  treat `a == 0` as "no surface" = the old fall-through behaviour, so a missing pass
  degrades gracefully instead of hanging drops in mid-air. The render target is created
  at module scope so its identity is stable before any material bakes
  `texture(target.texture)` into its node graph — swapping a texture under a live
  material invalidates its cache key.
- Rain/Snow animate entirely in the vertex node (a `fract()` sawtooth through a
  camera-anchored box, zero CPU per particle) — that design is why the height field
  exists as a texture rather than geometry queries.
- Amounts come from `rainAmount`/`snowAmount` (the `precipitationType` split; sleet
  renders both). Snow's flakes dim with the light hints, so a night snowfall reads
  faint and cool. Lens layers: `RainLens` wets/dries with hysteresis (quick to wet,
  slow to dry), `SnowLens` is dendritic frost creeping in from the edges, slow both
  ways. Both are post-processing without a pipeline — screen-space quads reading
  `viewportMipTexture`, drawn last (renderOrder 10/11).

### `lightning/`

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

### `fauna/`

- **Birds is the one layer that is NOT stateless in `time`** — and the design split
  matters more than the GPU cost it explains. Stars, Rain and Snow are pure functions
  of the TSL `time` node; a flock is separation/alignment/cohesion between persistent
  neighbours, so each bird carries position/velocity/flap phase in `instancedArray`
  storage buffers integrated by two `renderer.compute()` passes from the layer's task.
  Storage-in-vertex is also what escapes the 8-`maxVertexBuffers` cap — which is why
  the app's renderer requests `maxStorageBuffersInVertexStage: 3` (App.svelte).
- **Few flocks and strays from ONE pass**: every bird carries its own flock ANCHOR in
  a read-only storage buffer (read in the compute pass only, so the vertex stage stays
  at three storage buffers). Anchors sit far apart — well outside the ~12-unit
  interaction zone — which is what keeps flocks from merging; strays are one-bird
  "flocks", and a speed FLOOR in the clamp keeps them flying loops instead of damping
  onto their anchors (birds do not hover).
- **The anchor is a seed, not a leash**: the pull target WANDERS on incommensurate
  sines (seeded per flock from the anchor, plus a smaller per-bird drift), and the
  pull strength breathes on a slow sine — a constant pull to a fixed point is a closed
  orbit, and a flock lapping one visible circuit reads as birds on rails. Gust
  turbulence scaled by the wind channel rides on top. All of it runs off the layer's
  own accumulated `uTime`, not the TSL `time` node (§15.7).
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
