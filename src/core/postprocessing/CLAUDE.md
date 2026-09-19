# Post-processing engine (`src/core/postprocessing/`)

The effect registry + pipeline builder. The state + Studio panel live in
`src/extensions/postprocessing/` (see its `CLAUDE.md` for effect params/behavior);
`core/utils/Renderer.svelte` owns the built `RenderPipeline`. Nothing hand-wires a
graph — everything is declared in the registry and assembled by the builder.

```
types.ts       — PassRole / Requirement / EffectDef / BuildContext — the declaration shapes
registry.ts    — EFFECT_REGISTRY (the id→def record) + the EffectId / EffectParamMap types
                 derived from it + resolveEnabledSet policy + structuralKeyOf
build.ts       — the builder: base pass, MRT union, chain fold, grade, resolve, fallback
uniforms.ts    — createUniformBag / writeUniformBag — the hot-update path
luts.svelte.ts — LUT catalogue + async load cache (three's nine example LUTs, public/luts/)
transitionState.svelte.ts — the scene transition's shared state: the mix uniform, the
                 snapshot registration, and the cover/reveal API the scene switch awaits
TransitionDriver.svelte — its one writer: capture, hold, dissolve. Mount inside <Canvas>
effects/*.ts   — 16 EffectDefs: ssaa, retro (base) · ao, dof, fogScatter, godrays,
                 motionBlur, rainLens, snowLens, bloom (+lensflare sub-toggle),
                 afterimage, vignette, sceneTransition (chain) · lut (grade) ·
                 smaa, fxaa (AA)
effects/mipSource.ts — NOT an effect: the blurred-copy-of-the-frame helper fogScatter,
                 rainLens and snowLens share, holding the clamp-what-you-sample and
                 configure-uvNode/levelNode-in-place rules in one place
```

## Roles — effects are not peers

Four `PassRole`s exist because a flat enable-grid cannot express the relationships:

- **base** (`ssaa`, `retro`) — mutually exclusive; each _is_ the scene pass
  (`extends PassNode`). None enabled → the default `pass(scene, camera)`. The builder
  asks `basePass.getMRT()` instead of assuming the default — a base pass may provision
  attachments the registry never asked for (pixelationPass did exactly that).
- **chain** (in fold order: `ao` 10, `dof` 30, `fogScatter` 32, `godrays` 33,
  `motionBlur` 35, `rainLens` 36, `snowLens` 37, `bloom` 40, `afterimage` 45,
  `vignette` 50, `sceneTransition` 60) — plain
  colour-in/colour-out, folded in `order` threading `ctx.color`. The progression is
  scene → air → shutter → lens → eye, and the numbers are the only thing enforcing it:
  **two effects sharing an `order` are separated by nothing but their position in
  `EFFECT_REGISTRY`**, which is how `fogScatter` sat at bloom's 40 (and therefore behind
  the weather lenses) until it was moved to 32. Some are TSL `Fn`s,
  not node classes (`motionBlur`, `vignette`, our `dof`) — no instance holds uniforms,
  so **the uniform bag is the only way to animate them**.
- **grade** (`lut`) — after the chain, before resolve, **not** mutually exclusive.
  Added so a LUT and AA can coexist; grading is orthogonal to anti-aliasing.
- **resolve** (`smaa`, `fxaa`) — AA, at most one (two is wasteful and worse-looking).

The MRT set is a **function of the enabled set**, never fixed: the builder unions the
`requires` of every survivor and provisions only that. `viewZ`/`depth` come free from
`PassNode` (`getViewZNode()`) and add no attachment. Live MRT consumers today:
`velocity` (motionBlur), `emissive` (bloom Material mode, provisioned only when the
mode param asks — `requiresValues` on the def) and `normal` (ao).

## The build (build.ts)

1. Resolve the base pass (at most one `role: 'base'`; losers reported as conflicts).
2. Union requirements → MRT set. **If the pass has any attachments, give it a private
   `contextNode`** — not optional, see the shader-cache trap below.
3. Fold chain effects in `order`, threading `ctx.color`.
4. Settle the output colour transform: if any active effect declares `displayColor`
   (`fxaa`, `lut`), turn `pipeline.outputColorTransform` off and fold in **exactly one**
   `renderOutput()`. An effect must never call it itself — two callers tone-map the
   frame twice.
5. Fold grade effects, then the resolve effect last.
6. Assign `pipeline.outputNode`, set `needsUpdate`.
7. The whole build is wrapped in try/catch and falls back to a bare `pass()` on any
   throw — a broken graph must not take the render loop down.

