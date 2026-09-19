# Audio panel (`extensions/audio/`)

**Panel-only**, like `extensions/skybox/`. It owns no state and has no barrel.

```
types.ts              — extensionScope, and nothing else
AudioExtension.svelte — Studio toolbar panel (buses + positional fallbacks + inspector)
```

The positional fallback params (`ref` / `rolloff` / `max` / `panningModel`) are engine
config, not panel state — they live in `core/audio/voices.ts` (`positionalDefaults`),
since `AudioRuntime` consumes them in every build, Studio or not. This panel is just
another caller.

## The panel

1. **Buses** — Master fader, then SFX / Music / Ambient with an enable + a volume. These
   write `settingsState.audio` through `audioActions`; `AudioRuntime`'s one sync effect
   pushes that into the real gain nodes. **`on:change`, never `bind:`** — `bind:` writes
   the state directly and skips the actions that persist to localStorage.

   > **Both rules apply at once, and taking only the first one breaks the app.** Every
   > `on:change` handler must also guard `e.detail.origin === 'internal'`:
   > svelte-tweakpane-ui dispatches `change` for programmatic value updates too
   > (`core/Binding.svelte:74`, tagged `origin: 'external'`), so `Loader.svelte`'s
   > autoplay unlock (which calls `toggleMusic/Ambience/Sfx`) fires every handler. A
   > `toggle` is not idempotent, so an unguarded handler flips the value straight back,
   > which dispatches again — `effect_update_depth_exceeded`. Every handler in this
   > panel is guarded, including the positional ones (`resetPositional()` writes those
   > values too).

2. **Positional Defaults** — the engine-wide fallbacks. A sound that declares its own
   `ref` / `rolloff` / `max` / `panningModel` is unaffected by these.
3. **Inspector** — logs the bus graph, every live voice (sound, bus, gain, rate, playing,
   positional) and, during a capture take, `schedulerDrift()`.

The logger channel is `sound` (`logSound`, 🔊) — a persisted channel id with call sites
across `core/audio/` and beyond, kept independent of the extension's own name.

## Two things that look like omissions and are not

- **The positional widgets hold their own values.** `positionalDefaults` is deliberately a
  plain object, not `$state`: it is read inside `createVoice()`, which runs from whatever
  called `play()` — sometimes an `$effect` — and reactive state read there would make
  every sound-playing effect depend on the tuning knobs. This panel is its only writer, so
  there is nothing to stay in sync with. It calls `refreshPositional()` after each change,
  because a tuning slider you cannot hear is not a tuning slider.
- **The inspector is a button, not a live readout.** A `$state` mirror updated per frame
  would be one reactive write per voice per frame to drive something that gets glanced at
  — the same cost `carDebugHud` gates itself on. A snapshot on demand gives the same
  information for nothing.
