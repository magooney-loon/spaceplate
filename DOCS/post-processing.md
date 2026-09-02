# Post-Processing — Rebuild Plan

Plan for rebuilding post-processing from scratch on `THREE.RenderPipeline` + TSL,
after the previous 25-effect pipeline was removed wholesale.

**Status:** core architecture implemented and the effect list deliberately cut back.
`src/core/postprocessing/` holds the registry/builder/uniform bag + **10** effect defs;
`src/core/utils/Renderer.svelte` owns the `RenderPipeline` (structural rebuild + hot
uniform effects); the extension is state + a registry-driven Studio panel.

**The shipped set is: ssaa, retro (base) · dof, motion blur, bloom (+ lensflare
sub-toggle), afterimage, vignette (chain) · 3dlut (grade) · smaa, fxaa (AA).**

### Removed: pixelation, ao, ssgi, ssr, traa

Cut wholesale, files deleted. They were built, hit bugs, and were judged not worth the
carrying cost against what they add to this boilerplate. This is a **scope decision,
not a defeat** — §8.7 identified and fixed the shared root cause, so they could have
been finished; they were dropped because nobody wanted them enough.

Consequences worth knowing before reviving any of them:

- `velocity` is now the **only** MRT attachment, for motion blur. The union algorithm
  in `build.ts` is untouched and still general, but `MRT_LAYOUT` lists one row — see
  §2.2 for the full attachment table a revival would restore.
- `Requirement` shrank to `depth | viewZ | velocity`, and `BuildContext` lost
  `normal`/`metalrough`/`diffuse`.
- `minQuality` survives on `EffectDef` with no effect using it. `ssr`/`ssgi` were its
  only consumers; the `quality === 'low'` blanket drop still works.
- **§8.7 still matters.** Motion blur is an MRT effect, so the shader-cache isolation
  is still load-bearing. Do not read the smaller effect list as making it removable.

First browser pass found three bugs, all written up below because none was predictable
from the plan. Confirmed working: bloom, vignette, afterimage, dof, smaa, fxaa.

- **§8.7, the MRT shader-cache trap.** Every MRT-dependent effect failed with a WebGPU
  attachment-state validation error. Cause was three's node-builder cache, not our
  graph. This is the one to read before touching the builder.
- **§5.2, retro vs. a cube environment.** `RetroPassNode` assumes `scene.environment`
  is a 2D map; ours is a raw `CubeTexture`. Fixed in `patches/three.patch`.
- **§5.3, a TSL vector-promotion trap.** Found in SSGI, but it is a general TSL hazard
  and the write-up outlived the effect.

Still open (see §10): `anamorphic` (composed by hand from bloom, no shipped node) and
scene transitions (§6). `denoise` went with the SSR removal.

Companions: `weather-system.md` (sky/weather), `scene-environment.md` (how a scene
overrides this config), `webgpu-notes.md` (WebGPU + Studio gotchas that this pipeline
must obey).

---

## 1. Why start over

The previous pipeline was a flat list of 25 effects folded into one hand-built node
graph inside a single `$effect`. It failed for two reasons, and both are design
faults rather than bugs to patch:

1. **It rebuilt continuously.** The effect read a `$state` object graph and
   dereferenced ~25 effect objects off it, so every parameter read became a
   dependency. Dragging a bloom slider disposed and rebuilt all 25 effects. See
   `webgpu-notes.md` §3.
2. **The effect list was wrong.** It was a port of pmndrs' catalogue — a flat set of
   independent screen-space filters. The effects actually wanted here are *not*
   independent: half of them need geometry data (depth, normals, velocity) that must
   be produced by the scene pass, and three of them **replace** the scene pass
   outright.

The list this document was written against was deliberately shorter and
modern-renderer shaped:

> 3dlut, afterimage, anamorphic, ao, bloom/emissive, dof, fxaa, motion blur, pixel,
> retro, smaa, ssaa, ssgi, ssr/denoise, traa, vignette
> (+ transition for scene changes)

It then got shorter again — see the removal note at the top. The analysis below is kept
**as written against the full list**, because it is the reasoning that produced the
architecture (§2's "effects are not peers" argument only makes sense with the geometry
consumers in view) and because it is what a revival would need. Where a section
discusses a removed effect, treat it as design history rather than a description of the
current code; §5's inventory table marks which rows are live.

Everything below is derived from reading `DOCS/three.js-dev/examples/jsm/tsl/display/*`
and the matching `webgpu_postprocessing_*.html` examples directly. Signatures are
quoted from source, not remembered.

---

## 2. The central problem: effects are not peers

Three distinct kinds of thing are on that list, and conflating them is what makes a
naive toggle grid impossible.

### 2.1 Base passes — mutually exclusive

`pixelationPass`, `retroPass` and `ssaaPass` all `extend PassNode` and take
`(scene, camera)`. Each **is** the scene pass. You can have exactly one:

```js
pixelationPass( scene, camera, pixelSize, normalEdgeStrength, depthEdgeStrength )  // removed
retroPass( scene, camera, options )
ssaaPass( scene, camera )
pass( scene, camera )   // the default when none of the above is enabled
```

Because all three extend `PassNode`, they inherit `setMRT()`, `getTextureNode(name)`,
`getViewZNode()` and `getLinearDepthNode()` — so in principle they *can* feed the
geometry-dependent effects. Whether they do so usefully is unverified (see §8).

