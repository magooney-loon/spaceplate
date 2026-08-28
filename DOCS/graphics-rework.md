# Graphics Rework — Post-Processing & Skybox

Plan for fixing and simplifying the post-processing and skybox systems after the
WebGPU migration. Companion to `webgpu-migration-roadmap.md`, which covers the
renderer swap itself.

**Status:** phases 1 and 2 done. Post-processing has since been **removed wholesale**
rather than repaired incrementally — see §8.

---

## 1. Why

Three separate problems, found while debugging the Studio/WebGPU crash.

### 1.1 The render pipeline rebuild loop (bug)

`core/Renderer.svelte` ends with:

```ts
$effect(() => {
    const before = autoRender.current;   // read  — tracked
    autoRender.set(false);               // write — invalidates
    return () => autoRender.set(before); // teardown restores → re-triggers
});
```

Threlte exposes `autoRender` through `runeToCurrentWritable`
(`context/fragments/scheduler.svelte.js:33`), so `.current` is a tracked read and
`.set()` is a reactive write. Reading and writing the same source in one effect,
with a teardown that restores the old value, is a guaranteed self-perpetuating
cycle: teardown sets `true` → effect re-runs → sets `false` → teardown sets
`true`. This terminates only when Svelte throws `effect_update_depth_exceeded`.

**Fix:** `<Canvas>` already accepts `autoRender` as an option
(`CreateSchedulerContextOptions.autoRender`, reachable through
`CreateThrelteContextOptions`). Pass `autoRender={false}` in `App.svelte` and
delete the effect entirely. No shim, no `untrack` — the effect should not exist.

### 1.2 The pipeline rebuilds on every parameter change (design)

The main `$effect` in `core/Renderer.svelte` reads `s` — a `$derived` that in the
common case *is* `postprocessingState` — and then dereferences ~25 effect objects
off it. Every one of those reads becomes a dependency, so changing any single
value (dragging bloom strength) disposes and rebuilds the **entire** TSL node
graph, all 25 effects.

This is why the rebuild log fires repeatedly. It is separate from 1.1 and would
still be wrong after 1.1 is fixed.

**Fix:** split the concerns.

- **Graph shape** depends only on the set of `enabled` flags. Rebuild only when
  that set changes.
- **Parameters** feed TSL `uniform()` nodes. Mutating `someUniform.value` needs no
  rebuild at all.

Practically: derive a structural key from the enabled flags and rebuild against
that; hold uniforms in a map and update them in a separate, cheap effect.

### 1.3 The skybox does not work on WebGPU

- `@threlte/extras` `Stars` builds a raw `ShaderMaterial`
  (`Stars/Stars.svelte:103`).
- `@threlte/extras` `Sky` wraps `three/examples/jsm/objects/Sky.js`, also a
  `ShaderMaterial`.

`NodeLibrary` has no `ShaderMaterial` mapping, so on `WebGPURenderer` both are
silently replaced with a blank `NodeMaterial`. No throw — they just render wrong.

three ships `examples/jsm/objects/SkyMesh.js`, a `NodeMaterial`/TSL sky built for
exactly this case. `Environment` / `CubeEnvironment` set `scene.environment` and
`scene.background` from textures and need no change.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Preset scope | **One live global config.** No named presets, no per-scene assignment, no global/scene merge. |
| Persistence | **Vite dev plugin writes a JSON file** to disk. No copy-paste from Studio. |
| Skybox scope | **`SkyMesh` only.** Stars are dropped for now and come back as a separate task. |
| Studio/WebGPU patches | Keep as-is. Not touched by this rework. |

### What "one live global config" means

The current post-processing and skybox settings *are* the configuration. There is
no library to pick from and nothing to assign per scene. Studio edits the live
state; pressing **Save as default** writes that state to a committed file; the app
loads that file at boot.

This deletes the entire preset/merge/conflict layer, which today serves **zero
actual presets** — all three `bundledPresets.ts` files contain only commented-out
examples.

---

## 3. Target architecture

### 3.1 The config file

One committed file, one shape:

```jsonc
// src/config/graphics.json
{
  "version": 1,
  "postprocessing": { "bloom": { "enabled": true, "strength": 1.2, ... }, ... },
  "skybox":         { "turbidity": 10, "rayleigh": 3, "elevation": 2, ... },
  "environment":    { "mode": "sky", "envTextureId": null, ... }
}
```

- Imported directly (`import graphicsConfig from '$config/graphics.json'`) so it is
  bundled and type-checked, works in prod, and needs no runtime fetch.