`resolveEnabledSet` (registry) is pure policy shared by panel and builder: quality
`low` drops everything; at most one base and one AA (lowest `order` wins); explicit
`conflicts` enforced the same way; geometry consumers are dropped under a non-default
base pass (verified combinations only). It walks the candidates **in `order` and looks
for a rival among the SURVIVORS**, not among everything enabled — so an effect that was
itself dropped cannot knock out a third (a `conflicts` chain: A beats B, B must not then
beat C), and an `order` tie resolves to one winner instead of letting both through.

## Runtime-modulated effects (the shared-uniform driver pattern)

Some effects are driven at runtime by scene code, not by panel params. The
contract (established by the lenses, reused by afterimage): the shared values are
`uniform()`s created at MODULE SCOPE in a state module (`lensState.svelte.ts` —
or beside the effect itself, when there is exactly one) so their identity
survives a pipeline rebuild, and there is ONE writer (a driver component's task)
and one reader (the effect's `build`). Drivers hard-set their uniforms to rest
on scene exit (their effect teardown) — after the scene unmounts, nothing
schedules the task again to decay them.

- **`rainLens`/`snowLens`** — weather + camera speed, measured by
  `LensDriver.svelte`; DRY effects leave the graph entirely via the
  `lensActivity` structural latch, because a dry lens still evaluates the droplet
  field three times per pixel, fullscreen.
- **`fogScatter`** — the fog band and the weather's `fog` channel, written by
  `SkyFog.svelte`'s task into `$core/skybox/fogScatter.svelte.ts`. Same shape as the
  lenses, including the latch (an inactive scatter still allocates a full-frame target
  and regenerates a mip chain every frame), and the same reason for the hysteresis. Its
  weight is the WEATHER channel alone, never the day curve's haze: the sky sits past the
  band's far edge and takes the maximum blur of anything on screen, which is right inside
  a fog bank and very wrong on a clear evening. **A storm activates this AND `rainLens`**
  — two full-frame targets and two mip chains, the one place the weather-latched effects
  stack. Budget for it there, not in clear weather where neither is in the graph. It
  folds at 32, i.e. BEFORE both lenses: fog is a property of the air and the lenses model
  the glass in front of the camera, so the droplets refract an already-fogged frame
  rather than the fog blurring the droplets.
- **`godrays`** — the key light, its colour and a haze weight, written by
  `SkyLight.svelte`'s task into `$core/skybox/godrays.svelte.ts`. Same shape as the
  lenses, with one thing no other driver has: the module carries a **three object**, the
  `SunLight` itself, because `godrays( depth, camera, light )` consumes the instance at
  BUILD time rather than a uniform at draw time. So the structural tag is
  `light.id` + the latch + whether `light.shadow.map` exists yet (the node reads that
  texture while building, and it does not exist until the first shadow render). Driven
  from `SkyLight` rather than a sibling driver because that is where the key light
  already is — the same reason `keyShadow.ts` is registered from there — which also means
  the shafts survive an HDR or cube environment, where every sky layer unmounts but the
  key light does not.
- **`sceneTransition`** — the scene switch itself, via `TransitionDriver.svelte`. Same
  contract, one extra wrinkle: the driver also owns a RESOURCE (the snapshot `rtt()`),
  which the effect hands over on every build and `Renderer.svelte` clears to `null`
  before every rebuild — a node that dies with its build must never be poked afterwards.
- **`afterimage`** — nitrous trails (TestGame's `NitrousAfterimage.svelte`
  writes `uAfterimageBoost` from the car's spray flow). The OPPOSITE latch
  decision: enabled by DEFAULT with `damp` 0 (a pure passthrough — the node is a
  bright-pass feedback buffer, so damp 0 trails nothing), and the boost adds onto
  the panel's floor inside the shader, clamped at 0.96. No structural latch,
  because every flip is a graph rebuild and a rebuild per nitrous burst is a
  hitch; the always-on cost is one fullscreen composite fetch, which is the price
  of a hitch-free smear. Drivers ease the boost (asymmetric attack/release) so
  trails bloom in and evaporate rather than cut with the bottle.

## Rebuild discipline

**Never pass a raw number to a node factory — always a `uniform()` the pipeline owns.**

- Keeps a handle so param drags write `uniform.value` in place (no rebuild, no disposal).
- Sidesteps the addon `.d.ts` inconsistency (some exports demand `float()`-wrapped
  args, others reject the wrapper; a `uniform()` is accepted by both).
- Node-graph plumbing is deliberately `any`-typed for the same reason — fighting the
  loose `.d.ts`s buys nothing.

Consequences:

- **Structural effect** — depends on the structural key (enabled set + quality + MRT +
  structural params). Rebuilds the graph. Fires on toggle, never on drag.
- **Uniform effect** — walks param values, writes `.value`. Hot.
- `structural` on a def lists params that genuinely need a rebuild: `motionBlur.numSamples`
  (an `int()` bounding a `Loop`) and the LUT choice (a different texture = a different
  graph). Also structural: `bloom.mode` (changes the MRT set) and its lensflare toggles.
- `structuralTag` adds runtime key material the params can't carry: the LUT returns its
  loaded-texture version so an async load triggers exactly one rebuild. The LUT effect
  builds as a **no-op pass-through** until its texture lands — never await in the builder.

## Gotchas — all browser-verified

### The MRT shader-cache trap

`NodeMaterial.setup()` folds the MRT into a material's output **at build time**, and the
build is lazy — first draw, in whatever pass draws first. The compiled shader is cached
under `RenderObject.initialCacheKey`, which contains **no MRT and no render-target
information**. Any other render of the same scene without MRT (Studio's viewport,
`Sky.svelte`'s per-frame `CubeCamera` bake, `HeightField`'s ortho pass) compiles a
one-output shader under the key our MRT pass then looks up. Symptom:

```
Attachment state of [RenderPipeline "renderPipeline_NodeMaterial_22"] is not compatible
with [RenderPassEncoder]. Expects colorTargets [0={RGBA16Float}, 1={RGBA16Float}];
pipeline has [0={RGBA16Float}].
```

Fix (one line in the builder, load-bearing while motionBlur exists):
`basePass.contextNode = isolationContext(basePass.getMRT())` — an empty `context()` gives
identical context _data_ with distinct node _identity_: same generated code, private cache
namespace. Read "the error names _a_ culprit, not the only one" (the encoder aborts at the
first bad pipeline) — and never "fix" this by disabling the env bake; that treats one
racer, not the race.

**Those contexts are memoized on the attachment set and live as long as the module —
a fresh one per build recompiles the entire scene.** `contextNode.id`/`.version` are
hashed into `RenderObject`'s cache key and thence `initialCacheKey`; `RenderObjects.js`
discards any render object whose key moved and `NodeManager` keys the compiled program
off the same value. So a new context identity is every material in the scene rebuilding
its shader, in the frame the new graph first draws. Structural rebuilds are not rare —
the lens effects latch on weather and camera speed and every chain effect declares
`requires: []` — so driving into rain recompiled the whole scene, and again on the way
out. Keying on the attachment set keeps the isolation (a different attachment set never
reuses another's shader) while leaving the cache warm across every rebuild that does not
change it; toggling an MRT consumer off and back on returns to the same namespace.

### `fragmentNode` bypasses MRT entirely

`NodeMaterial.setup()` folds the renderer's MRT into the fragment output on only one of
its two branches; a material with a custom `fragmentNode` emits a single `@location(0)`
no matter what the pass is doing (`outputNode` is fine — it still folds). Fatal inside a
two-attachment pass, with the **same error message as the cache trap** — which is why it
hid behind that diagnosis. Nothing upstream catches it: the WGSL is byte-identical with
and without MRT, so one GPU pipeline gets shared across both contexts (genuine three
bug, unpatched). The culprit was Studio's selection outline (`fragmentNode` for a flat
overlay) — `patches/@threlte__studio` switches it to `colorNode`, which is visually
identical and folds MRT correctly. Dev-only either way.

### Non-`output` MRT attachments do not blend

`MRTNode` seeds blending for `output` only; every other attachment falls to no-blending
—a straight overwrite, alpha ignored, per-pass (a material cannot opt out). So a
**full-screen quad inside the scene pass wipes every non-`output` attachment**, however
transparent: Studio's selection outline stamped zero velocity over the whole buffer and
motion blur became an identity transform. Overlays belong after post-processing, not in
the base pass — the same trap waits for any in-scene fullscreen overlay we add.

Diagnosing any of the three: `src/__debug/mrtProbe.ts` compares declared shader outputs
against context attachments per draw and names the offending material.

### TSL silently widens; a failed build renders as a blank material

Under TSL's promotion rule ("anytype × anytype: use the greater length vector"),
`color.rgb.mul(ao)` is vec4 when `ao` is a `passTexture` — a pass texture is **vec4
regardless of what was written into it**; take the channel explicitly (`aoOut.r`). And a
TSL build failure is not a crash: it logs `THREE.TSL: ...` once and three quietly swaps
in a blank `NodeMaterial`, so it reads as a shading bug. Grep the console for `THREE.TSL:`
before debugging geometry.

### Retro needs a 2D environment map — patched

`RetroPassNode` rebuilds standard materials' reflection term as
`CubeMapNode(texture(envMap))` — but `texture()` builds a **2D** node and `CubeMapNode`
returns already-cubic sources verbatim, so our cube `scene.environment` (what
`Sky.svelte`'s bake produces) got bound to a `texture_2d` declaration.
`patches/three.patch` picks `cubeTexture()` for cube sources.

## Hand-written effects

- **`vignette.ts`** — the template for any future custom TSL effect. Written rather than
  imported because three's (in `CRT.js`) measures distance in raw uv space — always a
  viewport ellipse, never a true circle; a `roundness` param interpolating between them
  is one `mix`. `1.42 ≈ √2` so the falloff reaches the frame corners. Placement: late
  chain, **pre-tonemap** (before tone mapping = real lens falloff; after = crushed
  shadows). Multiplies **rgb** — reattach alpha if the chain value is vec4 there.
- **`dof.ts`** — the basic DoF: `mix(color, boxBlur(color), smoothstep(min, max,
abs(viewZ + focus)))`. The bokeh `DepthOfFieldNode` is not used — performance (this is
  one box blur vs its multi-pass kernel). viewZ from `basePass.getViewZNode()`, no MRT.
- **`fogScatter.ts`** — the frame mixed against a blurred copy of itself on the fog band
  (three's `webgpu_custom_fog_scattering`), which is the scattering half of fog that a
  `fogNode` cannot do: absorption pales a distant silhouette, scattering is what takes
  its edge away. The blur is a **mip level**, not a gaussian — the effect wants a broad
  low-frequency smear and that is what a mip chain already is, via the `rtt()` +
  `levelNode` route the lens effects established. The reference demo uses `gaussianBlur`,
  several taps per pixel for something one bilinear fetch approximates here. The mip
  level RAMPS with the band rather than sitting at its maximum everywhere, or the pixels
  at the camera's feet would be as soft as the horizon.
- **`motionBlur`** — three's Fn is the one sampler addon that does NOT
  `convertToTexture` its input; our wrapper does (an RTT when fed a computed node,
  e.g. anything after the basic DoF), otherwise it throws `inputNode.sample is not a
function`. It also multiplies by **`ctx.shutterScale`** — see below.

### Velocity is per-frame, not per-second — multiply by `ctx.shutterScale`

`VelocityNode` writes `ndc(current) - ndc(previous frame)` and stops there: no delta, no
normalisation. So any smear derived from it scales with the frame's duration — the same
camera move blurs ~5× wider at 30fps than at 144, and `blurAmount` only ever means
something at the rate it was eyeballed on. It stayed invisible because the viewport
usually runs fast enough for the smear to vanish; an **offline capture take** exposed it,
running the engine clock at a fixed `1/fps` step and coming out uniformly blurrier than
anything the viewport ever showed.

`ctx.shutterScale` is a builder-owned uniform (same pattern as `ctx.aspect`) that the
frame task writes as `REFERENCE_FRAME_SECONDS / engineClock.delta`, clamped, with 0
mapping to 1. Multiplying velocity by it turns the smear into a function of **scene-time**
motion — the rule the engine clock already imposes on every task's `delta`
(`core/utils/CLAUDE.md`). It is 1 at 60fps, so every existing default keeps the look it was
picked for. **Any future velocity consumer (a revived `traa`, `ssgi`) has to do the same.**

Deliberately not a per-effect param: it is not a look, it is the unit `velocity` is
missing.

## `godrays` — the one effect that needs a patched three

True raymarched crepuscular rays: the view ray is stepped through the key light's shadow
volume and every unoccluded step adds light, so the beams are cast by real geometry, they
sit correctly behind walls, and **they do not care whether the sun is on screen**. Three
passes, laid out as three's own `webgpu_postprocessing_godrays` example lays them out —
`godrays(depth, camera, light)` → `bilateralBlur` (the march is dithered, and the blur is
what turns dither back into a smooth shaft) → a composite that upsamples the half-res ray
buffer without leaking it across silhouettes.

Only the third is ours rather than the addon's, and the next sections are why.

**It does not work on stock three, and the reason is structural.** `GodraysNode` branches
on `isPointLight` / `isDirectionalLight` in both `_updateLightParams()` and `inShadow()`.
Our key is `SunLight` (`extends Light`, sets `isSunLight`) — neither branch runs, and a
TSL build failure is silent (one `THREE.TSL:` log, then a blank material), so it reads as
a shading bug. Deeper: `SunLightShadow` is **two cascades in one atlas**, where the node
assumes one map, one matrix, one `shadow.camera`.

`patches/three.patch` adds the `isSunLight` branch. Two parts, and the second is the
interesting one:

- **`inShadow()` picks the cascade per raymarch sample**, from that sample's own view
  depth, using `shadow.getMatrix(i)` and `shadow._cascadeData[i]` — the pattern copied
  from `SunShadowNode._setupCascades`. `getMatrix(i)` is already the whole world→atlas-UV
  transform (`LightShadow._updateMatrix` folds in both the 0.5 remap and the viewport
  tile), so nothing extra is needed to hit the right half of the atlas. Walked **back to
  front** like the material path, because the cascade ranges deliberately overlap and the
  nearer cascade should win in the band. No fade blend, unlike the material path: this is
  one sample of a march that averages tens of them, so the seam averages out and a
  `smoothstep` per cascade per step is real cost in the hottest loop we own.
- **The march bounds are the VIEW frustum truncated at `shadow.camera.far`**, not a
  light-space box. That is forced by the same fact that makes `SunLightShadow` worth
  having: the cascades are fitted to the **camera** (`core/skybox/CLAUDE.md`), so the
  region with shadow information in it is the camera's own frustum, and taking the light's
  ortho box would march huge tracts of space the atlas says nothing about. Implemented by
  replacing the frustum's far plane (index 4 of `Frustum.setFromProjectionMatrix`) with
  one at the shadow distance.

**The `.d.ts` cannot be patched** — the bundled declarations are generated, not shipped as
source — so the effect casts the light at the call site. That cast is the type system
being wrong, not us.

### The banding, and where it actually came from

The shafts read as a stack of hard steps rather than a gradient, and the cause was three
separate things in the same pass, each of which quantises the same smooth ramp. All three
are in `patches/three.patch` now; the point of keeping the list is that **each one on its
own is invisible next to the other two**, so fixing one and looking at the result proves
nothing.

- **The ray target was 8-bit.** `new RenderTarget(1, 1, { depthBuffer: false })` takes
  three's default `UnsignedByteType`, and this buffer holds a continuous accumulation that
  a shaft spreads across most of the screen while only ever using the bottom fifth of the
  range — call it fifty usable levels. Nothing downstream can put back a level the buffer
  never stored, so the blur smooths _between_ the contours and leaves the contours. Now
  `HalfFloatType`; `bilateralBlur` copies its input's type onto its own targets, so it
  carries through the chain for free.
- **The dither rolled the sample COUNT, not the sample positions.** Upstream is
  `round(steps + (steps/8 + 2) * noise)` and then places the samples at `i / count`, so at
  48 steps there are nine possible counts and every pixel that drew the same count marches
  the **identical** positions. That is not dither, it is nine deterministic quantisations
  of the same integral, and it bands over whole regions. Offsetting each sample by the
  pixel's own blue noise (`(i + noise) / count`) decorrelates neighbours, which is what
  turns the error into the high-frequency noise the bilateral blur is in the chain to
  remove. Also cheaper — a loop bound straight off the uniform.
- **`clamp(x, 0, maxDensity)` drew a contour line of its own**, a flat plateau with a
  first-derivative break at its rim, across the brightest part of every shaft. Scaling the
  transmittance by `maxDensity` instead has the same ceiling and approaches it
  asymptotically. That is also what turns `maxDensity` into a clean linear gain.

Then a fourth, which is on our side of the line: the bilateral blur's `sigmaColor` was
left at the addon's 0.1 default, **which has to be read against the range of what it is
filtering**. That buffer only ever holds `0..maxDensity`, so 0.1 told the filter to treat
any step bigger than a good fraction of the whole signal as an edge worth preserving —
i.e. to preserve the banding. It is the `blurTolerance` param now, defaulted to about half
the usable range.

### The composite is ours: inscatter ADDS, it does not lerp

`depthAwareBlend` finishes with `mix(scene, blendColor, rays)`. Two things go wrong with
that here, and both of them look like the rays arguing with the shadow map rather than
like a banding problem, which is why they survived the list above:

- **`blendColor` is the key light's colour, magnitude ~1, and the frame is HDR.** Every
  colour the day curve produces sits around 1 (`SUN_ZENITH` is `[1, 0.98, 0.95]`) because
  the magnitude lives in `intensity`, which is `SUN_INTENSITY` 4.75. So the thing the
  shafts mixed toward was **dimmer than most of what they crossed** — sunlit ground, the
  whole dome — and a beam over the sky came out as a dark streak.
- **A lerp is a contrast crush by construction.** It pulls lit pixels down and shadowed
  pixels up toward the same value, so a shaft laid across a shadow boundary erases the
  boundary.

Inscattered light is light _arriving_ at the camera: it adds to whatever it is in front of
and it cannot subtract. So `godrayCompositeFn` (in the effect, `vignette.ts`'s precedent)
adds `keyColour × keyIntensity × rays` instead of lerping. `uGodrayRadiance` is the second
uniform that took, and it is deliberately the **attenuated** intensity, so a deck that kills
the key kills its shafts with it.

**Additive does not read as washed out here.** A broad radial smear with no occlusion in
it really is just a brightness; this is a raymarch whose every edge is cast by real
geometry. The caution does apply to the _gain_, though — see `density` vs `maxDensity` below.

**The sky's weight now lands on `density` alone**, not on `density` and `maxDensity` both.
Multiplying it into both made the whole effect **quadratic in the haze channel** — at half
haze the shafts were a quarter of themselves — so the weather range read as nothing,
nothing, nothing, then all at once. `density` is the physical term (more haze is more
scattering per metre); `maxDensity` is an artistic gain and has no business knowing about
the weather.

### The upsample has no decision in it, and that is the point

The addon's `depthAwareBlend` handles the half-res buffer with an eight-tap poisson search
that ends in `select(uv + push, uv)`. Everything about that is discrete: a hard `lessThan`
threshold decides which taps count, the push direction jumps whenever a tap crosses it, and
the final `select` is binary. **A per-pixel discrete decision is a thing that crawls**, and
what it crawls in response to is camera motion — pixels flip sides frame to frame along
every silhouette in the frame. (It is also quietly broken: it writes
`pushDir.divAssign(count).normalize()` and throws the normalised value away, so the push it
applies is the raw mean offset and `edgeStrength` never meant the pixel count its docstring
claims.)

`godrayCompositeFn` does the standard thing instead — a **joint bilateral upsample**: four
taps at the ray buffer's own texel pitch, each weighted `exp(-|Δdepth| / falloff)` against
the centre pixel's linear depth, normalised, with the centre tap's weight 1 by construction
so the accumulator can never come out empty. Same rejection of the far side of an edge,
reached smoothly, so camera motion moves it continuously. Fewer fetches, too. `edgeRadius`/
`edgeStrength` are gone; `upsampleSpread` (tap pitch, in ray-buffer texels) and
`upsampleTolerance` (the depth window, as a fraction of the pixel's own depth) replace them.

### `density` decides whether the buffer is an occlusion map or a depth map

The single most load-bearing number in the effect, and the least obviously named. The march
is `1 - exp(-illum)` over `illum = rayLength × density × mean(lit × attenuation)`, so
`density` sets **where on the exponential a typical ray sits** and `maxDensity` sets how
bright that is.

Down at the addon's 0.7 a ray is still on the linear part of that curve, which means its
value is dominated by `rayLength` — i.e. by **how far away the surface that pixel sees
is**. The buffer is then a depth map with occlusion as a minor term, and that has two
consequences that both read as "the godrays look wrong" rather than as a tuning problem:

- it lifts everything distant by a flat amount, which is a wash and not a beam;
- **depth is the thing that changes violently when the camera moves.** Geometry sweeping
  through the view swings whole regions of the buffer between "far" and "near", so the
  additive lift lurches about with the camera rather than staying put.

High enough for a typical ray to saturate, the length term falls out of the expression and
what is left is the share of the ray that was lit — which is occlusion, which is anchored to
the world and holds still while the camera does not. Hence `density` 6 (it is multiplied by
the sky's weight, which lives around 0.1..0.5, so the panel number carries that) against
`maxDensity` 0.06.

**And `maxDensity` has to be read against 4.75.** The composite adds `keyColour ×
keyIntensity × maxDensity × ray`, and `SUN_INTENSITY` is 4.75, so 0.16 — the first number
tried after the composite went additive — is most of a unit of radiance added to a scene
whose lit surfaces sit around 1.5. That is a white veil. What sells a beam is its contrast
against the unlit air beside it, that contrast _is_ this number, and all of it is also being
added to everything the beams are not. Its slider stops at 0.5 rather than 1 for the same
reason: past ~0.2 every value is a white-out, and the useful band deserves the resolution
more than the reach does.

**It carries a structural latch.** Nothing about its cost is skippable from inside the
shader: the targets are allocated and both the march and the blur run from
`updateBefore`, outside it, so a uniform branch (the `afterimage` bargain) would save
nothing. Its gate — haze × key elevation — is a **slow** signal that crosses once and
stays across, with no camera term in it: a latch may only ever watch a signal like
that, since one that swings with the camera (heading, position) would recompile the
pipeline every time it crossed the threshold. `resolutionScale` (0.5) is the cost
lever; it is a shadow-atlas tap per step per pixel and the result is dithered and then
blurred, so it loses very little at half size.

**It is nevertheless OFF by default, which `fogScatter` — same latch, same bargain — is
not.** The difference is not cost, because the latch already makes that zero in clear air.
It is that the composite ADDS the key light's own radiance to every pixel with lit air in
front of it, which is most of the frame, so the whole image brightens and desaturates the
moment the sky asks for shafts. A latched effect that costs nothing until it fires is still
a look the first time it fires, and this one changes every existing scene. Same call `ao`
makes, for the same reason.

## LUTs (`luts.svelte.ts`)

- Three formats, three loaders, one code path: `.cube`/`.3dl`/`.png` (the PNGs are
  horizontal 1024×32 strips). All return `{ texture3D }` with the edge length in
  `image.width`.
- Catalogue indices are stored in effect state — **append, never reorder**.
- `NeutralLUT.png` is an exact identity: enabling it must be indistinguishable from
  disabling the effect. If it isn't, the bug is a colour-space or double-tone-map error
  in the pipeline, not the grade.
- Attribution lives in each file's header (RocketStock `.CUBE` grades,
  FreePresets.com `.3dl`) — leave them intact.

## `ao` — the one effect that is not a look

`effects/ao.ts` wraps three's `GTAONode`. It is here because **nothing else in the
engine occludes the ambient term**: `Sky.svelte` bakes the dome into
`scene.environment` and `SkyLight.svelte` mounts a hemisphere fill, and neither knows
geometry is in the way — so a closed model is lit from all directions by the full sky
and the sun appears to shine through its walls. Shadow maps do not help; they attenuate
the single key light, and `DAY_AMBIENT` is 0 exactly because the env map carries
daylight (`core/skybox/model/CLAUDE.md`).

- **Off by default.** It is a real per-frame cost on a frame that may already render the
  scene five times, and it changes every existing scene's look.
- **It multiplies the composite, not the indirect term** — separating that would need a
  `diffuse` MRT attachment, which nothing currently requests. Directly-lit surfaces
  darken slightly; that is the known error of every screen-space AO, not a bug.
- **Its params live on the node, not in a factory call** (`ao()` takes only depth,
  normal, camera). The bag's `uniform()`s are **assigned onto the node before setup** —
  `setup()` is lazy and reads `this.radius` & co. then, so assignment after a build
  silently does nothing. Same rule as "never pass a raw number to a node factory", for a
  node with nowhere to pass them.
- `aoBufferScale` is a plain property on the node, not a uniform → the one `structural`
  param. Named that way rather than three's `resolutionScale` because it **multiplies on
  top of** `settingsState.graphics.renderScale`: GTAONode sizes itself from
  `renderer.getDrawingBufferSize()`, which is already `devicePixelRatio × renderScale`
  (App.svelte's `dpr`). Three scales in this app are one word apart — the third is
  DemoScene's reflector.
- **The precipitation fields still perturb it**, via the no-blending rule below: they
  are thousands of small transparent quads in the scene pass, each punching its own
  normal through. The prePass question under "Not built" is the real fix.

## Not built: pixelation, ssgi, ssr, traa (ao is the one revived so far)

A scope decision, not a technical block — the shader-cache trap that would have hit
all of them is already fixed. What reviving one of these needs:

- MRT rows (`normal` is now live — `ao` re-added it): `traa` (depth, velocity), `ssgi` (depth,
  normal, velocity, diffuse), `ssr` (depth, normal, metalrough), `denoise` (depth,
  normal). The union algorithm is untouched and still general — one row in `build.ts`'s
  `MRT_ATTACHMENTS` (the record key IS the texture name, and `finalize` carries any
  per-attachment format/blend fixup), one `Requirement` member, and the field on
  `BuildContext` the builder fills by name.
- `pixelationPass` provisions its own `mrt({ output, normal })` internally despite
  requiring nothing — that is why it hit the cache trap.
- `minQuality` survives on `EffectDef` with no consumer (`ssr`/`ssgi` were the only ones).
- Open cost question that returns with AO/SSR: MRT on the main pass vs a dedicated
  `prePass` with `transparent = false` (transparent geometry writes garbage normals
  and velocity). Still unanswered; it is the pipeline's biggest cost decision.
- `ssr` takes the RAW base-pass beauty — `SSRNode` derives its camera from
  `colorNode.passNode`, which a computed chain node does not have.

Not built: `anamorphic` (no shipped node — the example composes a custom high-pass `Fn`,
bloom, tint, add; budget it as real work).

## Scene transitions — a real crossfade, via a frozen frame

`effects/sceneTransition.ts` + `transitionState.svelte.ts` + `TransitionDriver.svelte`.
`TransitionNode`-style crossfading needs both scenes rendering at once, which `{#if}`
routing can't do (the outgoing scene unmounts). The fix: side A is an `rtt()` of the
chain colour captured on the outgoing scene's last frame, side B is the live scene, and
the mix is a real crossfade between them. Nothing renders twice.

- **Captured and mixed IN THE CHAIN** (order 60, last, pre-tonemap) so both sides are
  linear working colour and the frozen frame goes through the same grade, AA and output
  transform as the live one, every frame. At mix 1 the screen therefore _is_ the frame
  that was captured. A canvas grab (`copyFramebufferToTexture`) would be display-referred
  and could not be mixed at this point without tone-mapping it twice.
- **Three phases, and the middle one is a loading screen: dip → hold → reveal.** A heavy
  scene's entry is mostly main-thread stalls (GLB parse, texture decode, three's
  synchronous pipeline creation) during which nothing renders at all, so any motion
  riding the frozen frame itself (a push-in, a blur) would freeze right when the player
  needs proof the app is alive. Instead the plate dissolves to flat black in
  `veilSeconds` _before_ the swap, the load and the warm happen under that flat cover
  with `Loader.svelte`'s veil as the whole picture, and the veil dissolves into the live
  scene at the end.
- **The degradation rides `uTransitionVeil` (dip progress), never a clock.** Push-in,
  mip blur and desaturation all reach full value exactly as the plate goes flat, so a
  ten-second load and a one-second load leave it in the same state and the reveal always
  starts from the same place. `uvNode` and `levelNode` are configured IN PLACE on the RTT
  node — `.sample()`/`.level()` return plain TextureNode clones and only the node itself
  carries the `updateBefore` that fills the target (fogScatter's header has the long
  version).
- **The veil colour is black because black needs no synchronising.** It is 0 in linear
  working colour and 0 after any output transform, so the chain's flat plate matches
  `Loader.svelte`'s `#000` exactly. A game restyling its veil fades its own background in
  over the dip rather than expecting the plate to match it. Holding at `uTransitionVeil`
  1 also makes a mid-transition pipeline rebuild invisible: the rebuilt effect registers
  a fresh never-captured snapshot, and a snapshot multiplied by zero is black either way.
- **The motion during the hold is CSS, on the compositor** (`Loader.svelte`'s `sweep`
  keyframes) — the one deliberate exception to the no-CSS-animation rule in
  `src/CLAUDE.md`, and the only kind of animation that survives a blocked main thread.
  Nothing driven by a frame task can do that job.
- **The driver stops its task through the hold.** Nothing is moving under a flat cover,
  so forcing full-rate frames of a half-mounted scene through the whole download was
  waste; the warm gate starts its own forced-frame loop when that phase's turn comes.
  The minimum-cover floor is therefore wall-clock (`minCoverSeconds`), on the asset
  gate's rationale — it exists so a cached re-entry does not strobe the loading UI, which
  is a fact about the player's eyes, not about scene time. The dissolves stay on the
  task's delta like everything else.
- **A true two-live-scene crossfade is still not on the table**, and the reason is no
  longer the node: it is one scene graph, one borrowed camera and one Rapier world. Both
  scenes mounted at once means both trees in the same graph overlapping in world space
  and both sets of bodies in the same world colliding. It would need per-scene camera
  layers, a second camera and dormancy rules for the outgoing scene's physics, audio and
  input.
- **The capture is manual**: `rtt(ctx.color, null, null, { autoUpdate: false })` renders
  only on frames where the driver sets `textureNeedsUpdate`, and holds that image until
  the next capture. It also means the target stays 1×1 until the first real transition —
  a session that never switches scenes never allocates a full-screen buffer for this.
- **Default ON at mix 0**, the afterimage's bargain rather than the lenses' latch: a
  structural rebuild at the moment a transition starts is the hitch the cover exists to
  hide. At rest it is one texture fetch and one `mix`.
- **Patterns are procedural TSL and the choice is structural** — fade, wipe (angle),
  radial (aspect-corrected), dissolve (MaterialX fractal noise). Each is a different mask
  expression, not a runtime branch, so the shader carries only the one in use. The mask
  ranks pixels (low reveals first) and `softness` is the width of the front. **One mask,
  two fronts:** the dip and the reveal run the same threshold over it, so a wipe sweeps
  once each way and a dissolve's blobs return in the order they left.
- **The sequence lives in `sceneActions.transitionTo`**: capture → dip → swap → assets →
  warm → reveal. **The dip happens BEFORE the swap**: the swap and the mount behind it are
  the biggest main-thread stall in the sequence, and a live dissolve over them is exactly
  what judders. The one dissolve the player watches runs while the outgoing scene is still
  mounted and nothing is blocking.
- **`Loader.svelte`'s black veil is still the fallback** and still load-bearing: quality
  `low` bypasses post-processing entirely, the effect can be switched off, and a build
  can fail. `coverWithSnapshot()` returns false in all three and the veil covers instead,
  opaque and without the fades. While the composite IS covering, the same veil is the
  transparent status readout on top of it — **unconditionally, for the whole
  transition**. Gating it on `$active` would make it vanish the moment the downloads
  finish, which is the start of the warm gate: the longest phase of a heavy scene's first
  entry, and the one that most needs a label on it.