The mutual-exclusion rule stays even with only two base passes left, and the builder
keeps asking `basePass.getMRT()` rather than assuming the default `pass()` — a base
pass may provision attachments the registry never asked for, which is exactly what
`pixelationPass` did.

### 2.2 Geometry consumers — need MRT attachments

These read buffers the scene pass has to be told to produce. **Only the two ✅ rows are
live** — the rest is the table a revival restores, and the reason `MRT_LAYOUT` in
`build.ts` is a lookup rather than a hard-coded attachment set:

| | Effect | Needs |
|---|---|---|
| ❌ | `ao` / `ssao` | depth, normal |
| ✅ | `dof` | viewZ (`pass.getViewZNode()` — derived from depth, no MRT needed) |
| ✅ | `motionBlur` | velocity |
| ❌ | `traa` | depth, velocity |
| ❌ | `ssgi` | depth, normal, velocity (temporal), diffuseColor |
| ❌ | `ssr` | depth, normal, metalrough |
| ❌ | `denoise` | depth, normal |
| ⬜ | bloom (emissive) | emissive |
| ⬜ | bloom (selective) | bloomIntensity |

The MRT set is therefore a **function of which effects are enabled**, not a fixed
choice. From the examples:

```js
scenePass.setMRT( mrt( {
    output,
    normal: packNormalToRGB( normalView ),
    velocity,
    metalrough: vec2( metalness, roughness ),
    diffuseColor
} ) );
```

### 2.3 Chain effects — plain colour-in/colour-out

`bloom`, `afterImage`, `lut3D`, `motionBlur`, `anamorphic`, `vignette` fold into the
colour chain in order and need nothing special.

