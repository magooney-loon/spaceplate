# Post-Processing (`postprocessing/`)

## Files

```
types.ts                    — EffectId + PostProcessingState, assembled from the effect modules' param types
postprocessing.svelte.ts    — postprocessingState ($state) + postprocessingActions (setEnabled/setParam/resetEffect/resetAll)
PostProcessingExtension.svelte — Studio toolbar panel, rendered FROM the registry
index.ts                    — barrel re-exports
```

The engine side lives in **`src/core/postprocessing/`** (registry, builder, uniform
bag, one module per effect) — see its `CLAUDE.md` for the architecture and the
browser-verified gotchas. This extension is only the state + Studio panel; the
pipeline itself never imports from here except the state (via Renderer.svelte).

## Effects (registry-driven)

Eleven effects. Base passes (mutually exclusive): `ssaa`, `retro` — else the default
`pass()`. Chain: `ao`, `dof`, `motionBlur`, `bloom`, `afterimage`, `vignette`. Grade
(**not** exclusive): `lut`. Anti-aliasing (mutually exclusive): `smaa`, `fxaa`.

`pixelation`, `ssgi`, `ssr` and `traa` were **removed** — files deleted, not
disabled. Don't re-add one by half-measures: `$core/postprocessing/CLAUDE.md`
records what each needed and what the removal took out with it (the
`metalrough`/`diffuse` MRT rows and the matching `BuildContext` fields).

`ao` was **revived** and brought the `normal` MRT row back with it. It is the only
effect that exists to fix a lighting error rather than to add a look: nothing else
occludes `scene.environment` or `SkyLight`'s hemisphere fill, so without it a closed
model is lit from the inside by the whole sky. Off by default — read its section in
`$core/postprocessing/CLAUDE.md` before retuning it.

- Every effect: `{ enabled: boolean } & params` — defaults come from the registry
  (`def.params()`), so state, builder and panel cannot drift.
- Quality `low` drops everything (bare pass). `minQuality` still exists on `EffectDef`
  but no effect uses it now — `ssgi`/`ssr` were its only consumers.
- Geometry consumers (`ao`, `dof`, `motionBlur`, and `bloom` in Material mode) are
  auto-dropped under a non-default base pass — the panel shows the reason.
- `motionBlur` (`velocity`), `ao` (`normal`) and `bloom` Material mode (`emissive`) are
  the MRT consumers. That keeps the shader-cache isolation in `build.ts` load-bearing —
  see the MRT shader-cache trap in `$core/postprocessing/CLAUDE.md` before touching it.
  It also means `ao` and `motionBlur` share an exposure: non-`output` attachments do not
  blend, so the lens layers' screen-filling quads overwrite both buffers in heavy
  weather.
- Param drags are **hot** (uniform writes, no rebuild) except structural params
  (`motionBlur.numSamples`, `lut.lut`, `bloom.mode`, `bloom.lensflare`,
  `bloom.ghostSamples`, `ao.resolutionScale`) which rebuild the graph — `bloom.mode`
  because it changes the MRT set, not just the graph.
- `bloom` has a **mode** toggle: Global (colour buffer) vs Material (`emissive`
  attachment — selective emissive bloom, `requiresValues` on the def). It also
  carries a **lensflare sub-toggle** (a param, not a sibling effect — `LensflareNode`
  samples the bloom buffer, so no bloom means no flare). The flare runs through
  `gaussianBlur` to smooth the ¼-res ghosts; its intermediate nodes are registered
  via `ctx.track()` so a rebuild disposes their render targets. `inputClamp` caps the
  linear value bloom is allowed to _sample_ (not the image) — without it the sky's sun
  disc, 60800 linear in `SkyMesh.js`, gets mipped across the entire frame and washes out
  every daylit scene; `threshold` cannot fence that off, since the disc clears any
  threshold. Switching the mode
  re-seeds strength/radius/threshold from bloom's `MODE_DEFAULTS` (Global 0.1/1/0.22,
  Material 0.35/0.6/0) — the two modes read different inputs, so neither mode's tuning
  means anything in the other.
- `lut` and `fxaa` declare `displayColor`: the **builder** turns off
  `outputColorTransform` and folds in one `renderOutput()` for whoever asks. An effect
  must never do this itself — with two of them you would tone-map twice.
- Params with `def.options` (the LUT choice, the bloom mode/lensflare) render as a
  `List`, not a `Slider`, and are written through `setParam` rather than `bind:` — that
  is the hook `def.paramDefaults` uses to re-seed siblings on a choice change. Sliders
  stay bound straight to the state (drags must not go through an action per frame).

## Key behavior

- `setEnabled(id, on)` implements radio behaviour for base/resolve roles (enabling
  one disables siblings). `resolveEnabledSet` (registry) is still the authority —
  the builder drops illegal survivors with a logged reason.
- No presets, no localStorage — removed with the pmndrs-era panel.
- The panel shows the live pipeline summary (quality · base · MRT set) and greys
  suppressed effects with an explanation.
