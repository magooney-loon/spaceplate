# Post-Processing (`postprocessing/`)

## Files

```
types.ts                    — EffectId + PostProcessingState, DERIVED from $core/postprocessing's
                              EFFECT_REGISTRY (adding an effect needs no edit here)
postprocessing.svelte.ts    — postprocessingState ($state) + postprocessingActions (setEnabled/setParam/resetEffect/resetAll)
PostProcessingExtension.svelte — Studio toolbar panel, rendered FROM the registry
index.ts                    — barrel re-exports
```

## The panel is two columns, and the layout is CSS over tweakpane's DOM

`Effects` is the right-hand column; `Base Pass`, `Weather`, `Grade` and `Anti-Aliasing`
stack in the left one. **`Weather` is a panel grouping, not a role** — `fogScatter`,
`godrays`, `rainLens` and `snowLens` are ordinary chain effects to the builder, but their
`enabled` flag means "let the sky decide" and their params shape something invisible until
it rains (or hazes over), so among bloom and vignette they read as dead controls.

The columns are a CSS grid over the pane's blade container, not markup, and that is
forced rather than chosen: a `Folder` or `Slider` attaches itself to the pane through
Svelte context and its DOM lands wherever tweakpane puts it, so **wrapping the components
in elements moves nothing**. Two consequences to respect when editing the panel:

- **The right-hand section must be authored LAST** — the CSS addresses it as
  `:last-child`. `SECTIONS` says so, and the Reset All footer is rendered just before it
  for that reason.
- **Raw HTML inside a `Folder` never renders.** svelte-tweakpane-ui puts a folder's
  children in a `display: none` div (they exist only so it can compute a blade index) —
  a per-effect `note` or suppression marker placed here is invisible on arrival. The
  `(off)` suffix on a suppressed effect's title is the visible carrier, and `def.note`
  currently has no reader. A real per-effect label means a real tweakpane blade, not a
  `<span>`.

The engine side lives in **`src/core/postprocessing/`** (registry, builder, uniform
bag, one module per effect) — see its `CLAUDE.md` for the architecture and the
browser-verified gotchas. This extension is only the state + Studio panel; the
pipeline itself never imports from here except the state (via Renderer.svelte).

## Effects (registry-driven)

Base passes (mutually exclusive): `ssaa`, `retro` — else the default `pass()`. Chain:
`ao`, `dof`, `fogScatter`, `godrays`, `motionBlur`, `rainLens`, `snowLens`, `speedLines`,
`bloom`, `anamorphic`, `afterimage`, `vignette`, `sceneTransition`. Grade (**not**
exclusive): `lut`. AA (mutually exclusive): `smaa`, `fxaa`.

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
  (`def.params()`) and so does the TYPE (`EffectParamMap`), so state, builder and panel
  cannot drift. They did, while `types.ts` hand-listed the param shapes: `ao`, `rainLens`
  and `snowLens` all shipped without reaching `EffectId`, and nothing caught it because
  every access to the state goes through an `as any`.
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
- `godrays` carries the same latch and is the most expensive effect in the registry — a
  half-res raymarch of the sun's shadow cascades, a bilateral blur and a depth-aware
  upsample. `SkyLight`'s task drives it from the haze and the key's elevation, so it is out
  of the graph entirely in clear air and at night. **But it is OFF by default**, which
  `fogScatter` is not, and the difference is not cost: the composite ADDS the key light's
  radiance to every pixel with lit air in front of it, so the whole frame brightens and
  desaturates whenever the sky asks for shafts. That is a look a game opts into — `ao`'s
  call, for `ao`'s reason. `Density` decides whether the ray buffer reads as occlusion or
  as depth (it wants to be high); `Max Density` is the gain, against a key intensity of
  ~4.75, so it wants to be small; `Resolution Scale` is the cost lever. It needs a patched
  `three` — see `$core/postprocessing/CLAUDE.md`.
- `sceneTransition` is the scene switch's cover, and it is DEFAULT-ENABLED at mix 0 for
  the afterimage's reason (a latch would rebuild the graph exactly when a transition
  starts). Its params are the LOOK of every scene switch in the app. Shape: pattern
  (fade / wipe / radial / dissolve, structural), `softness`, `angle`, `scale`. Plate
  degradation across the dip: `push`, `blur`, `desaturate`. Timing: `veilSeconds` (the
  dip), `minCoverSeconds` (floor on the whole cover, so a cached re-entry does not
  strobe the loading UI) and `revealSeconds`. **The three timings are not shader
  values** — the driver reads them from this state and their uniforms in the bag go
  unused, which is the price of keeping every knob in one place. Tune here and every
  `goTo*` picks it up. Engine side, and why the cover is three phases with a loading
  screen in the middle: `$core/postprocessing/CLAUDE.md`.
- `afterimage` is the one effect that is DEFAULT-ENABLED with a zero look: `damp`
  defaults 0 (a passthrough — the node trails only bright pixels), and runtime
  drivers add a boost on top inside the shader (`uAfterimageBoost`; TestGame's
  nitrous flow AND road speed are both writers into it, via `CarAfterimage.svelte`).
  The panel `damp` is the standing floor — see "Runtime-modulated effects" in
  `$core/postprocessing/CLAUDE.md` for why it deliberately has no activity latch.
- `speedLines` is DEFAULT-ENABLED at `intensity` 0 — the periphery-pulling "tunnel
  wind" effect, driven at runtime by TestGame's own forward acceleration
  (`uSpeedLinesBoost`; TestGame's `fx/SpeedLines.svelte` is the writer). Same
  no-latch reasoning as `afterimage`: it adds onto the panel floor inside the
  shader, and driving is continuous enough that a latch would rebuild the graph
  constantly. `innerRadius` is how much of the middle of the frame stays clean;
  `reach` is how far the periphery pulls at full boost.
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
