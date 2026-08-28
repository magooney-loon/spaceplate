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

| Source | Fix |
|---|---|
| `@threlte/extras` `<Sky>` (wraps `examples/jsm/objects/Sky.js`) | Replaced with three's `SkyMesh` (TSL/NodeMaterial port of the same Preetham model) — now `src/core/Sky.svelte` |
| `@threlte/extras` `<Stars>` | Dropped. Needs reimplementing as TSL point sprites |
| Studio's `AxesHelper` → `Line2`/`LineMaterial` | `three/examples/jsm/lines/webgpu/Line2.js` + `Line2NodeMaterial`. `LineGeometry` is backend-agnostic. **Do not set `blending`** on it — it forces `NoBlending` deliberately, compositing transparency inside the node graph against `viewportOpaqueMipTexture()` |
| `three-viewport-gizmo` (vendors its own `LineMaterial`) | No WebGPU build exists; axis stems disabled via the library's per-axis `line: false` option |

Mixing `import 'three'` and `import 'three/webgpu'` is safe for **math and value
types** (`Color`, `Vector3`, `Quaternion`, `Euler`, geometry/material *types*) —
three's renderer dispatches on `isMesh`/`isLight`-style boolean flags, not
`instanceof`. Only actual node-material *construction* needs `three/webgpu`.

Still unported: `src/lib/PlanetDemo/Planet.svelte`'s hand-written simplex/fractal
terrain `ShaderMaterial`. It needs a TSL rewrite and is the largest remaining port.

---

## 2. Studio task ordering

Threlte schedules render work through a DAG (Kahn's topological sort, FIFO). For tasks
at the same constraint level, **registration order decides execution order**.

| Task | Owner | Constraint |
|---|---|---|
| DefaultCamera PiP render | `@threlte/studio` | `before: autoRenderTask` |
| Selection texture pre-render | `@threlte/studio` | `before: autoRenderTask` |
| `autoRenderTask` | Threlte core | — (stopped when `autoRender = false`) |
| Gizmo render | `@threlte/extras` | `after: autoRenderTask` |

**The rules any custom render pipeline must follow:**

| Rule | Reason |
|---|---|
| Register with `{ after: autoRenderTask, autoInvalidate: false }` | Structurally guaranteed to run after DefaultCamera and RenderSelectedObjects **regardless of re-registration**. Studio's DefaultCamera unmounts and remounts when the editor camera is toggled; any `before: autoRenderTask` approach loses the race on remount |
| Place `<Renderer />` **first** inside `<Canvas>` | Among `after: autoRenderTask` tasks, insertion order decides. Registering first means the pipeline draws before the Gizmo, so the Gizmo composites on top |
| Never use a bare `{ stage: renderStage }` | That makes the task *isolated* in the DAG, and isolated tasks run after all connected ones — including the Gizmo, which then gets overwritten |
| Set the camera reactively | Studio switches between editor and game camera; the pass must follow |

Resulting stable order:

1. DefaultCamera PiP → copies to its HTML canvas
2. RenderSelectedObjects → populates the selection render target
3. *(autoRenderTask — stopped)*
4. **Our pipeline** — samples a fresh selection target
5. Gizmo — draws on top

> **Superseded advice:** the old `RendererWebGlStudioIssue.md` also said to disable
> `autoRender` from inside an `$effect` rather than via the `<Canvas>` prop. **That is
> wrong** — see §3.1. Use the `<Canvas autoRender={false}>` option.

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
    const before = autoRender.current;   // tracked read
    autoRender.set(false);               // reactive write
    return () => autoRender.set(before); // teardown → re-triggers
});
```

Threlte exposes `autoRender` through `runeToCurrentWritable`, so `.current` is a
tracked read and `.set()` is a reactive write. The fix is to not have the effect at
all: `<Canvas autoRender={false}>` accepts it as an option.

The indirect version is harder to spot. `Skybox.svelte` called
`skyboxActions.loadUserPreset()` from an effect → `applyPresetObject()` →
which *read* `transitionState.transitionDuration` and *wrote*
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
material. Also: assigning *through* a proxy signals a state change on every write, so
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
  drew in the *top*-left, behind the Studio toolbar, so it looked absent. It had been
  rendering correctly the whole time. Fixed by flipping `_viewport[1]` around
  `gizmo.render()` and restoring after (`domUpdate()` recomputes each `update()`).
  Gated on `renderer.isWebGPURenderer`.
- **Default Camera PiP** — rendered at `setViewport(0, 0, w, h)` then read back with
  `drawImage(canvas, 0, (size.y - height) * dpr, …)`, i.e. from the bottom-left. Under
  WebGPU the render lands top-left, so it read a region `autoClear` had just wiped —
  hence *solid black* rather than merely offset. Fixed with source `y = 0` on WebGPU.

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

### 5.3 Read the *served* bytes, not the source

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

---

## 6. pnpm patches

`pnpm patch-commit` leaves the **old** `patch_hash=…` directory behind in
`node_modules/.pnpm/`. Two copies of the package coexist and only one is linked from
`node_modules/<pkg>`. Grepping the wrong one makes a correctly-applied patch look like
it isn't applying.

```bash
readlink -f node_modules/@threlte/studio   # resolve first, then grep
```

Current patches live in `patches/` and cover `@threlte/studio` and `@threlte/extras`.
Compat belongs there, not in the repo — an earlier `src/extensions/studio-webgpu/`
shim directory was deleted once the underlying faults were patched at source.

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

---

## 7. Vite configuration

| Setting | Reason |
|---|---|
| `build.target: 'esnext'` | WebGPU detection uses top-level `await` |
| `optimizeDeps.entries: ['index.html']` | Vite 8's dep scanner otherwise crawls every example HTML file under `DOCS/three.js-dev` looking for entry points |
| `server.fs.deny: ['DOCS/**']` | `DOCS/` is reference material, never served |

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
  `backend.trackTimestamp = true` but only ever *reads*
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

---

## 9. Migration status

| Area | State |
|---|---|
| pnpm workspace | Done |
| `WebGPURenderer` + `@threlte/core/webgpu` | Done |
| Studio compat | Done, in `patches/` |
| Viewport Y-origin (gizmo, PiP) | Done, verified by canvas readback |
| Sky → `SkyMesh` | Done (`src/core/Sky.svelte`) |
| Post-processing | **Removed.** Rebuild planned — `post-processing.md` |
| Stars | **Removed.** Needs a TSL point-sprite reimplementation |
| Sky/weather system | **Planned** — `weather-system.md` |
| `Planet.svelte` terrain shader | **Not ported.** Still raw GLSL `ShaderMaterial` |
