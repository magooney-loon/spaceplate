# Post-Processing — Rebuild Plan

Plan for rebuilding post-processing from scratch on `THREE.RenderPipeline` + TSL,
after the previous 25-effect pipeline was removed wholesale.

**Status:** planned, nothing implemented. `src/core/Renderer.svelte` is a stub;
`src/extensions/postprocessing/` still holds the old state/types/Studio panel from the
pmndrs era and is the thing being replaced, not extended.

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

The new list is deliberately shorter and modern-renderer shaped:

> 3dlut, afterimage, anamorphic, ao, bloom/emissive, dof, fxaa, motion blur, pixel,
> retro, smaa, ssaa, ssgi, ssr/denoise, traa, vignette
> (+ transition for scene changes)

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
pixelationPass( scene, camera, pixelSize, normalEdgeStrength, depthEdgeStrength )
retroPass( scene, camera, options )
ssaaPass( scene, camera )
pass( scene, camera )   // the default when none of the above is enabled
```

Because all three extend `PassNode`, they inherit `setMRT()`, `getTextureNode(name)`,
`getViewZNode()` and `getLinearDepthNode()` — so in principle they *can* feed the
geometry-dependent effects. Whether they do so usefully is unverified (see §8).

### 2.2 Geometry consumers — need MRT attachments

These read buffers the scene pass has to be told to produce:

| Effect | Needs |
|---|---|
| `ao` / `ssao` | depth, normal |
| `dof` | viewZ (`pass.getViewZNode()` — derived from depth, no MRT needed) |
| `motionBlur` | velocity |
| `traa` | depth, velocity |
| `ssgi` | depth, normal, velocity (temporal), diffuseColor |
| `ssr` | depth, normal, metalrough |
| `denoise` | depth, normal |
| bloom (emissive) | emissive |
| bloom (selective) | bloomIntensity |

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

**This is the whole design problem.** A flat `enabled` grid cannot express "pick one
base pass", "provision an MRT set derived from the enabled effects", or "these three
are alternatives". The architecture below makes those relationships data.

---

## 3. Architecture: an effect registry

One module declares what every effect *is*. A builder reads the registry plus the
enabled set and produces the node graph. Nothing hand-wires a graph.

### 3.1 The declaration

```ts
type PassRole = 'base' | 'chain' | 'resolve';

type Requirement =
    | 'depth' | 'viewZ' | 'normal' | 'velocity'
    | 'metalrough' | 'diffuse' | 'emissive' | 'bloomIntensity';

