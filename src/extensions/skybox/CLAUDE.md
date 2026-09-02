# Sky/Weather/Environment (`skybox/`)

## Files

```
SkyboxExtension.svelte — Studio toolbar panel (panel-only, no barrel)
```

This is a **panel-only** extension with no barrel. The state it drives lives in `core/skybox/` (sky model, environment state).

## Panel sections

### Mode
Three buttons: Procedural Sky, HDR/EXR Environment, Cube Map. Calls `environmentActions.setMode(...)`.

### Time (sky mode only)
- Clock readout (HH:MM + day number), sky readout (phase + sun elevation).
- Scrub slider (0..1, step 1/1440 = per-minute granularity). Uses `e.detail.origin === 'internal'` guard to prevent feedback loops.
- Speed list: Frozen, Realtime, 60x, 240x, 720x.
- Time-jump `ButtonGrid`, 2 columns, built from `DEFAULT_DAY_CURVE` — one button per
  keyframe (Midnight → Astro Dusk), so retiming or adding a keyframe updates the panel
  for free. `PHASE_LABELS` only supplies display names; an unlisted keyframe falls back
  to its raw name.
- `scrubTime(t)` always switches to manual clock first.
- `setSpeed(value)` creates a realtime clock or sets time scale.

### Weather (sky mode only)
- Blend duration slider (0–60s, default 20).
- Named weather `ButtonGrid`, 2 columns, from `WEATHERS` keys — labelled with the exact
  string `setWeather` takes. Calls `skyActions.setWeather(name, { over: blendSeconds * 1000 })`.
  No ✓ on the active one: the "Active" monitor covers that, and reactive labels would
  rebuild the blade every time a channel slider turned the name into `custom`.
- Raw channel sliders: Cloud, Cloud Type, Fog, Precipitation, Precip Type, Wind, Wind Bearing, Lightning. Each snaps (over: 0).
- "Strike Now" button: `requestStrike()` from flashState.

### Environment Texture (environment mode)
List of `ENV_TEXTURES`, checkboxes for background and ground projection.

### Cube Map Texture (cube mode)
List of `CUBE_TEXTURES`, checkbox for background.

## Key behavior

- Never writes sky parameters directly — always calls `skyActions` and `environmentActions`.
- The `e.detail.origin === 'internal'` guard on sliders prevents svelte-tweakpane-ui external-change events from causing feedback loops.
