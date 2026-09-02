# Post-Processing (`postprocessing/`)

## Files

```
types.ts                    — EffectId + PostProcessingState, assembled from the effect modules' param types
postprocessing.svelte.ts    — postprocessingState ($state) + postprocessingActions (setEnabled/resetEffect/resetAll)
PostProcessingExtension.svelte — Studio toolbar panel, rendered FROM the registry
index.ts                    — barrel re-exports
```

The engine side lives in **`src/core/postprocessing/`** (registry, builder, uniform
bag, one module per effect) — see `DOCS/post-processing.md`. This extension is only
the state + Studio panel; the pipeline itself never imports from here except the
state (via Renderer.svelte).

## Effects (registry-driven)

Ten effects. Base passes (mutually exclusive): `ssaa`, `retro` — else the default
`pass()`. Chain: `dof`, `motionBlur`, `bloom`, `afterimage`, `vignette`. Grade
(**not** exclusive): `lut`. Anti-aliasing (mutually exclusive): `smaa`, `fxaa`.

`pixelation`, `ao`, `ssgi`, `ssr` and `traa` were **removed** — files deleted, not
disabled. Don't re-add one by half-measures: `DOCS/post-processing.md` records what
each needed and what the removal took out with it (the `normal`/`metalrough`/`diffuse`
MRT rows and the matching `BuildContext` fields).

- Every effect: `{ enabled: boolean } & params` — defaults come from the registry
  (`def.params()`), so state, builder and panel cannot drift.
- Quality `low` drops everything (bare pass). `minQuality` still exists on `EffectDef`
  but no effect uses it now — `ssgi`/`ssr` were its only consumers.
- Geometry consumers (`dof`, `motionBlur`) are auto-dropped under a non-default base
  pass — the panel shows the reason.
- `motionBlur` is the **only** MRT consumer left (`velocity`). That keeps the
  shader-cache isolation in `build.ts` load-bearing — see `post-processing.md` §8.7
  before touching it.
- Param drags are **hot** (uniform writes, no rebuild) except structural params
  (`motionBlur.numSamples`, `lut.lut`, `bloom.lensflare`, `bloom.ghostSamples`)
  which rebuild the graph.
- `bloom` carries a **lensflare sub-toggle** (a param, not a sibling effect —
  `LensflareNode` samples the bloom buffer, so no bloom means no flare). The flare
  runs through `gaussianBlur` to smooth the ¼-res ghosts; its intermediate nodes
  are registered via `ctx.track()` so a rebuild disposes their render targets.
- `lut` and `fxaa` declare `displayColor`: the **builder** turns off
  `outputColorTransform` and folds in one `renderOutput()` for whoever asks. An effect
  must never do this itself — with two of them you would tone-map twice.
- Params with `def.options` (the LUT choice, the bloom lensflare on/off) render as a
  `List`, not a `Slider`.

## Key behavior

- `setEnabled(id, on)` implements radio behaviour for base/resolve roles (enabling
  one disables siblings). `resolveEnabledSet` (registry) is still the authority —
  the builder drops illegal survivors with a logged reason.
- No presets, no localStorage — removed with the pmndrs-era panel.
- The panel shows the live pipeline summary (quality · base · MRT set) and greys
  suppressed effects with an explanation.
