# Positional Audio Defaults (`sound/`)

## Files

```
types.ts              — ExtensionState (positional audio params), ExtensionActions
soundState.svelte.ts  — $state, defaultSoundState(), useSound()
useSound.ts           — Studio-aware hook (path import, not barrel)
SoundExtension.svelte — Studio toolbar panel (buses + positional audio)
index.ts              — barrel re-exports
```

## State shape

- `refDistance` (5), `maxDistance` (80), `rolloffFactor` (1.5), `panningModel` ('HRTF'), `listenerEnabled` (true).

## Studio panel

Two sections:
1. **Buses** — SFX/Music/Ambient folders with Checkbox (enabled) + Slider (volume). These delegate to `settingsState.audio` (cross-extension writes).
2. **Positional Audio** — Panning model list, ref/max distance sliders, rolloff factor slider, reset button.

## Key behavior

- `useSound()` is a Studio-aware hook with fallback: tries `useStudio().useExtension(extensionScope)`, falls back to `{ state: soundState }`. Not through barrel (path import).
- The actual sound playback lives in `core/audio/` (GlobalAudio.svelte, globalAudio.svelte.ts).
- Volume/enable toggles are in `settingsState.audio`. This extension is primarily for positional-audio tuning.
- No localStorage persistence — positional audio defaults reset on page load.
