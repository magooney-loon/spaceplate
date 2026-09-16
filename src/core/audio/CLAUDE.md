# Audio (`src/core/audio/`)

```
mixer.ts              — THE BUS GRAPH: real GainNodes, routeToBus(), busAudible()
GlobalAudio.svelte    — owns ALL <Audio> Threlte components; never unmounts
globalAudio.svelte.ts — soundTriggers + soundActions singleton (import from here in .ts files)
weatherAudio.ts       — rain bed + thunder claps; the sky's audio consumer
```

> **Being reworked — `DOCS/AUDIO.md` is the plan.** Step 1 (the mixer) has landed; the
> registry, scene-time scheduling and the deterministic capture render have not.
> `soundTriggers` still exists and still only speaks two hardcoded sounds.

## The mixer

Every voice connects to a **bus**, never to the listener directly:

```
sources ──▶ music ────┐
            ambience ─┼──▶ listener.gain ──▶ destination
            sfx ──────┤        (master)
              └─ ui ──┘
```

- **Three's listener stays the master.** Its own contract (`setMasterVolume`, the filter
  slot) keeps working, and `capture/`'s tap fans off `listener.gain` — so it still sees
  everything however many buses sit above it. Don't re-parent it.
- **`ui` is a child of `sfx`**, so click/swoosh ride the sfx fader exactly as they used to,
  with a place to trim UI separately later.
- **A volume is a gain node, not a number call sites multiply in.** `settingsState.audio`
  reaches the graph in exactly one place — `syncMixerFromSettings()`, called from a single
  `$effect` in `GlobalAudio.svelte`. Nothing else may read `settingsState.audio.*Volume` to
  scale a voice; that duplication is what the mixer replaced.
- **`enabled` is a MUTE on the bus**, not a per-call-site `if` guard. The old guards could
  each be forgotten individually and one was: a click fired while sfx was disabled left
  `soundTriggers.click` above zero, and since `sfxEnabled` was an effect dependency,
  enabling audio replayed it.
- **EVERY CLONE MUST BE ROUTED.** `Audio.clone()` is `new this.constructor(this.listener)`,
  and that constructor wires `gain → listener.getInput()` — so a clone comes back wired
  **past the whole bus graph, at full volume**, however its template was routed. Call
  `routeToBus(clone, bus)` before `play()`. Both polyphonic paths (swoosh, thunder) do.
- **`busAudible(id)` is for TASK-driven consumers only.** Buses are plain objects, so a
  `$derived` over them would never re-run. Components derive audibility from
  `settingsState.audio` primitives instead (`GlobalAudio.svelte`) — which is also
  order-independent, where reading the graph would race the sync effect. Audibility is only
  ever a **cost** decision: the gain node has already made a muted bus silent, but a bed
  nobody can hear should not be decoding.

## Rules

- **Import triggers/actions from the `.ts` file, never the `.svelte` file** — named
  exports from `<script module>` in a `.svelte` file aren't visible to TypeScript in
  `.ts` imports. `import { soundActions } from '$core'`.
- `soundActions.playSwoosh()` — polyphonic (clone per call → overlapping instances; the
  clone is routed to `ui` before it plays). `soundActions.playClick()` — one-shot
  (stop + restart).
- `$state.raw<ThreeAudio>()` — prevents Svelte 5 Proxy wrapping of THREE.js class
  instances.
- **Audio defaults must be `false`** — browser autoplay policy requires audio to start
  disabled. `Loader.svelte` shows the enable prompt that unlocks it. `masterVolume` is the
  one audio setting that defaults to ON (1) and has no enable toggle: the three bus toggles
  already gate everything, and a master mute defaulting to `false` would fight that unlock.
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
this schedules real playback on the live `AudioContext`, and `capture/`'s offline-render
audio track is a **live tap of that same real-time output** (see capture/CLAUDE.md,
"Audio: a best-effort live tap"), not a re-derivation from scene time. So wall-clock
scheduling here is still correct by design even though a take can end up capturing it —
what plays is what gets recorded, regardless of how the video track's frame-stepped
timeline maps to wall-clock time.