Note that not all of these are node *classes*. `motionBlur` (three's) and `vignette`
(ours, §5.1) are plain TSL `Fn`s — called, not constructed, with no instance to hold
uniforms on. The registry treats them identically (an `EffectDef` whose `build`
returns a node either way), but there is no `.strength`-style handle to reach for
afterwards, so the uniform bag is the *only* way to animate them. See §4.

### 2.4 Resolve effects — must run last, and fight each other

`traa` (temporal), `smaa` and `fxaa` are all anti-aliasing. Running two is wasteful
and usually worse-looking than running one. `fxaa` additionally needs **sRGB /
post-tonemap input**, which forces `renderPipeline.outputColorTransform = false` and a
manual `renderOutput()` — the same is true of `lut3D` per its example. So the resolve
stage owns the output-colour-transform decision for the whole pipeline.

> **Superseded on both counts.** TRAA is gone, so the AA set is `smaa` and `fxaa`; the
> role rule is unchanged and still picks one. And the colour transform moved off the
> resolve stage entirely once `lut3D` arrived — see §3.1 on `grade` and `displayColor`.
> The paragraph stays because "resolve effects fight each other" is still the reason
> the role exists.

**This is the whole design problem.** A flat `enabled` grid cannot express "pick one
base pass", "provision an MRT set derived from the enabled effects", or "these three
are alternatives". The architecture below makes those relationships data.

---

## 3. Architecture: an effect registry

One module declares what every effect *is*. A builder reads the registry plus the
enabled set and produces the node graph. Nothing hand-wires a graph.

### 3.1 The declaration

```ts
type PassRole = 'base' | 'chain' | 'grade' | 'resolve';

type Requirement =
    | 'depth' | 'viewZ' | 'normal' | 'velocity'
    | 'metalrough' | 'diffuse' | 'emissive' | 'bloomIntensity';

interface EffectDef<S> {
    id: string;
    role: PassRole;
    order: number;              // sort key within the role
    requires: Requirement[];    // drives MRT provisioning
    conflicts?: string[];       // ids that cannot be co-enabled
    /** Consumes display-referred colour — the builder folds in one renderOutput(). */
    displayColor?: boolean;
    /** Non-hot params: changing these forces a graph rebuild (see §4). */
    structural?: (keyof S)[];
    /** Runtime rebuild key material the param values cannot carry (see §4). */
    structuralTag?: () => string | number;
    build(ctx: BuildContext, u: UniformBag<S>): Node;
}
```

`grade` was added when the LUT landed. §2.4 assumed the resolve stage could own the
output-colour-transform decision because only FXAA wanted it — but `lut3D` wants the
same display-referred input, and grading is orthogonal to anti-aliasing, so forcing
them into one mutually exclusive role would have meant choosing between a LUT and AA.
So: `grade` runs after the chain and before resolve, is **not** mutually exclusive, and
the transform decision moved out of the effects entirely. Any effect sets
`displayColor`, and the builder disables `pipeline.outputColorTransform` and folds in
**exactly one** `renderOutput()` before the first stage that wants it. Two effects each
calling `renderOutput()` themselves would tone-map the frame twice.

### 3.2 The build context

The builder resolves every requirement once and hands the results to each effect, so
no effect ever reaches for the scene pass itself:

```ts
interface BuildContext {
    scene: Scene;
    camera: Camera;
    renderer: WebGPURenderer;
    basePass: PassNode;
    color: Node;        // the running chain value — reassigned as effects fold in
    depth: Node;
    viewZ: Node;
    normal: Node;
    velocity: Node;
    metalrough: Node;
}
```

### 3.3 The build algorithm

1. **Resolve the base pass.** At most one `role: 'base'` may be enabled; if more are,
   the highest-priority wins and the rest are reported as conflicts. Otherwise
   `pass(scene, camera)`.
2. **Union the requirements** of every enabled effect → the MRT attachment set.
   Provision only what is asked for. `viewZ` and `depth` come free from `PassNode`
   and never add an attachment.
   Then, if the pass ended up with any attachments, give it a private
   `contextNode` — **this is not optional, see §8.7.**
3. **Fold chain effects** in `order`, threading `ctx.color`.
4. **Settle the output colour transform**: if any active effect declares
   `displayColor`, turn `pipeline.outputColorTransform` off and fold in one
   `renderOutput()`.
5. **Fold grade effects** in `order` (not exclusive), then **apply the resolve
   effect** last, at most one AA.
6. Assign `pipeline.outputNode`, set `pipeline.needsUpdate = true`.
7. Wrap the whole build in try/catch and fall back to a bare `pass(scene, camera)` on
   any throw. This was worth keeping from the old implementation — a broken graph must
   not take the render loop down with it.

### 3.4 What the UI gets for free

Because conflicts and roles are data, the Studio panel can grey out `retro` while
`ssaa` is on, show *why*, and display the live MRT set and its cost. That is not
polish — an effect grid where illegal combinations are merely broken is the thing that
made the old panel untrustworthy.

---

## 4. Rebuild discipline

This is the part the old pipeline got wrong, so it is a rule, not a preference.

**Never pass a raw number to a node factory. Always pass a `uniform()` the pipeline
owns.**

Verified from source, this works nearly everywhere:

- `BloomNode` — `this.strength = strength.isNode ? strength : uniform( strength )`.
  It wraps raw numbers itself, but passing our own `uniform()` means we keep the
  handle and can mutate `.value`.
- `GTAONode` — `radius`, `thickness`, `distanceExponent`, `distanceFallOff`, `scale`,
  `samples` are already `uniform()` instances on the node; write `.value` directly.
- `dof`, `afterImage`, `lut3D`, `transition` — all take `nodeObject(...)` params, so a
  `uniform()` passes straight through.
- `motionBlur`, our `vignette` (§5.1) — TSL `Fn`s whose params default to `float(...)`
  / `int(...)` nodes. They accept a `uniform()` in the same position. With no node
  instance to hold a handle on, the uniform bag is the *only* way to animate them.

It also sidesteps a typing trap. The addon `.d.ts` files are **inconsistently typed
against their own JS default-parameter behaviour** — some exports demand values
wrapped in `float()`, others reject the wrapper and want a raw `number`. A `uniform()`
is accepted by both, so the rule removes the inconsistency rather than making you
remember which side each effect falls on.

The consequence is that the **structural key collapses to the enabled set**:

```ts
const structuralKey = $derived(
    [basePassId, ...enabledIds.toSorted(), mrtKey, qualityTier].join('|')
);
```

Two effects, cleanly separated:

- **Structural effect** — depends on `structuralKey`, a *string*. Rebuilds the graph.
  Fires on toggle, never on drag.
- **Uniform effect** — walks the parameter values and writes `uniform.value` in place.
  No disposal, no rebuild.

`structural` on the effect definition lists the exceptions — params that feed loop
counts or texture dimensions rather than shader values, and so genuinely need a
rebuild. Live ones: `motionBlur` `numSamples` (an `int()` bounding a `Loop`) and the
LUT choice (a different texture, hence a different graph).

`structuralTag` is the runtime companion: key material an effect can only know when it
runs, appended to `structuralKeyOf`. The LUT returns its loaded-texture version so an
async load landing triggers exactly one rebuild. Reach for it when the graph is built
*around* a resource rather than merely reading a value.

---

## 5. Effect inventory

Signatures quoted from `DOCS/three.js-dev/examples/jsm/tsl/display/`. Role and
requirements as per §2.

**✅ = shipped · ❌ = removed** (see the note at the top) **· ⬜ = never built.**
Removed rows are kept with their signatures and gotchas intact: they are what a revival
starts from, and they cost nothing to keep here.

| | Effect | Factory | Role | Requires | Notes |
|---|---|---|---|---|---|
| ✅ | **ssaa** | `ssaaPass(scene, camera)` | base | — | `extends PassNode` |
| ❌ | **pixel** | `pixelationPass(scene, camera, pixelSize, normalEdgeStrength, depthEdgeStrength)` | base | — | `extends PassNode`; provisions its own `mrt({ output, normal })` internally, which is why it failed with the §8.7 group despite requiring nothing |
| ✅ | **retro** | `retroPass(scene, camera, options)` | base | — | `extends PassNode`; needs `patches/three.patch` (§5.2). Does not bundle a vignette, so no conflict with ours |
| ❌ | **ao** | `ao(depthNode, normalNode, camera)` | chain | depth, normal | GTAO. `ssao(...)` is the alternative with the same signature |
| ❌ | **ssgi** | `ssgi(beauty, depth, normal, camera)` | chain | depth, normal, diffuse, velocity | Composite is `color.rgb * AO + diffuse.rgb * GI`, and the AO term is a float in a vec4 — §5.3 |
| ❌ | **ssr** | `ssr(colorNode, depthNode, normalNode, options)` | chain | depth, normal, metalrough | Takes the RAW base-pass beauty: `SSRNode` derives its camera from `colorNode.passNode`, which a computed chain node does not have |
| ❌ | **denoise** | `denoise(node, depth, normal, camera)` | chain | depth, normal | Never built; went with SSR |
| ✅ | **dof** | `dof(node, viewZNode, focusDistance, focalLength, bokehScale)` | chain | viewZ | viewZ from `basePass.getViewZNode()` — no MRT attachment |
| ✅ | **motion blur** | `motionBlur(inputNode, velocity, numSamples)` | chain | velocity | A TSL `Fn`, not a node class. **The only remaining MRT consumer** |
| ✅ | **bloom** | `bloom(node, strength, radius, threshold)` | chain | — | Additive |
| ✅ | **lensflare** | `lensflare(bloomNode, params)` — sub-toggle inside `bloom` | chain | — | Ghosts are sampled FROM the bloom buffer, hence nested in bloom (no bloom, no flare). `gaussianBlur(flare, 8)` smooths the ¼-res ghosts. `lensflare` + `ghostSamples` are structural |
| ⬜ | **bloom (emissive)** | same, fed an `emissive` MRT texture | chain | emissive | Not wired. Example sets `emissiveTexture.type = UnsignedByteType` to save bandwidth |
| ⬜ | **anamorphic** | *composed* | chain | — | **No shipped node.** The example builds a custom high-pass `Fn`, runs `bloom()` on it, tints, and adds. Budget it as real work |
| ✅ | **afterimage** | `afterImage(node, damp)` | chain | — | Feedback buffer. The "interacts badly with temporal AA" caveat is moot now that TRAA is gone |
| ✅ | **vignette** | *ours* — hand-written `Fn` (§5.1) | chain | — | Applied late, after grading, before AA |
| ✅ | **3dlut** | `lut3D(node, texture3D, size, intensity)` | grade | — | `displayColor`. three's nine example LUTs in `public/luts/` (§7); catalogue + async load in `luts.svelte.ts` |
| ❌ | **traa** | `traa(beauty, depth, velocity, camera)` | resolve | depth, velocity | Temporal AA |
| ✅ | **smaa** | `smaa(node)` | resolve | — | Conflicts with fxaa (one AA max) |
| ✅ | **fxaa** | `fxaa(node)` | resolve | — | `displayColor` — the builder supplies the sRGB input, not the effect |
| ⬜ | **transition** | `transition(a, b, mixTexture, mixRatio, threshold, useTexture)` | resolve | — | Not built; §6 |

### 5.1 Vignette — written, not imported

Vignette is the one effect we implement ourselves. three's version
(`vignette` in `CRT.js`, which calls `circle` from `Shape.js`) is about ten lines
total:

```js
// CRT.js
const mask = circle( float( 1.42 ), smoothness, coord );
const vignetteAmount = mix( float( 1.0 ).sub( intensity ), float( 1.0 ), mask );
return color.mul( vignetteAmount );

// Shape.js — circle()
const dist = length( coord.sub( 0.5 ) ).mul( 2.0 );
return smoothstep( scale, scale.sub( softness.mul( scale ) ), dist );
```

Importing two addon modules to get that is not a good trade. Writing it ourselves
gives three concrete wins:

- **Aspect control.** The addon version measures distance in raw `uv` space, so the
  vignette is always an ellipse stretched to the viewport. That is often what you
  want, but there is no way to ask for a true circle. A `roundness` parameter
  interpolating between the two is one `mix`.
- **No typing trap.** `CRT.js`'s exports demand `float()`-wrapped arguments while
  `bloom` rejects them (§4). Our own `Fn` takes exactly the uniforms we hand it.
- **It is the template.** Any future hand-written effect follows this shape, so
  having one worked example in the repo is worth more than the ten lines it costs.

```ts
// src/core/postprocessing/effects/vignette.ts
import { Fn, uv, vec2, float, length, smoothstep, mix } from 'three/tsl';

/** intensity 0..1 edge darkening · smoothness falloff width · roundness 0 = frame-shaped, 1 = circular */
export const vignetteFn = Fn(([color, intensity, smoothness, roundness, aspect]) => {
    // roundness 0 keeps uv space (ellipse follows the viewport); 1 corrects x by
    // aspect so the falloff is a true circle.
    const scaleX = mix(float(1), aspect, roundness);
    const dist = length(uv().sub(0.5).mul(vec2(scaleX, 1))).mul(2);

    const mask = smoothstep(float(1.42), float(1.42).sub(smoothness), dist);
    return color.mul(mix(float(1).sub(intensity), float(1), mask));
});
```

`1.42 ≈ √2` so the falloff reaches the frame corners. `aspect` is a `uniform()`
written from the renderer's resize handler, not read per-frame.

Two placement notes:

- It multiplies **rgb**. If the chain value is vec4 at that point, reattach alpha.
- It belongs **pre-tonemap**, where the pipeline already runs. Multiplying before
  tone mapping behaves like real lens falloff; doing it after crushes the shadows
  instead of dimming the image.

### 5.2 Retro needs a 2D environment map — patched

`retroPass` failed with:

```
Dimension (TextureViewDimension::Cube) of [TextureView of Texture (96x96, 6 layer,
RGBA16Float)] doesn't match the expected dimension (TextureViewDimension::e2D).
```

`RetroPassNode` substitutes its own material for every material in the scene, and for
standard materials it rebuilds the reflection term as `new CubeMapNode( texture( envMap ) )`
where `envMap = material.envMap || scene.environment`. `texture()` builds a **2D**
`TextureNode`. That is fine in three's own examples because `scene.environment` there is
a PMREM'd 2D map — but `CubeMapNode` only converts *equirectangular* sources, and when
handed something already cubic it takes this branch:

```js
} else {
    // envNode already refers to a cube map
    this._cubeTextureNode = this.envNode;   // ← hands the 2D node straight back
}
```

So the shader declares a `texture_2d` binding while the bind group supplies a cube view.
Our `scene.environment` is a raw `CubeTexture` because `Sky.svelte` bakes the procedural
dome into a `CubeRenderTarget` — a perfectly normal thing to do, and the reason this only
bites here.

Fixed in `patches/three.patch`: use `cubeTexture( envMap )` when `envMap.isCubeTexture`.
Every other `CubeMapNode` caller in three already passes a correctly typed node; this is
the only one that hard-codes `texture()`.

### 5.3 TSL silently widens, and a failed build renders as a blank material

Found in SSGI. The effect is gone; **the trap is not**, and it will catch the next
composition that mixes vector widths — which is every one of them.

three's own `webgpu_postprocessing_ssgi` example composites with:

```js
vec4( add( scenePassColor.rgb.mul( ao ), scenePassDiffuse.rgb.mul( gi.rgb ) ), scenePassColor.a )
```

`getAONode()` returns a `passTexture`, i.e. **vec4**. Under TSL's promotion rule
(`OperatorNode.getNodeType`: "anytype x anytype: use the greater length vector")
`color.rgb.mul(ao)` is therefore vec4, and the outer `vec4( …, a )` receives five
components:

```
THREE.TSL: Length of parameters exceeds maximum length of function 'vec4()'
```

The material's build then throws, and three quietly swaps in a blank `NodeMaterial`
(`NodeManager.getForRender`'s catch) — which is why the symptom is a *wrongly rendered*
object rather than a hard failure. AO was written as a `property('float')` into
`textures[0]`, so the fix was the red channel: `ctx.color.rgb.mul(aoOut.r)`.

Two things to carry forward:

- **A `passTexture` is vec4 regardless of what was written into it.** A single-channel
  output looks scalar in the node that produced it and arrives as a vec4 at the node
  that consumes it. Take the channel explicitly.
- **A TSL build failure is not a crash.** It logs `THREE.TSL: …` once and substitutes a
  blank material, so it reads as a shading bug. Grep the console for `THREE.TSL:`
  before debugging geometry — same lesson as `webgpu-notes.md` §1.3.

---

## 6. Scene transitions

**Decision: single-scene fade, not a true two-scene crossfade.**

`TransitionNode` takes two beauty textures and mixes them by `mixRatio`, optionally
masked by a texture so you get wipes and dissolves rather than a flat fade. The
three.js example feeds it two live `pass()` nodes — which means **both scenes render
every frame during the transition**, and `Scene.svelte` would have to mount both at
once instead of its current `{#if}` swap.

That cost is not worth it here. Instead: pass A is the live scene pass, pass B is a
cheap constant node (solid colour, or a frozen frame). All the mask-texture machinery
still works, so fade-to-black, wipes and dissolves are all available; only a genuine
A→B crossfade is not.

This replaces the current `setTimeout`-based transition in
`extensions/scene/scene.svelte.ts:116` (`transitionTo`), which just sleeps for half the
duration, swaps the scene, and sleeps again — nothing visual happens at all today.

The driving value is one `uniform()` — `mixRatio` — eased by a task. The scene swap
happens at `mixRatio === 1`. Two-scene crossfade stays possible later without
redesign: it is the same node with a real pass in slot B.

---

## 7. Assets and new dependencies

- **3D LUTs.** Done. `public/luts/` holds **three.js's own nine**, copied verbatim from
  `DOCS/three.js-dev/examples/luts/` (the set behind `webgpu_postprocessing_3dlut`).
  Filenames are kept exactly as three ships them — spaces and the ampersand included —
  so the folder stays diffable against upstream. ~4.7 MB, but static and fetched one at
  a time, so it costs page weight only for the LUT actually chosen.

  Attribution, per the example page: the `.CUBE` grades are RocketStock, and
  `Presetpro-Cinematic.3dl` is FreePresets.com / Tim Martin. Each file carries its own
  copyright header — leave those headers intact.

  Three file formats, three loaders, one code path: `.cube` → `LUTCubeLoader`,
  `.3dl` → `LUT3dlLoader`, `.png` → `LUTImageLoader` (these are horizontal 1024×32
  strips, not sampleable images). All three return `{ texture3D }` with the cube edge
  length in `image.width`, which is the `size` argument `lut3D` wants.
  `src/core/postprocessing/luts.svelte.ts` is the catalogue plus the async load cache.

  The load is async while `EffectDef.build()` is synchronous, which is what
  `structuralTag` exists for: the effect folds to a **no-op pass-through** until its
  texture lands, then the `$state` version counter changes the structural key and the
  graph rebuilds once, properly. Do not be tempted to await in the builder.

  `NeutralLUT.png` is an exact identity and earns its place as a test: enabling it must
  be indistinguishable from disabling the effect. If it is not, the bug is a
  colour-space or double-tone-map error in the pipeline, not in the grade.

  Catalogue indices are stored in effect state, so **append rather than reorder**.
- **Transition masks.** Optional greyscale textures for wipe patterns; the example
  uses `textures/transition/transition{1..6}.png`. Ship two or three or start with
  `useTexture = 0` (plain fade).
- No new npm dependencies. Everything is `three/addons/tsl/display/*`, already present.

---

## 8. Risks and things to verify in a browser

§§8.7-8.9 are settled and are the most important entries here — read all three, they
share one error message and only the first is about caching. Items 1, 2, 4 and 5 were
**closed by the removal** rather than answered — they were all questions about
ao/ssgi/ssr/traa/pixelation. They are kept for a revival, struck where dead.

1. ~~**Do the base-pass effects support MRT usefully?**~~ Moot: the surviving base
   passes (`retro`, `ssaa`) have no geometry consumer left to feed except motion blur,
   and `resolveEnabledSet` drops geometry consumers under a non-default base pass
   anyway. Still open *if* pixelation or AO ever returns.
2. ~~**MRT on the main pass vs. a separate pre-pass.**~~ Never settled, because the
   effects that would have forced the decision are gone. Velocity for motion blur comes
   off the main pass and that is fine. **The question returns intact with AO or SSR**:
   the `ao` example runs a dedicated `prePass` with `transparent = false` because
   transparent geometry writes garbage normals and velocity. It is the pipeline's
   biggest cost decision and it is still unanswered.
3. **`outputColorTransform` ownership.** Still live, and now broader: `fxaa` and
   `lut3D` both want it off (the builder owns the call — §3.1), and Studio renders on
   top of our output. Whether disabling it breaks Studio's gizmo, PiP or selection
   outline is untested.
4. ~~**`afterImage` × temporal AA.**~~ Moot — TRAA is gone, so there is no history
   buffer to fight the feedback buffer.
5. ~~**Cost.**~~ The heavy trio is gone and nothing in the shipped set is expensive
   enough to need tiering. `minQuality` survives on `EffectDef` with no consumer; the
   `quality === 'low'` blanket drop is all the `settingsState.graphics` setting does
   here.
6. **Studio task ordering.** The new pipeline must re-apply the rules in
   `webgpu-notes.md` §2 — they were written for the deleted `EffectComposer` but the
   DAG constraints are unchanged.
7. **SETTLED — the MRT traps.** Read this before changing the builder. §8.7 is the
   shader-cache trap; §8.8 is the second, independent one that §8.7 does *not* cover and
   that produces the identical error message.

### 8.7 The MRT shader-cache trap

**Still load-bearing after the removal.** Motion blur is an MRT effect, so this applies
to the shipped pipeline — the shorter effect list does not make it removable.

Every MRT-dependent effect — `ao`, `motionBlur`, `traa`, `ssgi`, and `pixelation`
(which provisions its own `mrt({ output, normal })` internally) — died on:

```
Attachment state of [RenderPipeline "renderPipeline_NodeMaterial_22"] is not compatible
with [RenderPassEncoder]. Expects colorTargets [0={RGBA16Float}, 1={RGBA16Float}];
pipeline has [0={RGBA16Float}].
```

Read as "one material in the scene was drawn with a one-output shader inside a
two-attachment pass". The effects that worked — bloom, vignette, afterimage, dof, smaa,
fxaa — are exactly the ones needing no attachment. **The effects were never the
problem.**

`NodeMaterial.setup()` folds the MRT into a material's output by reading
`renderer.getMRT()` *at build time*, and the build is lazy — it happens on the first
draw, in whatever pass draws first. The compiled result is then cached in
`NodeManager.nodeBuilderCache` under `RenderObject.initialCacheKey`, and **that key
contains no MRT information and no render-target information**. Render objects are
keyed per render context, but the compiled shader they share is not.

So any other render of the same scene that runs without MRT compiles a one-output
shader under the key our MRT pass then looks up. In this app there are at least three
such renders: Studio's viewport, `Sky.svelte`'s per-frame `CubeCamera` environment
bake, and `HeightField`'s ortho pass. Which one wins is a race.

The fix is three's own mechanism, and it is one line in the builder:

```ts
if (basePass.getMRT() !== null) basePass.contextNode = context();
```

`RenderObject.getDynamicCacheKey()` hashes `renderer.contextNode.id`, and `PassNode`
swaps `renderer.contextNode` for its own for the duration of its render. An empty
`context()` merges to identical context *data* with a distinct node *identity* — same
generated code, private cache namespace. (PassNode already calls
`getFlowContextData()` on an empty `context()` every render, since that is what
`Renderer.contextNode` is initialised to, so this path is well travelled.)

Building a fresh context per rebuild also fixes the second-order case: changing the
attachment set — adding motion blur to AO, say — must not reuse shaders compiled for
the previous attachment count.

Two consequences worth remembering:

- **The symptom names the material, and that is the best clue available.** three labels
  pipelines `material.name || material.type` (`WebGPUPipelineUtils.js`), so
  `renderPipeline_NodeMaterial_22` means an *unnamed, plain* `NodeMaterial`. Naming
  custom materials makes the next one of these far easier to read. Note that the
  encoder aborts at the first bad pipeline, so the error names *a* culprit, not the
  only one.
- **Do not "fix" this by giving the sky its own dome, or by disabling the env bake.**
  That treats one racer rather than the race, and the next auxiliary pass reintroduces
  it.

**Necessary but not sufficient.** The `contextNode` line is doing its job and must stay —
verified in a browser: with motion blur on, every material in the pass recompiles under
the pass's private context and emits two outputs. But it is not the whole story. The
sentence "the effects were never the problem" above is true; "so it must be the shader
cache" is not. §8.8 is a second failure mode with the *same* error text that this fix
cannot reach, and it is the one that was actually still firing.

### 8.8 A material can bypass MRT entirely — `fragmentNode`

`NodeMaterial.setup()` folds the renderer's MRT into the fragment output on **one** of
its two branches:

```js
if ( this.fragmentNode === null ) {
    ...
    if ( renderTarget !== null ) {
        const mrt = renderer.getMRT();   // ← the fold lives here
        ...
    }
} else {
    // custom fragmentNode: setupOutput() only. MRT never enters.
    resultNode = this.setupOutput( builder, this.fragmentNode );
}
```

So a material with a custom `fragmentNode` emits a single `@location( 0 )` **no matter
what the pass is doing** (unless the node is already an `isOutputStructNode`). Note
`outputNode` is fine — it still folds; only `fragmentNode` bypasses.

Drawn inside a two-attachment pass that is fatal on Chromium/Dawn, and it is the *same*
message §8.7 produces, which is why this hid behind that diagnosis for so long:

```
Attachment state of [RenderPipeline "renderPipeline_NodeMaterial_22"] is not compatible
with [RenderPassEncoder]. Expects colorTargets [0, 1]; pipeline has [0].
```

**Why nothing upstream catches it.** The material's WGSL is byte-identical with and
without MRT, so it collapses onto one `ProgrammableStage` (`Pipelines.programs.fragment`
is a `Map` keyed on the shader *string*), and `WebGPUBackend.getRenderCacheKey()` records
`getCurrentColorFormat( renderContext )` — the format of attachment **0** — and never the
attachment *count*, even though `getCurrentColorFormats()` (plural) sits unused beside it
in `WebGPUUtils.js`. Identical stage ids plus an identical backend key means one GPU
pipeline shared across both contexts, so the pipeline built for the one-attachment pass
is handed to the two-attachment one. A wrong shader becomes a wrong *pipeline* instead of
a recompile. That is a genuine upstream three bug and is worth reporting; we have not
patched it.

**The culprit here was Threlte Studio's selection outline** (`RenderSelectedObjects`),
which set `outlineMaterial.fragmentNode` with a comment claiming it was needed so a flat
overlay would not pick up material lighting. It is not: the material already has
`lights = false`, and with no `lightsNode`, backdrop or emissive, `setupLighting()`
returns the unlit `diffuseColor.rgb` unchanged, while `setupOutput()` — and therefore fog
— runs on both branches. `patches/@threlte__studio@0.4.3.patch` switches it to
`colorNode`, which is visually identical and folds MRT correctly.

**This is dev-only.** Studio is dynamically imported behind `VITE_GAME_ENGINE=true`, so
production was never affected.

### 8.9 MRT attachments other than `output` do not blend

Fixing §8.8 traded the crash for a silent no-op, and the reason generalises to any future
MRT attachment. `MRTNode`'s constructor seeds blending for exactly one output:

```js
this.blendModes = { output: _materialBlending };
```

Every other attachment falls through `getBlendMode()` to `_noBlending`, and
`WebGPUPipelineUtils` then builds that colour target with `blend: undefined` — a straight
overwrite with alpha ignored. Blending is also per-*pass*, not per-material:
`WebGPUPipelineUtils` reads `renderObject.context.mrt`, so a material cannot opt out.
(`MRTNode.merge()` looks like it could override per material, but it assigns
`mrtTarget.blendings` while `getBlendMode()` reads `this.blendModes`, so merged modes are
dropped — another upstream typo.)

Consequence: **a full-screen quad inside the scene pass wipes every non-`output`
attachment**, however transparent it looks. Studio's selection outline is exactly that —
`depthTest = false`, `renderOrder = 9999` — so once §8.8 let it write velocity at all, it
stamped its own (zero, being camera-parented) velocity over the whole buffer and motion
blur became an identity transform. The patch skips it when the selection is empty, which
was upstream's own TODO; with something selected the overlay still flattens velocity.

The real cure — compositing Studio's overlays *after* post-processing rather than inside
the base pass — is unbuilt and is the open item here. The same trap waits for any
in-scene fullscreen overlay we add ourselves.

**Diagnosing any of §8.7-8.9:** `src/__debug/mrtProbe.ts` compares declared shader
outputs against context attachments per draw and names the offending material, its nodes
and its ancestry. It is what found §8.8 after static analysis had failed twice.

---

## 9. File plan

### Added

| Path | Purpose |
|---|---|
| `src/core/postprocessing/registry.ts` | Effect definitions (§3.1) — the single source of truth |
| `src/core/postprocessing/build.ts` | The builder (§3.3): base pass, MRT union, fold, resolve |
| `src/core/postprocessing/uniforms.ts` | The uniform bag — create, look up, write `.value` |
| `src/core/postprocessing/effects/*.ts` | One small module per effect, each exporting an `EffectDef`. Most wrap an addon node; `vignette.ts` is hand-written TSL (§5.1) and is the template for any future custom effect |
| `src/core/postprocessing/luts.svelte.ts` | LUT catalogue + async load cache across three loaders (§7). A `.svelte.ts` only because the version counter drives the structural rebuild |
| `public/luts/*` | three's nine example LUTs, copied verbatim (§7) |
| `patches/three.patch` | `RetroPassNode` cube-environment fix (§5.2) |

### Rewritten

| Path | Change |
|---|---|
| `src/core/utils/Renderer.svelte` | Stub → owns the `RenderPipeline`, the structural effect and the uniform effect (§4). Task ordering per `webgpu-notes.md` §2 |
| `src/extensions/postprocessing/types.ts` | Per-effect param sets for the new list; the pmndrs-era types (glitch, shockWave, ascii, tiltShift, scanline, sepia, dotScreen…) go |
| `src/extensions/postprocessing/postprocessing.svelte.ts` | State for the new effect set; preset/localStorage layer dropped |
| `src/extensions/postprocessing/PostProcessingExtension.svelte` | Rebuilt against the registry — roles, conflicts and the live MRT set are rendered *from* the registry, not hand-written |

### Deleted

| Path | Reason |
|---|---|
| `src/extensions/postprocessing/bundledPresets.ts` | Preset layer removed; contains only commented-out examples |
| `src/extensions/postprocessing/usePostProcessing.ts` | Zero consumers |
| `src/core/postprocessing/effects/{pixelation,ao,ssgi,ssr,traa}.ts` | Scope cut — see the removal note at the top |

### Changed

| Path | Change |
|---|---|
| `src/App.svelte` | `autoRender={false}` as a `<Canvas>` **option** once a pipeline exists — never toggled from an `$effect` (`webgpu-notes.md` §3). Re-register `PostProcessingExtension` |
| `src/extensions/scene/scene.svelte.ts` | `transitionTo` drives the transition uniform instead of `setTimeout`. Per-scene config overrides are `scene-environment.md`, not this doc |
| `src/extensions/scene/SceneExtension.svelte` | Drops its read of `postprocessingPresetsState` |

---

## 10. Phasing

Each phase leaves the app rendering.

1. **Skeleton.** `RenderPipeline` + `pass(scene, camera)` + `outputNode`, no effects.
   Re-establish `autoRender={false}` and the Studio task ordering. Prove Studio still
   works with a pipeline in the loop — this is the riskiest integration point and it
   is worth isolating before any effect exists.
2. **Registry + builder + two effects.** `bloom` (chain) and `smaa` (resolve). Enough
   to exercise roles, the structural/uniform split, and the fallback path with almost
   no surface area.
3. **Geometry pipeline.** MRT provisioning, then ~~`ao`~~ and `dof`. This is where
   decision §8.2 gets settled with real pixels.
4. **Temporal.** ~~`traa`~~ + velocity, then `motionBlur`. Both depend on the same
   attachment; do them together.
5. ~~**Heavy GI.** `ssgi`, `ssr`, `denoise`. Gated behind the `high` quality tier.~~
6. **Base-pass alternates.** ~~`pixel`,~~ `retro`, `ssaa` — plus the conflict UI, which
   only becomes meaningful once there is more than one base pass to conflict.
7. **Grade and extras.** `3dlut` (+ LUT loading), `anamorphic`, `afterimage`,
   `vignette`, `fxaa` as the low-end AA option.
8. **Transitions.** `TransitionNode` wired to `scene.transitionTo`.

Phases 1–7 are done except `anamorphic`; phase 5 was built and then removed wholesale;
phase 8 is untouched. Phase 3's MRT provisioning survived phase 5's removal because
motion blur still needs it.

Phases 1–2 are the ones that prove the architecture. If the structural/uniform split
does not hold there, stop and fix it before adding effects — that is exactly the
mistake the previous pipeline made.

The phasing held up, with one correction worth recording: it assumed effects could be
brought up one at a time and judged independently. §8.7 says otherwise — the whole
MRT-dependent *group* shares a single failure mode that no individual effect can be
debugged into. When several effects fail at once, look for what they have in common
before looking at any one of them.

---

## 11. Out of scope

- **Everything from the old pmndrs catalogue that is not in §5.** The effect list is
  the effect list; it is not a starting point to grow back toward 25.
  - **Outline stays gone specifically**: it conflicted with Studio's own selection
    outline, and Studio's is sufficient for editor use.
- **Tone mapping.** A renderer property owned by Threlte's `<Canvas>` `toneMapping`
  option. The pipeline must not write `renderer.toneMapping` — two owners for one
  property caused earlier bugs.
- The sky/weather system — `weather-system.md`.
- The Studio/WebGPU compat patches in `patches/`.