- `version` exists so a future format change can migrate rather than crash.
- Committed to git. Diffs are readable; changing a look is a reviewable change.

`localStorage` keeps its current role as a *dev scratchpad* — Studio edits persist
across reloads without touching the repo. The file is only written when you
explicitly hit Save. Boot order: **file → localStorage override (dev only) → live
edits.**

### 3.2 The Vite plugin

A small dev-only plugin, modelled on how Threlte Studio persists scene edits
(`studio/src/lib/vite-plugin/vitePlugin.ts:59` → `utils/fileUtils.ts:writeFile`).
We use a plain HTTP endpoint rather than Studio's RPC channel — fewer moving parts
and it stays independent of Studio's internals.

```ts
// vite/graphicsConfig.ts
export const graphicsConfig = (): Plugin => ({
  name: 'spaceplate:graphics-config',
  apply: 'serve',                       // dev only; never in a prod build
  configureServer(server) {
    server.middlewares.use('/__graphics-config', async (req, res) => {
      if (req.method !== 'POST') return res.end();
      const body = await readBody(req);
      // validate shape + version before touching disk
      writeFileSync(CONFIG_PATH, JSON.stringify(body, null, 2) + '\n');
      res.end('{"ok":true}');
    });
  }
});
```

Client side, one action in the Studio panel:

```ts
await fetch('/__graphics-config', {
  method: 'POST',
  body: JSON.stringify(buildConfigSnapshot())
});
```

Notes:

- `apply: 'serve'` means the endpoint cannot exist in a production build.
- Validate before writing. A malformed POST must not corrupt a committed file.
- Write via a temp file + rename so an interrupted write can't truncate the config.
- Prettier already runs on the repo; emit with a trailing newline and 2-space
  indent so saving doesn't churn the diff.

### 3.3 Post-processing rework

`core/Renderer.svelte` becomes:

```
graphicsConfig.json ──┐
                      ├──► postprocessingState ──► [structural effect] ──► RenderPipeline
localStorage (dev) ───┘            │
                                   └──────────────► [uniform effect] ────► uniform.value
```

- **Structural effect** — depends only on the enabled-flag set (and quality/camera).
  Rebuilds the node graph. Should fire on toggle, not on drag.
- **Uniform effect** — depends on parameter values, writes `uniform.value` in place.
  No disposal, no rebuild.

The 4 effects still unimplemented on WebGPU (`glitch`, `shockWave`, `ascii`,
`tiltShift`) keep their current warn-and-skip behaviour. They are tracked in the
migration roadmap, not here.

### 3.4 Skybox rework

- Replace `<Sky>` with three's `SkyMesh` driven by the same `skyboxState` fields
  (`turbidity`, `rayleigh`, `azimuth`, `elevation`, `mieCoefficient`,
  `mieDirectionalG`). The parameter names map across directly.
- Remove both `<Stars>` layers and the star state they read. Deferred, not deleted
  from history — reintroduced later as a TSL point-sprite field.
- Keep `Environment` / `CubeEnvironment` untouched.
- Drop the preset-resolution `$effect` at `core/Skybox.svelte:15`, which calls
  `skyboxActions.loadUserPreset` from inside an effect. That goes away with presets.

---

## 4. File-by-file impact

### Deleted

| Path | Reason |
|---|---|
| `extensions/postprocessing/bundledPresets.ts` | Preset layer removed (was empty) |
| `extensions/skybox/bundledPresets.ts` | Preset layer removed (was empty) |
| `extensions/scene/bundledPresets.ts` | Per-scene assignment removed (was empty) |
| `extensions/postprocessing/usePostProcessing.ts` | Already unused — zero consumers |

### Changed

| Path | Change |
|---|---|
| `App.svelte` | Add `autoRender={false}` to `<Canvas>`; re-register the two Studio panels |
| `core/Renderer.svelte` | Delete the `autoRender` effect; split structural vs. uniform effects; drop preset merge |
| `core/Skybox.svelte` | `Sky` → `SkyMesh`; remove stars; drop the preset `$effect` |
| `extensions/postprocessing/postprocessing.svelte.ts` | Drop preset actions; load from config file |
| `extensions/skybox/skybox.svelte.ts` | Drop preset actions and star state (888 lines → much smaller) |
| `extensions/scene/scene.svelte.ts` | Remove `resolveScenePreset` / `resolveGlobalPreset` and the localStorage override layer |
| `extensions/*/PostProcessingExtension.svelte`, `SkyboxExtension.svelte` | Remove preset/copy-code UI; add one **Save as default** button |
| `extensions/scene/SceneExtension.svelte` | Remove the preset-assignment and copy-to-clipboard sections |
| `vite.config.ts` | Register the new plugin; add `$config` alias |

