# Post-Processing Effects (`postprocessing/`)

## Files

```
types.ts                    — 25+ effect state types, PostProcessingState, PostProcessingPreset
postprocessing.svelte.ts    — $state, postprocessingPresetsState, postprocessingActions
usePostProcessing.ts        — Studio-aware hook (path import)
bundledPresets.ts           — BUNDLED_PP_PRESETS (currently empty placeholder)
PostProcessingExtension.svelte — Studio toolbar panel (571 lines)
index.ts                    — barrel re-exports
```

**Currently unused at runtime.** Kept as the starting point for a rebuild planned in `DOCS/post-processing.md`. Its Studio panel is unregistered in `App.svelte`.

## Effects (25+)

Bloom, SMAA, FXAA, Vignette, Pixelation, Glitch, Noise, Chromatic Aberration, Brightness/Contrast, Hue/Saturation, Sepia, Dot Screen, Scanline, Shockwave, ASCII, Tone Mapping, Grid, Tilt Shift, Lens Distortion, Color Depth, Depth of Field, God Rays, SSAO, Outline, Depth Effect.

Each effect has `enabled: boolean` plus its own parameters.

## Preset system

- `postprocessingPresetsState`: merged bundled + localStorage presets.
- Actions: `savePreset(name)`, `loadPreset(presetId)`, `deletePreset(presetId)`, `renamePreset(presetId, newName)`, `updatePreset(presetId)`.
- Bundled presets cannot be deleted or updated.
- localStorage key: `spaceplate-postprocessing-presets`.

## Key behavior

- `loadPresets()` merges bundled first, then localStorage (localStorage wins on id conflict).
- `savePresets()` filters out bundled presets before writing to localStorage.
- `deletePreset` disables all effects if the deleted preset was the current one.
- `foldersKey` forces full remount of all effect folders when a preset is loaded (to reset `bind:value` state).
- Effects marked "not yet wired" in UI: Glitch, Shockwave, ASCII, TiltShift.
- `resetAll()` resets all 25 effects to defaults; `resetEffect(effectName)` resets one but preserves `enabled`.
