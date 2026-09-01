# Styled Logging (`logger/`)

## Files

```
types.ts            — LoggerChannel union, LoggerState, LoggerStyle, Logger type
logger.svelte.ts    — $state, channelStyles, nine pre-built loggers, loggerActions
LoggerExtension.svelte — Studio toolbar panel (channel toggles)
index.ts            — barrel re-exports
```

## Channels

| Channel | Default | Emoji |
|---------|---------|-------|
| `engine` | on | ⚙ |
| `settings` | on | 🎛 |
| `sound` | on | 🔊 |
| `postprocessing` | on | 🖼 |
| `skybox` | on | 🌤 |
| `cache` | on | 💾 |
| `gltf` | on | 📦 |
| `physics` | off | 🧊 |
| `input` | off | 🎮 |

## Pre-built loggers

`logEngine`, `logSettings`, `logSound`, `logPostprocessing`, `logSkybox`, `logCache`, `logGltf`, `logPhysics`, `logInput` — each has `.info()`, `.warn()`, `.error()`.

```ts
import { logEngine } from '$extensions/logger'
logEngine.info('World started')
```

## Key behavior

- Each log method checks `loggerState[channel]` before outputting — disabled channels are silently skipped.
- Uses `%c` CSS formatting for colored console output with styled prefixes.
- `formatTime()` produces `HH:MM:SS.mmm` timestamps.

## Adding a channel

1. Add to `LoggerChannel` union and `LoggerState` in `types.ts`.
2. Add to state defaults, `channelStyles`, and create new logger instance in `logger.svelte.ts`.