### Added

| Path | Purpose |
|---|---|
| `src/config/graphics.json` | The committed config |
| `vite/graphicsConfig.ts` | Dev-only write endpoint |
| `src/extensions/graphics-config/` | Load/snapshot/save helpers shared by both panels |

---

## 5. Phasing

Each phase should leave the app working.

1. **Stop the bleeding.** `autoRender={false}` + delete the offending effect.
   Fixes `effect_update_depth_exceeded` on its own and is independently
   verifiable.
2. **Skybox to `SkyMesh`.** Stars removed. Skybox renders correctly on WebGPU.
3. **Config file + Vite plugin.** Introduce `graphics.json` and the write endpoint;
   wire loading at boot. Presets still present but unused.
4. **Delete the preset layer.** Remove bundled presets, per-scene assignment, merge
   and conflict detection, copy-to-clipboard UI.
5. **Split the PP effects.** Structural vs. uniform. Re-register both Studio panels.

Phases 1 and 2 are the ones that fix visible breakage; 3–5 are simplification and
can land separately.

---

## 6. Risks / to verify

- **Nothing here is browser-verified yet.** Every claim about what renders is
  inferred from reading three/Threlte source. Phases 1 and 2 in particular need a
  real WebGPU browser check.
- `SkyMesh`'s parameter names line up with `Sky`'s, but the *visual output* may not
  match one-for-one. Existing tuned values may need re-tuning.
- Splitting structural and uniform effects assumes every hot parameter can be a
  `uniform()`. Some TSL nodes take plain JS numbers at construction
  (`dotScreen(colorNode, angle, scale)`) and will still need a rebuild — worth
  auditing which are which before committing to the split.
- Writing to source from a dev server is a real filesystem write. Validate,
  write atomically, and keep it strictly `apply: 'serve'`.
- Dropping stars is a visible regression for any scene relying on them. The
  `vacuum` / `night` sky presets in particular assume a star field.

---

## 8. Post-processing removal (supersedes §3.3)

The incremental fixes in §1.2 did not hold: after fixing the `autoRender` loop (§1.1)
and the skybox preset loop, the pipeline still rebuilt continuously. Rather than keep
chasing it, post-processing was removed entirely and will be rebuilt from scratch.

**What was removed**

- `core/Renderer.svelte` is now a stub. The ~300-line TSL `RenderPipeline` covering 25
  effects is gone. It keeps only a quality log; it does not render anything.
- `App.svelte` no longer passes `autoRender={false}` — with no pipeline to drive,
  Threlte's own `autoRenderTask` does the rendering.
- `three/tsl` no longer appears in the production bundle.

**What was deliberately kept**

`src/extensions/postprocessing/` is untouched and unused — state, actions, types and
the Studio panel all still compile. It is the starting point for the rebuild, not
dead weight to delete. Its panel was already unregistered in `App.svelte`, and
`SceneExtension.svelte` still reads `postprocessingPresetsState` for its preset lists,
so removing the module would cascade further than intended.

**Consequences**

- Tone mapping is now owned solely by Threlte's renderer context (AgX by default),
  set through the `<Canvas>` `toneMapping` option. The stub deliberately does not
  write `renderer.toneMapping`: two owners for one property caused earlier bugs.
- The graphics `quality` setting no longer changes anything visually. It still drives
  `dpr` in `App.svelte`.
- Phase 5 (splitting structural vs. uniform effects) is moot — that pipeline no longer
  exists. Whatever replaces it should be designed with §1.2 in mind from the start:
  depend on a primitive key, never on a `$state` object graph.

**Lesson for the rebuild**

Every loop found in this work had the same shape: an `$effect` that read and wrote the
same reactive state, sometimes indirectly through an action several calls deep
(`Skybox.svelte` → `loadUserPreset` → `applyPresetObject` → `transitionState`). When
rebuilding, keep effects depending on primitive values and never call an action that
touches state the effect also reads.

---

## 7. Out of scope

- The 4 unported effects (`glitch`, `shockWave`, `ascii`, `tiltShift`) — see
  `webgpu-migration-roadmap.md`.
- The Studio/WebGPU compat patches (`patches/`).
- Re-implementing stars.
- Any change to the scene state machine beyond removing preset resolution.
