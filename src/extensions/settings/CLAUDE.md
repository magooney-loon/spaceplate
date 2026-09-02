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
- **graphics**: `quality: 'low' | 'high'` (default `'high'`). Drives DPR and renderer power preference. On a device with no stored choice the default is replaced by `seedGraphicsQuality()` (called from `main.ts` after the boot probe): `'low'` on the WebGL2 fallback or a software adapter, `'high'` otherwise. Integrated GPUs are not downgraded — Apple Silicon reports as integrated. The seed is never persisted, so an explicit pick still wins and the recommendation re-derives each boot.
- **general**: `uiVisible` (true, persisted via Ctrl+H), `mouseSensitivity` (0.5), `aimSensitivity` (0.3).
- **overlayState**: `{ settingsOpen: false }`. Transient, never persisted.

## Key behavior

- Each localStorage key is a separate string (not a single blob): `graphics-quality`, `music-volume`, `music-enabled`, `ui-visible`, `mouse-sensitivity`, `aim-sensitivity`, etc.
- `fromStorage` / `toStorage` helpers wrap try/catch for safety.
- `BASE_URL` — always use for static asset paths, never hardcode.

## Cross-extension access

```ts
import { settingsState } from '$extensions/settings'
// Runes are reactive across modules
settingsState.audio.musicVolume
```

State-only extension — no Studio panel. Many other extensions read this state directly (e.g., `physicsState`, sound system).
