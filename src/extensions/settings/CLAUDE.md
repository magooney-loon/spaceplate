# User Settings (`settings/`)

## Files

```
types.ts            — QualityLevel, Audio/Graphics/GeneralSettings, Extension types
settings.svelte.ts  — $state, audioActions, graphicsActions, generalActions, BASE_URL,
                      seedGraphicsQuality() (boot-probe default, see State shape)
index.ts            — barrel re-exports
```

## State shape

- **audio**: `musicVolume` (0.7), `musicEnabled` (false), `ambienceVolume` (0.5, false), `sfxVolume` (0.9, false). All audio defaults are `false` per browser autoplay policy.
- **graphics**:
  - `quality: 'low' | 'high'` (default `'high'`). Picks the base DPR and gates the post-processing bypass and the per-scene presets. On a device with no stored choice the default is replaced by `seedGraphicsQuality()` (called from `main.ts` after the boot probe): `'low'` on the WebGL2 fallback or a software adapter, `'high'` otherwise. Integrated GPUs are not downgraded — Apple Silicon reports as integrated. The seed is never persisted, so an explicit pick still wins and the recommendation re-derives each boot.
  - `renderScale: number` (0.5–1, default 1) — render resolution as a fraction of what the preset would otherwise use. **`App.svelte` multiplies it onto the preset's base DPR rather than replacing it**, so 1 reproduces the old behaviour exactly on both presets and the two knobs compose instead of fighting. Clamped in the action AND on load, so a hand-edited localStorage value cannot put the renderer at 0.
- **Backbuffer size is the cheapest lever in the engine.** Everything fill-rate-bound — the precipitation fields, the mirror floor's full-resolution reflection pass, every post-processing pass — scales with its square, and it is the only setting that costs sharpness rather than content. It is the right first answer to "the framerate dropped", ahead of particle counts.
- **general**: `uiVisible` (true, persisted via Ctrl+H), `mouseSensitivity` (0.5), `aimSensitivity` (0.3).
- **overlayState**: `{ settingsOpen: false }`. Transient, never persisted.

## Key behavior

- Each localStorage key is a separate string (not a single blob): `graphics-quality`, `render-scale`, `music-volume`, `music-enabled`, `ui-visible`, `mouse-sensitivity`, `aim-sensitivity`, etc.
- `fromStorage` / `toStorage` helpers wrap try/catch for safety.
- `BASE_URL` — always use for static asset paths, never hardcode.

## Cross-extension access

```ts
import { settingsState } from '$extensions/settings';
// Runes are reactive across modules
settingsState.audio.musicVolume;
```

State-only extension — no Studio panel. Many other extensions read this state directly (e.g., `physicsState`, sound system).
