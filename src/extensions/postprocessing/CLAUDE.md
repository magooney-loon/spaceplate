# Post-Processing (`postprocessing/`)

## Files

```
types.ts                    — EffectId + PostProcessingState, assembled from the effect modules' param types
postprocessing.svelte.ts    — postprocessingState ($state) + postprocessingActions (setEnabled/setParam/resetEffect/resetAll)
PostProcessingExtension.svelte — Studio toolbar panel, rendered FROM the registry
index.ts                    — barrel re-exports
```

## The panel is two columns, and the layout is CSS over tweakpane's DOM

`Effects` is the right-hand column; `Base Pass`, `Weather`, `Grade` and `Anti-Aliasing`
stack in the left one. **`Weather` is a panel grouping, not a role** — `fogScatter`,
`rainLens` and `snowLens` are ordinary chain effects to the builder, but their `enabled`
flag means "let the weather decide" and their params shape something invisible until it
rains, so among bloom and vignette they read as dead controls.

The columns are a CSS grid over the pane's blade container, not markup, and that is
forced rather than chosen: a `Folder` or `Slider` attaches itself to the pane through
Svelte context and its DOM lands wherever tweakpane puts it, so **wrapping the components
in elements moves nothing**. Two consequences to respect when editing the panel:

- **The right-hand section must be authored LAST** — the CSS addresses it as
  `:last-child`. `SECTIONS` says so, and the Reset All footer is rendered just before it
  for that reason.
- **Raw HTML inside a `Folder` never renders.** svelte-tweakpane-ui puts a folder's
  children in a `display: none` div (they exist only so it can compute a blade index), so
  the per-effect `note` and suppression spans the panel used to carry were invisible from
  the day they were added. They are gone; the `(off)` suffix on a suppressed effect's
  title is what remains, and `def.note` currently has no reader. Putting it back means a
  real tweakpane blade, not a `<span>`.

The engine side lives in **`src/core/postprocessing/`** (registry, builder, uniform
bag, one module per effect) — see its `CLAUDE.md` for the architecture and the
browser-verified gotchas. This extension is only the state + Studio panel; the
pipeline itself never imports from here except the state (via Renderer.svelte).

## Effects (registry-driven)

Base passes (mutually exclusive): `ssaa`, `retro` — else the default `pass()`. Chain:
`ao`, `dof`, `fogScatter`, `motionBlur`, `rainLens`, `snowLens`, `bloom`, `afterimage`,
`vignette`, `sceneTransition`. Grade (**not** exclusive): `lut`. Anti-aliasing (mutually
exclusive): `smaa`, `fxaa`.

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
  `bloom.ghostSamples`, `ao.aoBufferScale`) which rebuild the graph — `bloom.mode`
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
- `fogScatter` is DEFAULT-ENABLED and costs nothing until it is foggy: `SkyFog`'s task
  drives it from the weather `fog` channel and flips a structural latch
  (`$core/skybox/fogScatter.svelte.ts`) that keeps it out of the graph below a low
  threshold, hysteresis and all. "Enabled" here means "let the weather decide"; the
  params only shape what it does once the weather has.
- `sceneTransition` is the scene switch's cover, and it is DEFAULT-ENABLED at mix 0 for
  the afterimage's reason (a latch would rebuild the graph exactly when a transition
  starts). Its params are the LOOK of every scene switch in the app — pattern (fade /
  wipe / radial / dissolve, structural), `softness`, `angle`, `scale`, then `push`,
  `blur` and `desaturate` — the motion the frozen frame carries while it covers, which is
  what stops a long load reading as a hang — and `revealSeconds`, the only one that is
  not a shader value: the driver reads it from this state. Tune it here and every
  `goTo*` picks it up. Engine side and the
  frozen-frame design: `$core/postprocessing/CLAUDE.md`.
- `afterimage` is the one effect that is DEFAULT-ENABLED with a zero look: `damp`
  defaults 0 (a passthrough — the node trails only bright pixels), and runtime
  drivers add a boost on top inside the shader (`uAfterimageBoost`; TestGame's
  nitrous is the writer, via `NitrousAfterimage.svelte`). The panel `damp` is the
  standing floor — see "Runtime-modulated effects" in
  `$core/postprocessing/CLAUDE.md` for why it deliberately has no activity latch.
- Params with `def.options` (the LUT choice, the bloom mode/lensflare) render as a
  `List`, not a `Slider`, and are written through `setParam` rather than `bind:` — that
  is the hook `def.paramDefaults` uses to re-seed siblings on a choice change. Sliders
  stay bound straight to the state (drags must not go through an action per frame).

## Key behavior

- `setEnabled(id, on)` implements radio behaviour for base/resolve roles (enabling
  one disables siblings). `resolveEnabledSet` (registry) is still the authority —
  the builder drops illegal survivors with a logged reason.
- No presets, no localStorage — removed with the pmndrs-era panel.
- The panel shows the live pipeline summary (quality · base · MRT set) above the pane,
  and marks a suppressed effect `(off)` in its folder title. The REASON is computed
  (`suppression()`, straight from `resolveEnabledSet`) but has nowhere to render — see
  the note about folder children above.