interface EffectDef<S> {
    id: string;
    role: PassRole;
    order: number;              // sort key within the role
    requires: Requirement[];    // drives MRT provisioning
    conflicts?: string[];       // ids that cannot be co-enabled
    /** Non-hot params: changing these forces a graph rebuild (see §4). */
    structural?: (keyof S)[];
    build(ctx: BuildContext, u: UniformBag<S>): Node;
}
```

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
3. **Fold chain effects** in `order`, threading `ctx.color`.
4. **Apply resolve effects** last, at most one AA; set `outputColorTransform`
   according to whichever resolve effect is active.
5. Assign `pipeline.outputNode`, set `pipeline.needsUpdate = true`.
6. Wrap the whole build in try/catch and fall back to a bare `pass(scene, camera)` on
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
rebuild. Known or suspected: `motionBlur` `numSamples` (an `int()` bounding a `Loop`),
`lut3D` `size` (LUT texture dimension), the `pixelationPass` construction params, and
possibly `GTAONode.samples` despite being a uniform. **Audit each at implementation
time rather than trusting this list.**

---

## 5. Effect inventory

Signatures quoted from `DOCS/three.js-dev/examples/jsm/tsl/display/`. Role and
requirements as per §2.

| Effect | Factory | Role | Requires | Notes |
|---|---|---|---|---|
| **ssaa** | `ssaaPass(scene, camera)` | base | — | `extends PassNode` |
| **pixel** | `pixelationPass(scene, camera, pixelSize, normalEdgeStrength, depthEdgeStrength)` | base | — | `extends PassNode`; does its own normal/depth edge work internally |
| **retro** | `retroPass(scene, camera, options)` | base | — | `extends PassNode`; example composes it with `bayerDither`, `scanlines`, `vignette`, `colorBleeding`, `barrelUV` from `CRT.js`. If the retro look bundles its own vignette, declare `conflicts: ['vignette']` so it isn't applied twice |
| **ao** | `ao(depthNode, normalNode, camera)` | chain | depth, normal | GTAO. `ssao(...)` is the alternative with the same signature |
| **ssgi** | `ssgi(beauty, depth, normal, camera)` | chain | depth, normal, diffuse, velocity | Composite is additive; example pairs it with `traa` when temporal filtering is on |
| **ssr** | `ssr(colorNode, depthNode, normalNode, options)` | chain | depth, normal, metalrough | Example: `smaa( scenePassColor.add( ssrPass.rgb ) )` |
| **denoise** | `denoise(node, depth, normal, camera)` | chain | depth, normal | `recurrentDenoise(inputTexture, camera, options)` is the temporal variant used in the ssr_denoise example |
| **dof** | `dof(node, viewZNode, focusDistance, focalLength, bokehScale)` | chain | viewZ | viewZ from `basePass.getViewZNode()` — no MRT attachment |
| **motion blur** | `motionBlur(inputNode, velocity, numSamples)` | chain | velocity | A TSL `Fn`, not a node class |
| **bloom** | `bloom(node, strength, radius, threshold)` | chain | — | Additive |
| **bloom (emissive)** | same, fed an `emissive` MRT texture | chain | emissive | Example sets `emissiveTexture.type = UnsignedByteType` to save bandwidth |
| **anamorphic** | *composed* | chain | — | **No shipped node.** The example builds a custom high-pass `Fn`, runs `bloom()` on it, tints, and adds. Budget it as real work |
| **afterimage** | `afterImage(node, damp)` | chain | — | Feedback buffer; interacts badly with temporal AA — verify |
| **vignette** | *ours* — hand-written `Fn` (§5.1) | chain | — | Applied late, after grading, before AA |
| **3dlut** | `lut3D(node, texture3D, size, intensity)` | resolve/grade | — | Needs a LUT asset pipeline (§7). Example sets `outputColorTransform = false` |
| **traa** | `traa(beauty, depth, velocity, camera)` | resolve | depth, velocity | Temporal AA; conflicts with smaa/fxaa |
| **smaa** | `smaa(node)` | resolve | — | Conflicts with traa/fxaa |
| **fxaa** | `fxaa(node)` | resolve | — | Needs sRGB input → `outputColorTransform = false` + manual `renderOutput()` |
| **transition** | `transition(a, b, mixTexture, mixRatio, threshold, useTexture)` | resolve | — | §6 |

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

- **3D LUTs.** `lut3D` needs a `texture3D`. LUT files (`.cube` / `.3dl`) load via
  three's `LUTCubeLoader`/`LUT3dlLoader` addons. Decide where they live (`public/luts/`)
  and whether a default set ships. This is the only effect on the list with an asset
  dependency.
- **Transition masks.** Optional greyscale textures for wipe patterns; the example
  uses `textures/transition/transition{1..6}.png`. Ship two or three or start with
  `useTexture = 0` (plain fade).
- No new npm dependencies. Everything is `three/addons/tsl/display/*`, already present.

---

## 8. Risks and things to verify in a browser

Nothing in this document has been run. In particular:

1. **Do the base-pass effects support MRT usefully?** All three extend `PassNode` so
   the API exists, but whether `pixelationPass` + `ao`, or `retroPass` + `traa`,
   produce anything sane is unknown. The old pipeline simply skipped depth-dependent
   effects when pixelation was on. Verify before promising the combination.
2. **MRT on the main pass vs. a separate pre-pass.** Most examples set MRT on the
   beauty pass (one rasterization). The `ao` example instead runs a dedicated
   `prePass` with `transparent = false`, because transparent geometry writes garbage
   normals and velocity. **Recommendation: start with MRT on the main pass** (cheaper,
   matches most examples) and switch to a pre-pass only if transparents visibly
   corrupt AO/SSR. Document whichever is chosen — it is the pipeline's biggest cost
   decision.
3. **`outputColorTransform` ownership.** `fxaa` and `lut3D` both want it off, and
   Studio renders on top of our output. Whether disabling it breaks Studio's gizmo,
   PiP or selection outline is untested.
4. **`afterImage` × temporal AA.** A feedback buffer plus `traa`'s history buffer is
   a plausible source of smearing or feedback runaway.
5. **Cost.** `ssgi` + `ssr` + `traa` together is a heavy pipeline. The `quality`
   setting in `settingsState.graphics` currently changes nothing visually; it should
   gate which effects are even offered.
6. **Studio task ordering.** The new pipeline must re-apply the rules in
   `webgpu-notes.md` §2 — they were written for the deleted `EffectComposer` but the
   DAG constraints are unchanged.

---

## 9. File plan

### Added

| Path | Purpose |
|---|---|
| `src/core/postprocessing/registry.ts` | Effect definitions (§3.1) — the single source of truth |
| `src/core/postprocessing/build.ts` | The builder (§3.3): base pass, MRT union, fold, resolve |
| `src/core/postprocessing/uniforms.ts` | The uniform bag — create, look up, write `.value` |
| `src/core/postprocessing/effects/*.ts` | One small module per effect, each exporting an `EffectDef`. Most wrap an addon node; `vignette.ts` is hand-written TSL (§5.1) and is the template for any future custom effect |

### Rewritten

| Path | Change |
|---|---|
| `src/core/Renderer.svelte` | Stub → owns the `RenderPipeline`, the structural effect and the uniform effect (§4). Task ordering per `webgpu-notes.md` §2 |
| `src/extensions/postprocessing/types.ts` | Per-effect param sets for the new list; the pmndrs-era types (glitch, shockWave, ascii, tiltShift, scanline, sepia, dotScreen…) go |
| `src/extensions/postprocessing/postprocessing.svelte.ts` | State for the new effect set; preset/localStorage layer dropped |
| `src/extensions/postprocessing/PostProcessingExtension.svelte` | Rebuilt against the registry — roles, conflicts and the live MRT set are rendered *from* the registry, not hand-written |

### Deleted

| Path | Reason |
|---|---|
| `src/extensions/postprocessing/bundledPresets.ts` | Preset layer removed; contains only commented-out examples |
| `src/extensions/postprocessing/usePostProcessing.ts` | Zero consumers |

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
3. **Geometry pipeline.** MRT provisioning, then `ao` and `dof`. This is where
   decision §8.2 gets settled with real pixels.
4. **Temporal.** `traa` + velocity, then `motionBlur`. Both depend on the same
   attachment; do them together.
5. **Heavy GI.** `ssgi`, `ssr`, `denoise`. Gated behind the `high` quality tier.
6. **Base-pass alternates.** `pixel`, `retro`, `ssaa` — plus the conflict UI, which
   only becomes meaningful once there is more than one base pass to conflict.
7. **Grade and extras.** `3dlut` (+ LUT loading), `anamorphic`, `afterimage`,
   `vignette`, `fxaa` as the low-end AA option.
8. **Transitions.** `TransitionNode` wired to `scene.transitionTo`.

Phases 1–2 are the ones that prove the architecture. If the structural/uniform split
does not hold there, stop and fix it before adding effects — that is exactly the
mistake the previous pipeline made.

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
