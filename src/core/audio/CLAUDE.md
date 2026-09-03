# Audio (`src/core/audio/`)

```
GlobalAudio.svelte    — owns ALL <Audio> Threlte components; never unmounts
globalAudio.svelte.ts — soundTriggers + soundActions singleton (import from here in .ts files)
weatherAudio.ts       — rain bed + thunder claps; the sky's audio consumer
```

## Rules

- **Import triggers/actions from the `.ts` file, never the `.svelte` file** — named
  exports from `<script module>` in a `.svelte` file aren't visible to TypeScript in
  `.ts` imports. `import { soundActions } from '$core'`.
- `soundActions.playSwoosh()` — polyphonic (clone per call → overlapping instances).
  `soundActions.playClick()` — one-shot (stop + restart).
- `$state.raw<ThreeAudio>()` — prevents Svelte 5 Proxy wrapping of THREE.js class
  instances.
- **Audio defaults must be `false`** — browser autoplay policy requires audio to start
  disabled. `Loader.svelte` shows the enable prompt that unlocks it.
- `GlobalAudio` owning every `<Audio>` and never unmounting is what kills mount/unmount
  races; scenes request sounds through `soundTriggers` instead of mounting their own
  audio components.

## Weather audio (`weatherAudio.ts`)

The sky's audio consumer: the rain bed and thunder claps read `descriptor.weather` +
`flashState` from a task ticked by GlobalAudio — **never an `$effect`** (the descriptor
is plain state, not reactive; an effect would run once at mount and never again).

The triggers deliberately do NOT live in the sky layers: layers unmount with the
environment mode, and a looping bed must not. Thunder arrival is delayed ~3 s/km by
`strikeDistance` — that gap is most of what makes a storm feel sized.

The one sanctioned `performance.now()` use in the repo lives here (blend scheduling) —
audio is never captured, so wall-clock time is correct by design.
