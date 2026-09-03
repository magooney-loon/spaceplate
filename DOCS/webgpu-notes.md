# WebGPU Notes — Gotchas, Rules and Debugging

Hard-won findings from the WebGPU migration. This is a **reference**, not a plan —
everything here is done, verified, and still true. It exists because most of these
cost hours to find and none of them are discoverable from the code.

Distilled from the now-deleted `webgpu-migration-roadmap.md`, `graphics-rework.md` and
`RendererWebGlStudioIssue.md`.

---

## 1. Materials: `NodeMaterial` only

`WebGPURenderer` renders `NodeMaterial`-based materials. Raw `ShaderMaterial` /
`RawShaderMaterial` **does not work** — and critically, it does not throw.
`NodeLibrary` has no `ShaderMaterial` mapping, so the material is silently replaced
with a blank `NodeMaterial` and the object renders wrong. There is no console error.

> **If something renders blank, black, or flat under WebGPU, check for a
> `ShaderMaterial` before anything else.**

Standard materials (`MeshStandardMaterial`, `MeshPhysicalMaterial`, …) are fine — they
are auto-nodified internally.

Known instances found and fixed:

| Source                                                          | Fix                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@threlte/extras` `<Sky>` (wraps `examples/jsm/objects/Sky.js`) | Replaced with three's `SkyMesh` (TSL/NodeMaterial port of the same Preetham model) — now `core/skybox/Sky.svelte`                                                                                                                                                |
| `@threlte/extras` `<Stars>`                                     | Dropped. Reimplemented as billboarded quads in `core/skybox/layers/celestial/Stars.svelte` — **not** point sprites, see §1.1                                                                                                                                     |
| Studio's `AxesHelper` → `Line2`/`LineMaterial`                  | `three/examples/jsm/lines/webgpu/Line2.js` + `Line2NodeMaterial`. `LineGeometry` is backend-agnostic. **Do not set `blending`** on it — it forces `NoBlending` deliberately, compositing transparency inside the node graph against `viewportOpaqueMipTexture()` |
| `three-viewport-gizmo` (vendors its own `LineMaterial`)         | No WebGPU build exists; axis stems disabled via the library's per-axis `line: false` option                                                                                                                                                                      |

### 1.1 Point primitives are always 1 pixel on WebGPU

A second silent failure, and the reason the star field is quads. `THREE.Points` with
`PointsNodeMaterial.sizeNode` is the obvious way to draw a star field. It compiles, it
renders, and every point is exactly one pixel — `sizeNode` is ignored. From three's own
source (`PointsNodeMaterial`, 0.185.1):

> WebGPU only supports point primitives with 1 pixel size. Consequently, this node has
> no effect when the material is used with `Points` and a WebGPU backend. If an
> application wants to render points with a size larger than 1 pixel, the material
> should be used with `Sprite` and instancing.

WGSL has no `gl_PointSize` equivalent, so this is a hardware/API limit, not a three bug.
Anything that needs sized points must draw **quads** — either `Sprite` + instancing, or
hand-built billboards. `core/skybox/layers/celestial/Stars.svelte` does the latter: four vertices per
star, offset in view space inside the TSL vertex node, one draw call.

### 1.2 `smoothstep(high, low, x)` is undefined, not reversed

Both GLSL and WGSL specify `smoothstep(edge0, edge1, x)` as **undefined when
`edge0 >= edge1`**. The descending form works on some drivers and produces garbage on
others, which makes it a genuinely nasty portability bug. Write the ascending form and
invert: `smoothstep(0, 1, x).oneMinus()`.

### 1.3 TSL assignment outside `Fn()` is dropped, not thrown

`assign` / `addAssign` / `mulAssign` need a **stack** to record into, and TSL only opens
one inside `Fn()`. Outside one, `Node.prototype.assign` takes this branch
(`src/nodes/tsl/TSLCore.js:72`):

```js
error('TSL: No stack defined for assign operation. Make sure the assign is inside a Fn().');
return this;
```

It logs and **returns `this`**. Nothing throws, the material still builds, and the
mutation silently never happens. This cost us a whole star field: the billboard offset
was written as

```ts
const mv = modelViewMatrix.mul(vec4(positionLocal, 1)).toVar();
mv.xy.addAssign(aCorner.mul(aSize)); // dropped on the floor
```

so all four vertices of every quad stayed on the same point and 2200 zero-area triangles
drew nothing at all. Two ways out:

- **Wrap the node in `Fn(() => { … })()`**, which is what `SkyMesh` does — that is why
  its `position.z.assign(position.w)` works.
- **Don't mutate.** Rebuild the value as a pure expression:
  `vec4(mv.xy.add(offset), mv.z, mv.w)`. No stack needed, and it cannot regress.

Only `assign` and its derivatives require the stack. `.toVar()` takes the generic
node-element path (`TSLCore.js:43`) and is safe outside `Fn()`.

> **If a TSL-built object renders nothing at all, check the console for "No stack
> defined" before suspecting geometry, culling or depth.**

Mixing `import 'three'` and `import 'three/webgpu'` is safe for **math and value
types** (`Color`, `Vector3`, `Quaternion`, `Euler`, geometry/material _types_) —
three's renderer dispatches on `isMesh`/`isLight`-style boolean flags, not
`instanceof`. Only actual node-material _construction_ needs `three/webgpu`.

Still unported: `src/lib/PlanetDemo/Planet.svelte`'s hand-written simplex/fractal
terrain `ShaderMaterial`. It needs a TSL rewrite and is the largest remaining port.

### 1.4 A material's compiled shader is cached across render targets and MRT states

three compiles a material lazily, on its first _draw_, reading `renderer.getMRT()` and
the current render target at that moment — then caches the result in
`NodeManager.nodeBuilderCache` under a key (`RenderObject.initialCacheKey`) that
records **neither**. Render objects are keyed per render context; the compiled shader
they share is not.

So whenever the same scene is rendered in two places with different attachment
counts — a post-processing MRT pass alongside Studio's viewport, `Sky.svelte`'s
`CubeCamera` environment bake, or `HeightField`'s ortho pass — one of them can be
handed the other's shader, and WebGPU rejects the draw:

```
Attachment state of [RenderPipeline "renderPipeline_NodeMaterial_22"] is not compatible
with [RenderPassEncoder]. Expects colorTargets [0, 1]; pipeline has [0].
```

The cure is to give the pass a private cache namespace via `PassNode.contextNode`
(`renderer.contextNode.id` _is_ in the key). Full write-up, including why the
alternatives are wrong: `post-processing.md` §8.7.

**That error text has two causes, and this is only one of them.** See §1.5 before
concluding it is the cache — the fix above is in place and working, and the same message
kept appearing anyway.

> **Two debugging notes that generalise.** Pipeline labels are
> `material.name || material.type`, so an unnamed material shows up as
> `NodeMaterial_22` and tells you almost nothing — **name your custom materials.** And
> the command encoder aborts at the _first_ invalid pipeline, so the error names one
> culprit even when many materials share the fault.

### 1.5 `fragmentNode` opts a material out of MRT — silently

`NodeMaterial.setup()` folds the renderer's MRT into the output only on its
`this.fragmentNode === null` branch. Set `fragmentNode` and the other branch runs
`setupOutput()` alone: the material emits a single `@location( 0 )` regardless of how
many attachments the pass has, and you get the §1.4 error from a material whose shader
was compiled correctly, in the right context, moments earlier.

- **`outputNode` is safe** — it still folds. Only `fragmentNode` bypasses.
- **An `isOutputStructNode` is safe** — the else-branch passes it through.
- Nothing catches the mismatch, because the WGSL is identical with and without MRT: it
  dedupes onto one `ProgrammableStage` (keyed on the shader _string_), and
  `WebGPUBackend.getRenderCacheKey()` includes attachment 0's format but never the
  attachment _count_. One GPU pipeline ends up shared across both passes.

So: **do not use `fragmentNode` on anything that renders inside the scene.** Reach for
`colorNode` plus `lights = false`, which is unlit in exactly the same way — with no
`lightsNode`, backdrop or emissive, `setupLighting()` returns `diffuseColor.rgb`
untouched, and `setupOutput()` (hence fog) runs on both branches either way.

### 1.6 Only the `output` MRT attachment blends

`MRTNode`'s constructor seeds `blendModes = { output: _materialBlending }`. Every other
attachment resolves to `_noBlending`, which `WebGPUPipelineUtils` turns into
`blend: undefined` — a straight overwrite, alpha ignored. Blending is per-_pass_ too
(`WebGPUPipelineUtils` reads `renderObject.context.mrt`), so a material cannot opt out of
it.

**A fullscreen quad inside the scene pass therefore wipes every non-`output`
attachment**, no matter how transparent it is: invisible in colour, destructive in
velocity/normals. That is how Studio's selection outline turned motion blur into an
identity transform (`post-processing.md` §8.9). Overlays belong after post-processing,
not in the base pass.

---

## 2. Studio task ordering

Threlte schedules render work through a DAG (Kahn's topological sort, FIFO). For tasks
at the same constraint level, **registration order decides execution order**.

| Task                         | Owner             | Constraint                            |
| ---------------------------- | ----------------- | ------------------------------------- |
| DefaultCamera PiP render     | `@threlte/studio` | `before: autoRenderTask`              |
| Selection texture pre-render | `@threlte/studio` | `before: autoRenderTask`              |
| `autoRenderTask`             | Threlte core      | — (stopped when `autoRender = false`) |
| Gizmo render                 | `@threlte/extras` | `after: autoRenderTask`               |

**The rules any custom render pipeline must follow:**

| Rule                                                             | Reason                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register with `{ after: autoRenderTask, autoInvalidate: false }` | Structurally guaranteed to run after DefaultCamera and RenderSelectedObjects **regardless of re-registration**. Studio's DefaultCamera unmounts and remounts when the editor camera is toggled; any `before: autoRenderTask` approach loses the race on remount |
| Place `<Renderer />` **first** inside `<Canvas>`                 | Among `after: autoRenderTask` tasks, insertion order decides. Registering first means the pipeline draws before the Gizmo, so the Gizmo composites on top                                                                                                       |
| Never use a bare `{ stage: renderStage }`                        | That makes the task _isolated_ in the DAG, and isolated tasks run after all connected ones — including the Gizmo, which then gets overwritten                                                                                                                   |
| Set the camera reactively                                        | Studio switches between editor and game camera; the pass must follow                                                                                                                                                                                            |

Resulting stable order:

1. DefaultCamera PiP → copies to its HTML canvas
2. RenderSelectedObjects → populates the selection render target
3. _(autoRenderTask — stopped)_
4. **Our pipeline** — samples a fresh selection target
5. Gizmo — draws on top

> **Superseded advice:** the old `RendererWebGlStudioIssue.md` also said to disable
> `autoRender` from inside an `$effect` rather than via the `<Canvas>` prop. **That is
> wrong** — see §3.1. Use the `<Canvas autoRender={false}>` option.

### 2.1 There are two frame clocks, and only one of them is Threlte's

A frame's time reaches your code by two independent routes, and they are **not** the same
number:

|                  | Source                                                      | Advances                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A task's `delta` | Threlte's `Scheduler` (`time - lastTime`, clamped to 0.1 s) | per rAF; render-stage tasks only see the frames that rendered                                                                                                       |
| TSL `time`       | three's `nodeFrame.time`, off `performance.now()`           | per rAF, **whether or not anything rendered** — three's `Animation` loop calls `nodeFrame.update()` before it calls the scheduler (`renderers/common/Animation.js`) |

So a layer that animates off the `time` node and one that integrates its task `delta` are on
different clocks already, and neither is under app control by default. `core/utils/engineClock.ts`
is where both are taken over:

- **The scheduler's delta** is substituted by handing `Scheduler.run` a fabricated timestamp —
  `lastTime + step * 1000`. One write, and every stage, task and Rapier accumulator sees `step`
  through Threlte's own arithmetic. This is why per-task clock plumbing is not needed and must
  not be added.
- **TSL `time`** has no public feed at all: the `time` node is
  `uniform(0).onRenderUpdate((frame) => frame.time)` (`nodes/utils/Timer.js`), so the only handle
  is `renderer._nodes.nodeFrame`, written directly, once per frame, before the render. Private
  field, guarded, warns once via `logEngine` if it ever moves.

`nodeFrame.time` is also bumped by `renderer.compileAsync()` (it calls `nodeFrame.update()`),
which is harmless only because the clock rewrites the value every frame.

`postprocessing`'s `EffectComposer` used to set `renderer.autoClear = false` permanently
in its constructor, which leaked into Studio's own renders and left outline trails.
That package is gone, but the shape of the bug is worth remembering: **a library that
mutates shared renderer state in a constructor will break every other consumer of that
renderer.**

---

## 3. Svelte reactivity around three.js

### 3.1 Never read and write the same state in one `$effect`

Every reactive loop hit during the migration had this shape, sometimes indirectly
through an action several calls deep.

The canonical example — this is an unconditional infinite loop:

```ts
// ❌ teardown restores the value → effect re-runs → sets it again → forever
$effect(() => {
	const before = autoRender.current; // tracked read
	autoRender.set(false); // reactive write
	return () => autoRender.set(before); // teardown → re-triggers
});
```

Threlte exposes `autoRender` through `runeToCurrentWritable`, so `.current` is a
tracked read and `.set()` is a reactive write. The fix is to not have the effect at
all: `<Canvas autoRender={false}>` accepts it as an option.

The indirect version is harder to spot. `Skybox.svelte` called
`skyboxActions.loadUserPreset()` from an effect → `applyPresetObject()` →
which _read_ `transitionState.transitionDuration` and _wrote_
`transitionState.isTransitioning`. Same loop, four calls away.

**Rules:**

- Effects depend on **primitive values** (strings, numbers), never on `$state` object
  graphs. Dereferencing 25 objects off a `$state` root makes all 25 dependencies.
- An effect must never call an action that touches state the effect also reads.
- Derive a **structural key string** and depend on that.

### 3.2 `$state.raw` for three.js instances

Wrapping a three.js object in `$state` proxies it. That was survivable for a
`ShaderMaterial` (shallow, acyclic) but not for a `NodeMaterial`, whose TSL node graph
is deep and self-referential — it produced `effect_update_depth_exceeded`.

Use `$state.raw` (or a plain `const`) for anything handed to the renderer. Nothing
reads these reactively anyway: they are constructed once and read in the frame loop.

Apply this pre-emptively anywhere a patch swaps a classic material for a node
material. Also: assigning _through_ a proxy signals a state change on every write, so
per-frame writes to a proxied object need a write-once guard.

### 3.3 Diagnosing `effect_update_depth_exceeded`

Svelte's `effect_update_depth_exceeded` carries an **empty stack by design**
(`batch.js` overwrites it), and the "updated at" errors logged alongside are empty
too. Neither identifies the culprit.

What works: temporarily instrument
`node_modules/svelte/src/internal/client/reactivity/batch.js` at the top of
`infinite_loop_guard()` to log `current_batch.current.keys()` (each source's `label`)
and `last_scheduled_effect.fn`. That names the looping sources directly.

Then `rm -rf node_modules/.vite` — Svelte is pre-bundled.

### 3.4 A callback a library invokes from _its_ `$effect` inherits that effect

Svelte tracks every reactive read that happens synchronously while an effect runs — it
does not stop at function boundaries, and it does not care whose function it is. So a
callback you hand to a library becomes part of that library's dependency graph.

Threlte's `<Canvas>` is exactly this shape
(`@threlte/core/dist/webgpu/Canvas.svelte`):

```js
$effect(() => {
	if (!canvas) return;
	const instance = createRenderer ? createRenderer(canvas) : new WebGPURenderer({ canvas });
	instance.init().then(() => {
		if (!disposed) renderer = instance;
	});
	return () => {
		disposed = true;
		renderer = undefined;
	};
});
```

`App.svelte`'s `createRenderer` read `settingsState.graphics.quality` to pick a
`powerPreference`. That one read made the graphics tier a dependency of Threlte's
effect, so **every quality change built and `init()`ed a whole new `WebGPURenderer`** —
and the teardown only disposes an instance whose `init()` had not yet resolved, so the
old device, its swapchain and every resource on it leaked. The second live device
exhausted GPU memory:

```
vkAllocateMemory failed with <Unknown VkResult: -1000072003>
THREE.WebGPURenderer: WebGPU Device Lost
```

The fix is `untrack()` around the read — or, better, not reading it at all, which is
where this one landed: `powerPreference` is now a fixed `'high-performance'`, for a
second and independent reason (§8, "`'low-power'` is not a safe request"). Two things
make this class of bug hard to spot:

- **The symptom names the wrong thing.** It looked like "low quality is broken" purely
  because low is the tier people switch _to_; any change did it. It also looks like a
  memory-size problem, which sends you hunting for the biggest allocation — the
  post-processing render target was a red herring, and removing it changed nothing.
- **The stack lies.** Chromium shows where the `device.lost` promise was _registered_
  (`init`), not where the loss happened.

Generalised rule: **in any callback a library may invoke — `createRenderer`, a factory
prop, a task — either read no reactive state, or read it through `untrack()`.** If the
value genuinely must follow a setting, it needs an explicit rebuild path, not accidental
re-entry through someone else's effect.

---

## 4. The viewport Y-origin trap

**WebGL's `gl.viewport` origin is BOTTOM-left. WebGPU's
`GPURenderPassEncoder.setViewport` origin is TOP-left.** three's WebGPU backend passes
`renderContext.viewportValue` straight through without flipping it.

> **Any viewport maths written against WebGL lands mirrored vertically under
> `WebGPURenderer`.** This is the first thing to suspect for any "it renders in the
> wrong place / renders nothing" report.

Two bugs, one cause, both fixed in `patches/`:

- **Gizmo** — `three-viewport-gizmo`'s `domUpdate()` computes
  `y = clientHeight - (rect.top + rect.height)`. With `placement: 'bottom-left'` it
  drew in the _top_-left, behind the Studio toolbar, so it looked absent. It had been
  rendering correctly the whole time. Fixed by flipping `_viewport[1]` around
  `gizmo.render()` and restoring after (`domUpdate()` recomputes each `update()`).
  Gated on `renderer.isWebGPURenderer`.
- **Default Camera PiP** — rendered at `setViewport(0, 0, w, h)` then read back with
  `drawImage(canvas, 0, (size.y - height) * dpr, …)`, i.e. from the bottom-left. Under
  WebGPU the render lands top-left, so it read a region `autoClear` had just wiped —
  hence _solid black_ rather than merely offset. Fixed with source `y = 0` on WebGPU.

Both live inside `{#if editorCameraEnabled}`, so neither exists until the editor camera
is toggled (`C`).

---

## 5. Debugging harness

Static analysis failed repeatedly on these bugs; running the thing settled them in
minutes.

### 5.1 Headless Firefox with console piped to stdout

No Playwright or Puppeteer needed.

Profile `user.js`:

```
devtools.console.stdout.content=true
browser.cache.disk.enable=false
browser.cache.memory.enable=false
```

```bash
firefox --headless --profile <dir> --new-instance http://localhost:5173/
```

**The cache prefs are essential.** Firefox will otherwise serve a stale Vite bundle and
you will spend an hour debugging code that isn't running.

### 5.2 Read the canvas back — don't trust the console

The WebGPU canvas is configured with `COPY_SRC`, so it can be drawn into a 2D canvas
and `toDataURL`'d. Dump base64 PNGs in ~900-char chunks to `console.log`, reassemble
from stdout, and look at an actual image. That is what revealed the gizmo sitting in
the wrong corner — no console output would ever have shown it.

### 5.3 Read the _served_ bytes, not the source

For anything involving patches or Svelte compilation, `curl` the module from the
running dev server. The compiled output shows exactly which values Svelte proxied and
which props are reactive — evidence, not inference. This is how the `$state`-proxied
`NodeMaterial` was found, and how a suspected-but-innocent gizmo prop was ruled out
(its props compiled to static data properties, so they could not re-trigger anything).

### 5.4 Prove attribution by experiment

Reverting a suspected change in the live package and re-running is worth more than any
amount of reading. It is how the `EditorCamera` loop was pinned on upstream Studio
rather than on the WebGPU work.

### 5.5 Studio persistence keys

To reproduce Studio state headlessly, set localStorage before the app module loads.
Key format is `` `${namespace}/${scope}:${path}` `` with namespace `default` — e.g.
`localStorage['default/editor-camera:enabled'] = 'true'`.

### 5.6 `src/__debug/` — keep the probes

Probes that earned their keep live in `src/__debug/`, armed by uncommenting the single
`import './__debug'` in `main.ts`. Currently:

- **`mrtProbe.ts`** — compares the `@location` outputs a compiled fragment shader
  declares against the attachment count of the context it is drawn into, and names the
  offending material, its nodes, flags and ancestry. This is what identified §1.5 after
  static analysis had produced two confident wrong answers.
- **`ppBridge.ts`** — `pp.on('motionBlur')` / `pp.set(id, key, value)` on the console.
  The only UI for `postprocessingState` is the Studio panel, and Studio is regularly the
  thing you need to run _without_ (§1.6).

Two habits worth keeping. **Measure the invariant the API actually enforces, not your
theory of why it broke** — the first version of `mrtProbe` tracked shader-cache reuse,
matched the §8.7 diagnosis, and stayed silent through a live failure. And **prefer
patching a three/Threlte prototype to editing an engine file**, so removing a probe
cannot leave a plausible-looking hook behind in real code.

---

## 6. pnpm patches

`pnpm patch-commit` leaves the **old** `patch_hash=…` directory behind in
`node_modules/.pnpm/`. Two copies of the package coexist and only one is linked from
`node_modules/<pkg>`. Grepping the wrong one makes a correctly-applied patch look like
it isn't applying.

```bash
readlink -f node_modules/@threlte/studio   # resolve first, then grep
```

Current patches live in `patches/` and cover `@threlte/studio`, `@threlte/extras` and
`three`. Compat belongs there, not in the repo — an earlier `src/extensions/studio-webgpu/`
shim directory was deleted once the underlying faults were patched at source.

Note the `three` entry is registered **unversioned** in `pnpm-workspace.yaml`
(`three: patches/three.patch`), unlike its two pinned neighbours. That is deliberate: on
a three upgrade an unversioned patch that no longer applies is a hard install failure,
whereas a pinned one simply stops being applied and the bug returns silently.

Notable upstream fixes carried in the patches:

- `RenderModes.svelte` monkey-patched `renderer.renderBufferDirect`, a
  WebGLRenderer-only method — `undefined` on `WebGPURenderer`, so `.bind()` threw and
  took down the entire Studio subtree. Replaced with `Material.allowOverride = false`,
  honoured by both renderers since r185. Sync it in a `useTask`, not on mode change:
  helpers mount lazily and would miss the flag.
- `EditorCamera.svelte` had a genuine upstream read/write cycle between
  `defaultCameraObject` and `camera` across two flush phases. Harmless with one camera;
  infinite with two — and there are always two here (Threlte's internal default camera
  plus the app's `makeDefault` one). Fixed by gating the restore on actually being on
  an editor camera.
- `RetroPassNode.js` built its reflection term as `CubeMapNode( texture( envMap ) )` —
  a 2D texture node. `CubeMapNode` only converts _equirectangular_ sources and returns
  anything already cubic verbatim, so a cube `scene.environment` (which is what
  `Sky.svelte`'s bake produces) got bound to a `texture_2d` declaration. Now picks
  `cubeTexture()` for cube sources. See `post-processing.md` §5.2.

---

## 7. Vite configuration

| Setting                                | Reason                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `build.target: 'esnext'`               | WebGPU detection uses top-level `await`                                                                          |
| `optimizeDeps.entries: ['index.html']` | Vite 8's dep scanner otherwise crawls every example HTML file under `DOCS/three.js-dev` looking for entry points |
| `server.fs.deny: ['DOCS/**']`          | `DOCS/` is reference material, never served                                                                      |

Threlte's docs also suggest `optimizeDeps.esbuildOptions.target: 'esnext'`. **Not
needed** — Vite 8 moved dep pre-bundling to Rolldown (deprecating `esbuildOptions`),
and Rolldown's default transform target is already `esnext`.

`typescript` is held at `~6.0.3`. The `latest`-tagged `typescript@7.x` is a native
compiler rewrite that `svelte-check` cannot consume as a drop-in.

---

## 8. Small stuff worth knowing

- **`THREE.AttributeNode: Vertex attribute "position" not found on geometry.`** — a
  `new Mesh()` with `frustumCulled = false` is submitted on the first frame with its
  default empty `BufferGeometry`, before a child geometry attaches. Construct with a
  real geometry.
- **`WebGPUTimestampQueryPool: Maximum number of queries exceeded`** — `stats-gl` sets
  `backend.trackTimestamp = true` but only ever _reads_
  `renderer.info.render.timestamp`; it never resolves the queries, so the pool fills.
  `StatsExtension.svelte` calls `renderer.resolveTimestampsAsync(TimestampQuery.RENDER)`
  once per frame (fire-and-forget, re-entrancy guarded). This also makes the GPU panel
  report real numbers instead of zero.
- **`THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`** —
  a deprecation notice from a dependency. Harmless, unfixed.
- **`forceWebGL` granularity** — never established whether a WebGPU-incompatible
  material forces the whole renderer back to WebGL or fails per-object. It stopped
  mattering once the offending materials were ported, but it is still an open question
  for `Planet.svelte`.
- **`powerPreference: 'low-power'` is not a safe request.** It goes straight to
  `navigator.gpu.requestAdapter()` (`WebGPUBackend.js`), so it can hand you a _different
  adapter_ — and on the integrated path here that device dies during init on a cold load
  with `vkAllocateMemory failed with <Unknown VkResult: -1000072003>`, a code that is not
  a standard `VkResult`. `App.svelte` now always requests `'high-performance'`. The
  graphics tier drives `dpr` and the post-processing bypass in `Renderer.svelte`;
  **adapter selection is not a quality knob**, and a tier that cannot get a working
  device is not a lower-quality experience, it is a broken one.

---

## 9. Migration status

| Area                                      | State                                                  |
| ----------------------------------------- | ------------------------------------------------------ |
| pnpm workspace                            | Done                                                   |
| `WebGPURenderer` + `@threlte/core/webgpu` | Done                                                   |
| Studio compat                             | Done, in `patches/`                                    |
| Viewport Y-origin (gizmo, PiP)            | Done, verified by canvas readback                      |
| Sky → `SkyMesh`                           | Done (`core/skybox/Sky.svelte`)                        |
| Post-processing                           | **Removed.** Rebuild planned — `post-processing.md`    |
| Stars                                     | **Removed.** Needs a TSL point-sprite reimplementation |
| Sky/weather system                        | **Planned** — `weather-system.md`                      |
| `Planet.svelte` terrain shader            | **Not ported.** Still raw GLSL `ShaderMaterial`        |
