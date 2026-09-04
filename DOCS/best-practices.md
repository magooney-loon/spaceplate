# Performance Best Practices — three.js / WebGPU, as they apply to spaceplate

Reference distilled from Utsubo's ["100 Three.js Tips That Actually Improve Performance
(2026)"](https://www.utsubo.com/blog/threejs-best-practices-100-tips) by Jocelyn Lecamus
(Mar 2026), then **audited tip-by-tip against this repo and against the installed
three 0.185.1 source** (`node_modules/three/src/`, not from memory). Bracketed numbers
like `[31]` are the source article's tip numbers, kept so a claim can be traced back.

The article is written for vanilla three + React Three Fiber + pmndrs/postprocessing.
This engine is Threlte 8 / Svelte 5 runes / `WebGPURenderer` / three's **native TSL**
post-processing, so a large fraction of it is either already true here, expressed
differently here, or **wrong here**. That triage is the point of this document.

**How to use it:** §1 tells you not to re-apply something. §2 stops you copying a code
sample that no longer compiles. §3 is the actual work queue. §4 is the rule set for new
scene content. §5–§7 are the pipeline, the profiling loop and the techniques not yet
used.

Companion docs: `webgpu-notes.md` (renderer gotchas — read that first when something
renders wrong), `RAPIER.md` (physics), and the per-area `CLAUDE.md` files.

---

## 1. Already handled — do not re-apply

