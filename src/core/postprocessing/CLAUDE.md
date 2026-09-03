# Post-processing engine (`src/core/postprocessing/`)

The effect registry + pipeline builder. The state + Studio panel live in
`src/extensions/postprocessing/` (see its `CLAUDE.md` for effect params/behavior);
`core/utils/Renderer.svelte` owns the built `RenderPipeline`. Nothing hand-wires a
graph — everything is declared in the registry and assembled by the builder.

```
types.ts       — PassRole / Requirement / EffectDef / BuildContext — the declaration shapes
registry.ts    — EFFECTS list + resolveEnabledSet policy + structuralKeyOf
build.ts       — the builder: base pass, MRT union, chain fold, grade, resolve, fallback
uniforms.ts    — createUniformBag / writeUniformBag — the hot-update path
luts.svelte.ts — LUT catalogue + async load cache (three's nine example LUTs, public/luts/)
effects/*.ts   — 10 EffectDefs: ssaa, retro (base) · dof, motionBlur, bloom (+lensflare
                 sub-toggle), afterimage, vignette (chain) · lut (grade) · smaa, fxaa (AA)
```

## Roles — effects are not peers

Four `PassRole`s exist because a flat enable-grid cannot express the relationships:

- **base** (`ssaa`, `retro`) — mutually exclusive; each *is* the scene pass
  (`extends PassNode`). None enabled → the default `pass(scene, camera)`. The builder
  asks `basePass.getMRT()` instead of assuming the default — a base pass may provision
  attachments the registry never asked for (pixelationPass did exactly that).
- **chain** (`dof`, `motionBlur`, `bloom`, `afterimage`, `vignette`) — plain
  colour-in/colour-out, folded in `order` threading `ctx.color`. Some are TSL `Fn`s,
  not node classes (`motionBlur`, `vignette`, our `dof`) — no instance holds uniforms,
  so **the uniform bag is the only way to animate them**.
- **grade** (`lut`) — after the chain, before resolve, **not** mutually exclusive.
  Added so a LUT and AA can coexist; grading is orthogonal to anti-aliasing.
- **resolve** (`smaa`, `fxaa`) — AA, at most one (two is wasteful and worse-looking).

The MRT set is a **function of the enabled set**, never fixed: the builder unions the
`requires` of every survivor and provisions only that. `viewZ`/`depth` come free from
`PassNode` (`getViewZNode()`) and add no attachment. Live MRT consumers today:
`velocity` (motionBlur) and `emissive` (bloom Material mode, provisioned only when the
mode param asks — `requiresValues` on the def).

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
base pass (verified combinations only).

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
`if (basePass.getMRT() !== null) basePass.contextNode = context();` — an empty
`context()` gives identical context *data* with distinct node *identity*: same generated
code, private cache namespace. A fresh context per rebuild also handles attachment-set
changes. Read "the error names *a* culprit, not the only one" (the encoder aborts at the
first bad pipeline) — and never "fix" this by disabling the env bake; that treats one
racer, not the race.

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
  abs(viewZ + focus)))`. The bokeh `DepthOfFieldNode` was dropped for performance (one
  box blur vs its multi-pass kernel). viewZ from `basePass.getViewZNode()`, no MRT.
- **`motionBlur`** — three's Fn is the one sampler addon that does NOT
  `convertToTexture` its input; our wrapper does (an RTT when fed a computed node,
  e.g. anything after the basic DoF), otherwise it throws `inputNode.sample is not a
  function`.

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

## Removed effects: pixelation, ao, ssgi, ssr, traa

Cut wholesale after being built — a **scope decision, not a defeat**: the shared root
cause (the shader-cache trap) was found and fixed, so they could have been finished.
What a revival restores:

- MRT rows: `ao`/`ssao` (depth, normal), `traa` (depth, velocity), `ssgi` (depth,
  normal, velocity, diffuse), `ssr` (depth, normal, metalrough), `denoise` (depth,
  normal). The union algorithm is untouched and still general — a row in `build.ts`'s
  MRT table, a `Requirement` member, and the unpack node on `BuildContext`.
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

## Scene transitions — decided, not built

Single-scene **fade**, not a true two-scene crossfade: `TransitionNode` needs both
scenes rendering every frame, which keep-alive mounting makes expensive. Plan: pass A is
the live scene pass, pass B a cheap constant node; all the mask-texture machinery
(wipes, dissolves) still works, only a genuine A→B crossfade doesn't. `mixRatio` is one
`uniform()` eased by a task; the scene swap happens at `mixRatio === 1` — the covered
midpoint, which is also where a scene's environment swap should land (see the plan in
`src/extensions/scene/CLAUDE.md`). Today `transitionTo` is a two-phase `setTimeout`
around `setScene` — nothing visual happens.
