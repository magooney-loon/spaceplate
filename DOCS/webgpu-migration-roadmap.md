# WebGPU Migration Roadmap

Status: **planning — no code changed yet**
Sources consulted: `DOCS/threlte-main` (`apps/docs/src/content/learn/advanced/webgpu.mdx`, `packages/core/src/lib/webgpu/*`, `packages/studio/src`), `DOCS/three.js-dev` (`examples/webgpu_postprocessing_*.html`, `examples/jsm/tsl/display/*`, `src/nodes/display/*`)

## 1. Goal

Move Spaceplate fully onto Three.js's `WebGPURenderer` via Threlte's `@threlte/core/webgpu` entrypoint (auto-falls back to WebGL when WebGPU isn't available), and replace the `postprocessing` npm package with Three.js's native node-based post-processing (`THREE.RenderPipeline` + TSL nodes from `three/tsl` and `three/addons/tsl/display/*`). Also switch the project from npm to pnpm.

## 2. Current state audit

- **Renderer**: `App.svelte` builds a plain `THREE.WebGLRenderer` via `createRenderer` and passes it to `@threlte/core`'s `<Canvas>`. `antialias` is intentionally off in favor of SMAA post-processing.
- **Post-processing**: `src/core/Renderer.svelte` owns a `pmndrs/postprocessing` `EffectComposer` with **25 effects** wired to `extensions/postprocessing/postprocessing.svelte.ts` state (see table in §5). It disables Threlte's `autoRender` and renders the composer itself in a `useTask` after `autoRenderTask`. `src/core/RendererFixExample.svelte` is a smaller, unused reference copy of the same pattern (dead file — candidate for deletion once the new pipeline lands).
- **Custom GLSL**: `src/lib/PlanetDemo/Planet.svelte` uses a hand-written `THREE.ShaderMaterial` (simplex noise, fractal terrain, custom vertex/fragment GLSL). Raw GLSL `ShaderMaterial`/`RawShaderMaterial` **does not run on the WebGPU backend** — only `NodeMaterial`-based materials (built from TSL) do. This is the single largest non-postprocessing porting cost.
- **`@threlte/extras` `<Sky>`**: wraps three.js's classic `examples/jsm/objects/Sky.js`, which is also a raw `ShaderMaterial`. Same problem — needs verification/replacement (three.js ships `SkyMesh.js`, a node-based sky, and a `webgpu_sky.html` example we can port from).
- **Everything else** (`MeshStandardMaterial`/`MeshPhysicalMaterial` usage in `DemoFloor`, `DemoPhysicsBodies`, `GltfViewerInstance`, `Camera`, GLTF loading, `@threlte/rapier` physics, `@threlte/studio` UI) uses stock materials or renderer-agnostic APIs and should port with no/minimal changes — `WebGPURenderer` in modern three.js renders standard materials directly (they're auto-nodified internally).
- **Package manager**: npm only today — `package.json`, `package-lock.json` at root, plus a nested `spacetimedb/package.json` (also npm) referenced from the root `generate` script (`npm install --prefix spacetimedb`). `node_modules`/lockfile at root have already been removed by the user in prep for pnpm.
- **`@threlte/studio` (v0.4.2)**: has zero references to WebGPU/`WebGPURenderer` anywhere in its source. It does *not* instantiate its own renderer — its gizmo/selection-highlight tasks (`DefaultCamera.svelte`, `RenderSelectedObjects.svelte`, `RenderModes.svelte`) just call `renderer.render(...)` against whatever renderer Threlte's context provides, so it's *plausibly* renderer-agnostic — but this is **unverified** and must be spiked early (§7).

## 3. What Threlte's WebGPU support actually gives us

From `packages/core/src/lib/webgpu/index.ts` from the Threlte source and the docs page:

- `@threlte/core/webgpu` is a parallel entrypoint (not a flag) — mirrors `@threlte/core` 1:1, but:
  - Its `<Canvas>` defaults to `WebGPURenderer` and internally `await`s `renderer.init()` before mounting.
  - Its `<T>` resolves component tags against `three/webgpu` instead of `three`, so e.g. `<T.MeshPhysicalNodeMaterial>` works out of the box.
  - `useThrelte`/`useRenderer` are re-exported narrowed to `WebGPURenderer` types.
  - Everything else (`useTask`, `useStage`, `useLoader`, all context helpers) is re-exported unchanged from the regular package — same context system, so `@threlte/studio`, `@threlte/extras`, `@threlte/rapier` (which all just consume Threlte's context, not the `@threlte/core` vs `@threlte/core/webgpu` entrypoint directly) should be unaffected by the swap *in principle*.
- Renderer customization still goes through `createRenderer` on `<Canvas>`, same shape as today, just constructing `new WebGPURenderer({ canvas, antialias, forceWebGL })` from `three/webgpu` instead of `THREE.WebGLRenderer`.
- **Vite**: WebGPU detection uses top-level `await`, which Vite can choke on. Required config:
  ```js
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext' }
  ```
- Three.js ships `RenderPipeline` (`three.webgpu.js`) plus TSL entrypoints (`three/tsl` → `build/three.tsl.js`) and node-based post FX under `three/addons/tsl/display/*` (`examples/jsm/tsl/display/*`, published in the npm package under the `./addons/*` subpath export) — all real, non-dev-only exports, confirmed in three's `package.json` `exports` map (installed `three` in this repo is `^0.183.2`; DOCS checkout is `0.185.0` dev — both post-date TSL/RenderPipeline stabilization).

## 4. New post-processing architecture

Replace `pmndrs/postprocessing`'s `EffectComposer`/`EffectPass` pipeline in `Renderer.svelte` with:

```js
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
// ...

const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode('output'); // exact accessor TBD at implementation time
renderPipeline.outputNode = scenePassColor.add(bloom(scenePassColor));
```

Effects become **composable TSL nodes** combined via node math (`.add`, `.mul`, node `Fn()` blends) instead of an ordered array of `Effect` instances passed to `EffectPass`. This changes the mental model in `postprocessing.svelte.ts`/`Renderer.svelte`: instead of "build a list of Effect instances and hand them to EffectPass", we'll build an `outputNode` graph by folding enabled effects into a chain. The reactive Svelte state shape (one state object + `enabled` flag per effect) can stay conceptually the same; only the construction code changes.

`postprocessing` npm dependency gets removed entirely once parity is reached.

## 5. Effect mapping (pmndrs/postprocessing → WebGPU TSL)

Verified against `DOCS/three.js-dev/examples/jsm/tsl/display/*` and `DOCS/three.js-dev/src/nodes/display/*`. "Core" = ships in `three/tsl` directly; "Addon" = `three/addons/tsl/display/*.js`; "Custom" = no ready-made node, needs a hand-written TSL `Fn()`.

| Current effect | Replacement | Source |
|---|---|---|
| SMAA | `SMAANode.js` | Addon |
| FXAA | `FXAANode.js` | Addon |
| Bloom | `BloomNode.js` | Addon |
| ToneMapping | `renderer.toneMapping` (native property) — not a pass at all anymore | Renderer |
| Vignette | `vignette()` in `CRT.js` | Addon |
| Pixelation | `PixelationPassNode.js` | Addon |
| Noise (grain) | `FilmNode.js` (`film()`) | Addon |
| Chromatic Aberration | `ChromaticAberrationNode.js` | Addon |
| Hue/Saturation | `hue()`, `saturation()` in `ColorAdjustment.js` | Core |
| Brightness/Contrast | Custom `Fn()` (trivial: `color.mul(contrast).add(brightness)`) | Custom |
| Sepia | `Sepia.js` | Addon |
| Dot Screen | `DotScreenNode.js` | Addon |
| Scanline | `scanlines()` in `CRT.js` | Addon |
| Lens Distortion | `barrelUV()`/`barrelMask()` in `CRT.js` (barrel distortion — closest match, verify it covers the existing `distortionX/Y`, `principalPoint`, `focalLength`, `skew` param set or trim state shape) | Addon |
| Color Depth | `posterize()` in `ColorAdjustment.js` | Core |
| Depth of Field | `DepthOfFieldNode.js` | Addon |
| Tilt Shift | `DepthOfFieldNode.js` (parameterized) or custom masked `GaussianBlurNode.js` | Addon |
| God Rays | `GodraysNode.js` | Addon |
| SSAO | `SSAONode.js` (or `GTAONode.js` — evaluate which matches current param set better) | Addon |
| Outline | `OutlineNode.js` | Addon |
| Depth Effect (visualize depth) | `ViewportDepthNode.js`/`ViewportDepthTextureNode.js` | Core |
| Grid | Custom `Fn()` (trivial procedural grid) | Custom |
| Glitch | No ready node — build from `RetroPassNode.js` primitives + custom UV/block distortion | Custom |
| ASCII | No ready node — non-trivial (needs a character-cell sampling/compute step); biggest effect-porting risk, consider deferring or scoping down | Custom |
| Shock Wave | No ready node — custom radial-distortion `Fn()` driven by an elapsed-time uniform, same trigger model as today (`explode()`) | Custom |

**Net effect**: ~19 of 25 effects have a near-direct node replacement; 6 need bespoke TSL (`brightnessContrast`, `grid`, `glitch`, `ascii`, `shockWave`, plus verifying `lensDistortion`/`tiltShift`/`ssao` param parity). ASCII is the one worth explicitly scoping down or dropping if it balloons effort — call this out to the user again once we're mid-implementation.

## 6. File-by-file impact

| File | Change |
|---|---|
| `package.json` | Swap `postprocessing` dep for none (uses three's built-in addons); bump `three`/`@threlte/*` to WebGPU-supporting versions; migrate scripts off `npm`; add `packageManager` field for pnpm |
| `pnpm-lock.yaml`, `.npmrc` | New, generated by `pnpm install` |
| `vite.config.ts` | Add `optimizeDeps.esbuildOptions.target: 'esnext'` and `build.target: 'esnext'` |
| `src/App.svelte` | `import { Canvas } from '@threlte/core/webgpu'`; `createRenderer` builds `WebGPURenderer` from `three/webgpu` instead of `THREE.WebGLRenderer` |
| `src/Scene.svelte`, `src/core/Camera.svelte`, every `T.*` consumer | Swap `import { T } from '@threlte/core'` → `'@threlte/core/webgpu'` (mechanical, repo-wide) |
| `src/core/Renderer.svelte` | Full rewrite: `EffectComposer`/`EffectPass` → `THREE.RenderPipeline` + TSL node graph per §4/§5 |
| `src/core/RendererFixExample.svelte` | Delete (dead reference file, superseded) |
| `extensions/postprocessing/postprocessing.svelte.ts`, `types.ts`, `bundledPresets.ts` | Effect state shape updated per §5 mapping; presets stay conceptually the same (per-effect settings + `enabled`), some param sets will shrink/change (e.g. lens distortion, SSAO/GTAO) |
| `extensions/postprocessing/PostProcessingExtension.svelte` | Studio UI controls follow whatever param set survives the mapping in §5 |
| `src/core/Skybox.svelte`, `@threlte/extras` `<Sky>` | Spike required — verify `<Sky>` (raw `ShaderMaterial`) renders under `WebGPURenderer`; if not, port to three's `SkyMesh.js`/`webgpu_sky.html` node-based sky, or keep the Sky's material forced onto the WebGL fallback path if `forceWebGL`-per-object isn't feasible |
| `src/lib/PlanetDemo/Planet.svelte` | Rewrite the simplex/fractal terrain `ShaderMaterial` as TSL (`Fn()`, node math) targeting `MeshStandardNodeMaterial`/`NodeMaterial`. This is the largest single porting task in the whole migration — budget it as its own phase |
| `src/extensions/gltf-viewer/*`, `src/scenes/**` | Expected no-op or near no-op — confirm after the mechanical `T` import swap |
| `README.md`, `CLAUDE.md` | Update install/dev commands from `npm` to `pnpm`; document the WebGPU renderer + new postprocessing system once implemented |
| `.gitignore` | Add an exception so this roadmap doc (and any future `DOCS/*.md` we intentionally keep) survives the blanket `/DOCS` ignore rule — vendor source under `DOCS/three.js-dev` and `DOCS/threlte-main` stays ignored |

## 7. Risks / unknowns to spike before committing to the full rewrite

1. **`@threlte/studio` × `WebGPURenderer`** — untested combination per its source (§2). Spike: boot the existing DemoScene with `@threlte/core/webgpu`'s `<Canvas>` and Studio attached, confirm gizmos/selection/toolbar still render correctly.
2. **`<Sky>` from `@threlte/extras`** — raw-GLSL `ShaderMaterial`, likely broken under native WebGPU. Spike: render it under WebGPU and observe (three.js's `WebGPURenderer` may throw, render black, or silently fall back — need to know which).
3. **`forceWebGL` fallback granularity** — WebGPU-incompatible materials (Planet's shader, possibly Sky) may force the *entire* renderer back to WebGL rather than falling back per-object, which would partially defeat the migration until those materials are ported. Confirm three.js's actual fallback behavior (whole-renderer vs per-material) before deciding whether Planet/Sky porting is a hard prerequisite or can trail behind.
4. **ASCII / Glitch / Shock Wave** custom TSL cost — prototype these first since they're the highest-uncertainty, most bespoke pieces; descope early if too expensive.
5. **`@threlte/rapier` / physics** — expected unaffected (renderer-agnostic), but confirm no `@threlte/rapier` internals assume `THREE.WebGLRenderer` specifically.

## 8. Proposed phasing

1. **Spike phase** — answer §7 risks 1–3 with throwaway code on a branch; no production rewrite yet. Go/no-go checkpoint with the user afterward, especially if Studio or `<Sky>` turn out broken.
2. **pnpm migration** — mechanical, independent of WebGPU work; can land first/separately. Swap lockfiles, update scripts/docs, verify `spacetimedb` nested install path still works under pnpm workspaces (or keep it npm-invoked via `--prefix` if simpler).
3. **Core renderer swap** — `@threlte/core` → `@threlte/core/webgpu` across all `T`/`useThrelte` imports, `Canvas`/`createRenderer` in `App.svelte`, vite config changes. Ship with post-processing *temporarily disabled* (or left on old `postprocessing` package running against the WebGL fallback path) so this lands independently and stays testable.
4. **Post-processing rewrite** — `Renderer.svelte` + `postprocessing.svelte.ts`/`types.ts`/`bundledPresets.ts` + `PostProcessingExtension.svelte`, effect by effect per §5, roughly in order: renderer-native tone mapping → high-confidence Addon nodes (SMAA/FXAA/Bloom/DoF/SSAO/Outline/GodRays/Sepia/DotScreen/Pixelation/ChromaticAberration/Film) → Core color nodes (hue/saturation/posterize) → custom `Fn()` effects (vignette/scanline/lens-distortion reuse CRT.js primitives; brightness-contrast/grid are trivial) → bespoke high-risk effects (glitch/ASCII/shockwave), descoping ASCII if needed. Remove `postprocessing` npm dependency once nothing references it.
5. **Custom shader ports** — `<Sky>` replacement (if spike says it's needed) and `Planet.svelte`'s terrain shader → TSL `NodeMaterial`. Treat as its own milestone given the size of that shader.
6. **Cleanup** — delete `RendererFixExample.svelte`, update `README.md`/`CLAUDE.md`, final pass over bundled presets to make sure saved preset JSON shapes match the new effect param sets (old localStorage presets referencing removed/renamed params should degrade gracefully, not crash).

## 9. Explicitly out of scope for this roadmap

- Any change to the SpacetimeDB backend/client bindings.
- Any change to the input/scene/sound/settings extensions beyond the mechanical `@threlte/core` → `@threlte/core/webgpu` import swap.