| Tips | Handled by | Where |
| ---- | ---------- | ----- |
| 1, 2 | `WebGPURenderer` + WebGL2 auto-fallback; Threlte's WebGPU `<Canvas>` awaits `renderer.init()` before mounting the scene, so nothing renders against an uninitialized backend | `App.svelte` `createRenderer`, `@threlte/core/webgpu/Canvas.svelte` |
| 3, 10, 48, 49, 50 | TSL / node materials / `Fn` are the house style | `core/postprocessing/effects/*.ts`, `core/skybox/layers/*` |
| 4, 5 | GPU-persistent particle state: `instancedArray` storage driven by two `renderer.compute()` passes | `core/skybox/layers/fauna/Birds.svelte` |
| 6, 7, 8, 9 | Already on WebGPU with auto-fallback; the boot probe decides the tier. Migration/support-matrix advice is moot | `core/utils/capabilities.svelte.ts` |
| 11 | **Deprecated advice** — see §2.1. Compute→render ordering is handled by task constraints, not by an async render | `Birds.svelte`, `core/utils/Renderer.svelte` |
| 14 | Feature detection by a successful `requestAdapter()`, not by `navigator.gpu` existing | `core/utils/capabilities.svelte.ts` |
| 17 | Physics is Rapier (CPU/WASM, fixed-step); GPU compute is reserved for layer-local sims like Birds | `@threlte/rapier`, `Birds.svelte` |
| 28, 29 | Draco + Meshopt + KTX2 decoders wired into every `useGltf`, fetched on demand from jsdelivr and pinned to the installed `REVISION` | `extensions/gltf-viewer/GltfViewerInstance.svelte` |
| 31 (sky) | Every particle layer is one instanced quad + per-instance attributes — was `count * 4` duplicated vertices (Rain 1.52 → 0.25 MB, Snow 2.20 → 0.40, Stars 0.64 → 0.12). **Game content is a separate story — see §3.2** | `core/skybox/layers/skyLayer.ts` `instancedQuad` |
| 36 | Frustum culling is three's default; the hard case — pinned sky layers that must NOT be culled — is codified | `core/skybox/layers/CLAUDE.md` (`pinFarPlane`, `frustumCulled={false}`) |
| 37, 41, 42 | Disposal: Threlte auto-disposes `<T>`-created objects; script-owned objects dispose in `$effect` cleanup; pipeline nodes via `ctx.track` | `core/skybox/Sky.svelte`, `core/postprocessing/types.ts` |
| 43 | `mediump`/`highp` are GLSL qualifiers; TSL → WGSL abstracts precision away | — |
| 57 | Shadow map size per quality preset (high 2048² / low 1024²), runtime-changeable | `core/skybox/Skybox.svelte` `SHADOW_MAP_SIZE` |
| 58 | R3F-only library | — |
| 59 | Environment lighting baked from the procedural sky via CubeCamera/CubeRenderTarget; modes procedural \| HDR \| cube | `core/skybox/Sky.svelte`, `core/skybox/environment/` |
| 60 | Shadow camera frustum fitted to the scene (ortho half-extent, near/far, `updateProjectionMatrix`) | `core/skybox/SkyLight.svelte` |
| 61 | One shadow render per frame: `shadow.autoUpdate = false`, `needsUpdate` armed once; extra cameras/override passes suspend shadows explicitly | `core/skybox/SkyLight.svelte`, `layers/precipitation/HeightField.svelte` |
| 63–72 | Whole section is R3F-specific. The Threlte equivalents are engine rules: frame tasks mutate three objects directly (no per-frame reactive state), pre-allocate (no `new` in tasks), `delta` is SCENE time via `engineClock`, `renderMode` on-demand with one `invalidate()` owner per reason, the scene router toggles `visible` instead of remounting, perf overlay is StatsExtension | `src/CLAUDE.md` "Frame tasks", `Scene.svelte`, `extensions/stats` |
| 73, 75, 81 | pmndrs/postprocessing-specific; this engine uses three's native TSL pipeline, which already folds effects into one graph with a single output transform | `core/utils/Renderer.svelte`, `core/postprocessing/` |
| 74 | `antialias: false`, `powerPreference: 'high-performance'` — the latter is **fixed on purpose**, `'low-power'` can hand you a dying adapter (`webgpu-notes.md` §8) | `App.svelte` `createRenderer` |
| 76 | ⚠️ **Following this tip would break the engine.** Tone mapping has exactly one owner (Threlte's `<Canvas toneMapping>`, AgX default). The pipeline READS `renderer.toneMapping`, never writes it — two owners caused real bugs | `src/CLAUDE.md`, `core/postprocessing/build.ts` |
| 77 | Selective bloom already exists: bloom `mode: 1` reads the **`emissive` MRT attachment** instead of scene luminance, and the MRT set is provisioned only when that mode is on | `core/postprocessing/effects/bloom.ts` |
| 78 | AA at pipeline end: FXAA / SMAA / SSAA effects in the registry | `core/postprocessing/effects/` |
| 79 | Effect params are live-tweakable via uniform writes in place (no graph rebuild) | `core/utils/Renderer.svelte`, `extensions/postprocessing` |
| 80 | Render scale is the `dpr` knob from the quality preset; **low quality bypasses the pipeline entirely** — no base-pass render target is allocated at all | `App.svelte`, `core/utils/Renderer.svelte` (`bypass`) |
| 82 | Native TSL post-processing IS this engine (`RenderPipeline` + TSL nodes) | `core/utils/Renderer.svelte`, `core/postprocessing/` |
| 83, 85, 89 | Scenes mount on first visit (keep-alive) and the boot warmup sweep renders every scene behind the loading screen — lazy-load/placeholder patterns for content sites do not apply to a full-canvas app | `Scene.svelte`, `core/utils/boot.svelte.ts`, `Loader.svelte` |
| 84 | Studio + every extension panel are dynamically imported behind `VITE_GAME_ENGINE` and never ship; three itself is needed at boot | `App.svelte` |
| 90 | R3F-specific (Svelte: `{#await}` / loaded flags) | — |
| 91, 97 | stats-gl integrated, including the WebGPU timestamp-query resolution gotcha (stats-gl never resolves the queries itself on a three `WebGPURenderer`) | `extensions/stats/StatsExtension.svelte` |
| 92 | Live tweaking via svelte-tweakpane-ui + Studio panels | `extensions/*`, `@threlte/studio` |
| 94 | `renderer.info` sampled after the pipeline draws — draw calls, triangles, geometries, textures, programs, plus fps/loopHz to tell "on-demand skipped the render" from "the frame got slower" | `core/utils/Telemetry.svelte` → Settings ▸ System |
| 100 | Threlte's scheduler owns the loop (`autoRender={false}` + explicitly ordered tasks) | `src/CLAUDE.md` "Frame tasks" |

**58 of 100.** The still-relevant essentials from the rest: draw calls under 100/frame,
bake what you can, pool spawned entities, profile before optimizing.

---

## 2. Corrections — where the article is wrong for three 0.185 + WebGPU

Every item below was checked against `node_modules/three/src/`. Copying the article's
sample verbatim gets you a deprecation warning, a missing export, or a silent blank
render.

### 2.1 `renderAsync()` is deprecated [11]

```js
// three 0.185, Renderer.js:1078
warnOnce('Renderer: "renderAsync()" has been deprecated. Use "render()" and
         "await renderer.init();" when creating the renderer.'); // @deprecated r181
```

`renderAsync()` is now literally `await this.init(); this.render(...)` — it never
synchronized compute against rendering. Same deprecation on `clearAsync`,
`clearColorAsync`, `clearDepthAsync`, `waitForGPU`, `hasFeatureAsync`. Threlte's WebGPU
`<Canvas>` already awaits `init()` before the scene mounts, so **the whole tip is a
no-op here**.

Compute→render ordering is a *task ordering* problem in this engine, not a promise
problem: Birds' compute runs from a `{ before: autoRenderTask }` task, the pipeline
draws from `{ after: autoRenderTask }`. Whoever writes must register before whoever
reads. `computeAsync()` is **not** deprecated, but its only job is `if (!initialized)
await init()` — which is exactly why Birds uses it for the first pass only and the
sync `compute()` thereafter (`renderer.compute()` before init warns and falls back).

### 2.2 There is no `storageTexture` TSL export [13, 18]

The article's `storageTexture(w, h)` does not exist. The real API:

```js
import { StorageTexture } from 'three/webgpu';
import { textureStore, uvec2, vec4 } from 'three/tsl';

const target = new StorageTexture(width, height);   // class, from three/webgpu
textureStore(target, uvec2(x, y), color);           // node, from three/tsl
```

(`storageTexture3D` does exist, for the 3D case.) `workgroupArray` /
`workgroupBarrier` / `atomicAdd` [19] are correct as written.

### 2.3 Indirect draws use `geometry.setIndirect`, not `mesh.drawIndirect` [20]

```js
import { IndirectStorageBufferAttribute } from 'three/webgpu';

// ctor is (count, itemSize) — the buffer is Uint32Array implicitly, there is no
// 'uint' type argument.
const indirect = new IndirectStorageBufferAttribute(4, 1);

geometry.setIndirect(indirect);         // → geometry.indirect / geometry.indirectOffset
// indirectOffset may be an array: multiple indirect draws from one buffer.
```

WebGPU backend only. `renderer.compute(node, indirectAttribute)` takes an
`IndirectStorageBufferAttribute` for indirect *dispatch* too.

### 2.4 `mx_fractal_noise_float` signature [51]

```js
mx_noise_float(texcoord = uv(), amplitude = 1, pivot = 0)
mx_fractal_noise_float(position = uv(), octaves = 3, lacunarity = 2, diminish = 0.5, amplitude = 1)
```

The article's fourth argument "gain" is `diminish`, and it misses the fifth.

### 2.5 `SelectiveBloomEffect` is a pmndrs class, and the engine already has the feature [77]

There is no `SelectiveBloomEffect` in three. The native equivalent — and what
`effects/bloom.ts` already does at `mode: 1` — is to bloom the **`emissive` MRT
attachment** rather than the colour buffer, so only materials that actually emit bloom.
Per-object layer masking is the remaining unexplored variant, and it is not obviously
worth it over emissive.

### 2.6 `<ContactShadows>` and `<CSM>` from `@threlte/extras` do not work on WebGPU [56, 62]

Both are WebGL-path components, and per `webgpu-notes.md` §1 they fail **silently**:

- `ContactShadows.svelte` blurs its shadow RT with two `ShaderMaterial`s
  (`HorizontalBlurShader` / `VerticalBlurShader`). `NodeLibrary` has no `ShaderMaterial`
  mapping → blank material, no error. Fake contact shadows must be hand-rolled: a plane
  with a TSL radial-gradient `opacityNode`.
- `CSM.svelte` wraps `three/examples/jsm/csm/CSM.js`, which patches
  `ShaderChunk.lights_fragment_begin` and sets `material.onBeforeCompile` — GLSL string
  patching, meaningless to a `NodeMaterial`.

The node-path CSM does exist and is the only viable route if the scene ever outgrows one
2048² map:

```js
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';

light.shadow.shadowNode = new CSMShadowNode(light, { cascades: 4, maxFar: 1000 });
// AnalyticLightNode picks up light.shadow.shadowNode as a custom shadow node.
```

Untested here. `SkyLight.svelte`'s fitted single cascade is the current design and is
correct for the demo's scale.

### 2.7 `webglcontextlost` is the wrong hook [98]

See §3.1 — three already owns the listener and exposes overridable callbacks.

---

## 3. Open gaps — the actual work queue

Ranked by (value × how cheap). Each has been verified as *not currently done*.

### 3.1 Device loss is unhandled (cheap, high value)

`grep -rn "device.lost\|contextlost" src/` returns nothing. But three already wires it:

```js
// WebGPUBackend.js:262
device.lost.then((info) => { if (info.reason !== 'destroyed') renderer.onDeviceLost(info); });
device.onuncapturederror = (event) => renderer.onError({ api: 'WebGPU', ... });
```

`renderer.onDeviceLost` / `renderer.onError` are **public, overridable** properties
(assigned from `_onDeviceLost` / `_onError` in the constructor). The defaults
`console.error` and set `_isDeviceLost = true` — so today a lost device is a frozen
canvas with a console message the player never sees.

The fix belongs in `App.svelte`'s `createRenderer`: override both to push a state flag
that `Loader.svelte` renders as a "graphics device lost — reload" overlay, reusing the
path `capabilityState.tier === 'none'` already has. The boot probe covers "no backend at
boot"; this covers "backend died at 03:00 into a session", which is the common one on
laptops that sleep, on driver updates, and after a GPU hang from a bad shader.

Do **not** add DOM `webglcontextlost` listeners — that only fires on the WebGL fallback
path and duplicates a listener three already installs.

### 3.2 Spawned physics bodies: N draw calls, N materials [31, 33, 39]

`DemoScene.svelte:152` renders `physicsState.bodies` as one `<T.Mesh>` per body inside
`{#each}`. Geometry is shared (`spawnBallGeometry` / `spawnBoxGeometry` — good), but
each body constructs its own `<T.MeshStandardMaterial color={body.color} flatShading />`,
and `physicsActions.spawnBall/spawnBox` push unboundedly with no cap and no reuse
(`clearBodies()` drops the whole array).

So the spawn button is a linear draw-call and material-allocation generator, and it is
the one place in the repo where the article's three most-cited tips all land at once:

1. **Instance them.** `<InstancedMesh>` + `<Instance>` from `@threlte/extras` is the
   declarative form — one draw call per shape, per-instance colour built in. Rapier
   still needs one body per instance; only the *rendering* collapses.
2. **Share the material.** Colour becomes a per-instance attribute rather than a
   material property. Materials differing only by uniform still share a compiled
   pipeline, so the win here is allocation and disposal churn, not program count — but
   `telemetryState.programs` is the number to watch if that assumption ever breaks.
3. **Pool them.** Cap the pool, recycle the oldest instead of growing — the classic
   `acquire()`/`release()` pair, pre-warmed at load so no allocation happens mid-session.

Note that the sky layers already solve exactly this problem, one level lower: fixed
instance counts, recycled slots, per-instance attributes (`skyLayer.ts`,
`Meteors.svelte`). Game content should reuse the shape of that solution, not reinvent it.

### 3.3 No texture cache [40]

`Moon.svelte:51` and `DemoPhysicsBodies.svelte:111` each construct their own
`new THREE.TextureLoader()` and load their own files. Fine at today's asset count, and
both correctly use the sync-return + `invalidate()` on load pattern (`useTexture` from
`@threlte/extras` returns an `AsyncWritable` store, which this repo's runes-only rule
forbids). It stops being fine the moment two components want the same file, because
nothing dedupes:

```ts
const cache = new Map<string, THREE.Texture>();
export const getTexture = (url: string, onLoad?: () => void) => {
	let tex = cache.get(url);
	if (!tex) cache.set(url, (tex = new THREE.TextureLoader().load(url, () => onLoad?.())));
	return tex;
};
```

Belongs in `core/utils/` when a second consumer appears — with the caveat that a shared
texture must never be `dispose()`d by an individual component's `$effect` cleanup.

### 3.4 GLTF resources are cached, never freed [37, 38, 40]

`useGltf` caches by URL module-side in `@threlte/extras` — which is why N viewer
instances of one model cost one fetch and one decoder download. The flip side: removing
a model from `gltfViewerActions` unmounts the component but **does not free its
geometries or textures**; the cache holds them for the session. `GltfViewerInstance`
disposes only its `SkeletonHelper`.

For a dev-only viewer this is deliberate and fine. If models ever churn at runtime in a
real scene, both halves are needed — evict from the cache, then dispose, and for GLTF
textures specifically:

```js
texture.source.data.close?.(); // ImageBitmap: dispose() alone leaks the bitmap
texture.dispose();
```

Do this only for a texture you are certain nothing else references (see §3.3).

### 3.5 Everything runs on the main thread [87]

`grep -rn "new Worker\|?worker" src/ vite.config.ts` returns nothing. Rapier, the
SpacetimeDB client, all engine tasks and all procedural generation share one thread.
Not a problem at the current load, and moving Rapier off-thread would fight
`@threlte/rapier`'s synchronous body API. The realistic first candidates are
non-interactive: heightfield/terrain generation, mesh or texture preprocessing, and
anything that would otherwise produce a visible hitch at scene entry. Vite supports
`import Worker from './x?worker'` with no config.

---

## 4. Rules for new scene content

The engine core is tuned. These are the constraints on what gets added on top.

### Draw calls [30, 32, 34, 35]

- **Under 100 per frame** is the target; over 500 struggles on any GPU. Watch
  `telemetryState.drawCalls` in Settings ▸ System, and remember the sky already spends
  some of that budget (one per layer).
- Triangle count matters far less than call count.
- Repeated identical objects → `InstancedMesh` (§3.2). Varied geometries sharing one
  material → `BatchedMesh`. Static props that never move → merge once at load with
  `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js` and accept losing
  per-object culling and picking.
- Array textures (`DataArrayTexture`) plus `BatchedMesh` give varied appearance at one
  bind — the "many different props, one draw call" endgame. Nothing here needs it yet.

### Materials

- **`ShaderMaterial` / `RawShaderMaterial` render blank and do not throw.** This is the
  single most expensive mistake available in this repo — `webgpu-notes.md` §1. Standard
  materials are auto-nodified and fine; anything custom is TSL.
- Share material instances across meshes. Vary appearance by uniform or per-instance
  attribute, not by a new material per object.
- `THREE.Points` is always 1px on WebGPU regardless of `sizeNode` — sized points must be
  quads (`webgpu-notes.md` §1.1).

### Lights & shadows [53, 54, 55]

- **Three lights maximum**, and the sky's key light is already one of them. Past that,
  bake or lean on `scene.environment`, which the procedural sky provides for free.
- A shadow-casting `PointLight` costs **6 shadow renders** — `objects × 6 × lights`
  extra draw calls. Two of them over 10 objects is 120 calls, i.e. the entire budget.
  Prefer directional/spot, or fake it.
- Static lighting → bake to a lightmap in Blender. Baked light is free at render time.
- Any new camera or override pass must suspend shadows explicitly, or it re-renders the
  shadow map — see `SkyLight.svelte` and `HeightField.svelte` for the pattern.

### Frame tasks & memory [39, 66, 67]

- Never allocate in a task body. Pre-allocate vectors, matrices and arrays at module or
  component scope and mutate them.
- Pool anything spawned and destroyed repeatedly; pre-warm the pool during loading.
- `delta` is scene time (`engineClock`); `performance.now()` in a task is banned
  (`core/utils/CLAUDE.md`).
- `autoInvalidate: false` on every task, and `invalidate()` only when something actually
  moved. One owner per reason.

### TSL shaders [44, 45, 46, 47, 52]

- Keep varyings few; pack rather than add channels. Pack four values per texel into RGBA
  rather than sampling four textures.
- Prefer branchless math — `mix()`, `step()`, `select()` — over `If()`. The legitimate
  exception is a gate that skips genuinely expensive work, like CloudDeck's empty-sky
  early-out: the branch exists precisely so the costly path isn't paid.
- Fixed loop bounds only — `Loop(16, ...)`, or unroll. Dynamic bounds block unrolling and
  register allocation.
- Identical node graphs share a compiled program. Gratuitous per-instance variation in
  how uniforms are declared multiplies programs; `telemetryState.programs` growing
  without bound as scenes accumulate is the symptom.
- The MRT shader-cache trap, `fragmentNode` bypassing MRT, and non-`output` attachments
  not blending are all documented in `core/postprocessing/CLAUDE.md` — read it before
  adding an effect.

---

## 5. Asset pipeline [21–27]

Runtime decoding of all of these is already wired (Draco + Meshopt + KTX2). This section
is about *producing* the assets — a 50 MB GLTF ruins load time no matter how good the
rendering code is.

```bash
# The one command that does most of it
gltf-transform optimize model.glb out.glb --texture-compress ktx2 --compress draco

# Or piecewise
gltf-transform draco model.glb out.glb --method edgebreaker   # geometry −90..95%
gltf-transform uastc model.glb out.glb                        # textures, high quality
```

- **KTX2 is the big one.** PNG/JPEG decompress fully into VRAM — a 200 KB PNG can occupy
  20 MB+. KTX2 (Basis Universal) stays compressed on the GPU: roughly 10× less memory.
- **UASTC** for normal maps and hero textures (quality, larger files); **ETC1S** for
  diffuse and secondary assets (small, acceptable). Start there, tune per asset.
- Shopify's **gltf-compressor** gives a live before/after so "how far can I push this
  before it looks bad" is an answer, not a guess.
- Atlas textures where you can: fewer binds, and it composes with `BatchedMesh`.
- **LOD** is unused in this engine. `LOD` is re-exported from `three/webgpu` (via
  `Three.Core.js`), so it needs no separate `three` import — mixing entrypoints is banned.
  Manual distance-based swaps in a task work too and are easier to keep on-budget.

---

## 6. Profiling playbook [93, 96, 99]

Profile before optimizing; the bottleneck is rarely where it feels like it is.

1. **Settings ▸ System first** (`core/utils/Telemetry.svelte`). fps vs loopHz separates
   "render skipped, on-demand working" from "frames got slower". Then drawCalls,
   triangles, geometries, textures, programs — a number growing monotonically across a
   session is a leak.
2. **StatsExtension** for the GPU panel (timestamp queries, resolved manually — see
   `webgpu-notes.md` §8).
3. **Chrome `chrome://gpu`** for WebGPU status; enable "WebGPU Developer Features" in
   `chrome://flags`. WebGPU shader-compilation and validation errors are far more verbose
   than WebGL's and come with stack traces. **Spector.js only sees the WebGL path** — it
   is useless against the WebGPU backend, which is the one that ships.
4. **DevTools Performance tab** on a real session, not a synthetic loop: long frames, GC
   pauses, blocking JS. Task markers show which registered task owns the time.
5. **`src/__debug/`** — the probe harness. Headless Firefox with console piped to stdout,
   canvas readback instead of trusting the console, reading the *served* bytes rather than
   the source (`webgpu-notes.md` §5).
6. When a suspicion needs a number, wrap the suspect task in timing rather than guessing —
   ordered tasks make that unambiguous.

---

## 7. Techniques not used yet

Reference-grade notes for when they become relevant. APIs verified against 0.185.1.

- **Compute shaders beyond particles** [17, 18]. Birds is the template: `instancedArray`
  storage, two `renderer.compute()` passes from a `{ before: autoRenderTask }` task, a
  `computeAsync` warm-up for the pre-init frame with *two* flags (issued-synchronously
  vs settled — one flag doing both jobs was a real bug), and a backend gate that goes
  dormant on WebGL2 rather than erroring. GPU terrain generation would follow the same
  shape with a `StorageTexture` output (§2.2).
- **Workgroup shared memory** [19]. `workgroupArray('float', 256)` +
  `workgroupBarrier()`. 10–100× faster than global memory for repeated access, worth it
  only for genuinely shared reads within a workgroup.
- **Indirect draws / GPU-driven culling** [20]. §2.3 for the real API. This is the
  millions-of-instances endgame — GPU frustum culling and LOD selection writing draw
  parameters the CPU never reads. Very far from needed here.
- **Bind group model** [12]. WebGPU batches resources into bind groups; three manages
  them automatically. Knowing that frequently-updated uniforms (time, camera) and static
  data (textures, materials) live in different groups mainly helps when reading a capture.
- **three-mesh-bvh** [95]. Not a dependency. For raycasting against dense visual geometry
  (80k+ polys at 60fps) — Rapier colliders already cover physics interaction, so this is
  only for picking against detailed meshes.
  ```js
  mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
  mesh.raycast = acceleratedRaycast;
  ```
  Note `extensions/scene/CLAUDE.md`: hidden keep-alive scenes still raycast if they
  register pointer handlers.
- **Progressive loading / streaming** [86, 88]. Low-res first then swap; chunk load/unload
  keyed on camera position. Relevant the day a world outgrows one scene component.
  Interacts with the keep-alive router — chunks must dispose, unlike scenes.
