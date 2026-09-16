# Audio panel (`extensions/audio/`)

**Panel-only**, like `extensions/skybox/`. It owns no state and has no barrel.

```
types.ts              — extensionScope, and nothing else
AudioExtension.svelte — Studio toolbar panel (buses + positional fallbacks + inspector)
```

Was `extensions/sound/`. The rename is the smaller half of what happened to it; the real
change is that **its state moved into the engine**. The old extension held five positional
params as `$state` plus a Studio-aware `useSound()` hook, and exactly one component in the
app read them. Those params are engine config — `AudioRuntime` consumes them in every
build, Studio or not — so they live in `core/audio/voices.ts` (`positionalDefaults`) now
and this panel is just another caller. Deleted with the move: `soundState.svelte.ts`,
`useSound.ts`, `index.ts`, and two exports that were never read at all
(`listenerEnabled`, `defaultSoundState()`).

## The panel

1. **Buses** — Master fader, then SFX / Music / Ambient with an enable + a volume. These
   write `settingsState.audio` through `audioActions`; `AudioRuntime`'s one sync effect
   pushes that into the real gain nodes. **`on:change`, never `bind:`** — `bind:` writes
   the state directly and skips the actions that persist to localStorage, which is what
   the old panel did.

   > **BOTH RULES APPLY AT ONCE, and taking only the first one breaks the app.** Moving
   > these checkboxes off `bind:` without also guarding `e.detail.origin === 'internal'`
   > shipped an infinite loop: svelte-tweakpane-ui dispatches `change` for PROGRAMMATIC
   > value updates too (`core/Binding.svelte:74`, tagged `origin: 'external'`), so
   > `Loader.svelte`'s autoplay unlock — which calls `toggleMusic/Ambience/Sfx` — fired
   > every handler. A **`toggle` is not idempotent**, so the handler flipped each value
   > straight back, which dispatched again, until Svelte threw
   > `effect_update_depth_exceeded`. The old panel survived only by accident: its
   > checkboxes used `bind:` (no handler at all) and its sliders set a _value_, which is
   > idempotent and converges. Every handler in this panel is guarded, including the
   > positional ones — `resetPositional()` writes those values too.

2. **Positional Defaults** — the engine-wide fallbacks. A sound that declares its own
   `ref` / `rolloff` / `max` / `panningModel` is unaffected by these.
3. **Inspector** — logs the bus graph, every live voice (sound, bus, gain, rate, playing,
   positional) and, during a capture take, `schedulerDrift()`.

The **logger channel is still `sound`** (`logSound`, 🔊). Deliberately not renamed with the
extension — it is a persisted channel id with call sites across `core/audio/` and beyond,
and renaming it buys nothing but churn.

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
