# Audio (`src/core/audio/`)

```
types.ts            — SoundDef, PlayOptions, VoiceHandle, AudioScope, BusId
mixer.ts            — THE BUS GRAPH: real GainNodes, routeToBus(), busAudible()
registry.ts         — declarations + decoded buffers; fetch/decodeAudioData, variant sets
voices.ts           — the THREE.Audio objects: one-shot pools, loops, handles, parking
audio.ts            — THE FACADE: defineSounds() + `audio`. The only door.
engineSounds.ts     — the ENGINE's own manifest (click/swoosh/ost/ambience/rain/thunder)
AudioRuntime.svelte — renders nothing: listener hookup, settings sync, the two beds,
                      tab-hide parking, the weather tick
weatherAudio.ts     — rain bed + thunder claps; the sky's audio consumer
index.ts            — barrel
```

> **Being reworked — `DOCS/AUDIO.md` is the plan.** Steps 1–2 (the mixer, the registry)
> have landed. Scene-time scheduling (step 3), the `extensions/audio` rename (step 4) and
> the deterministic capture render (step 5) have not — `PlayOptions.delay` is still
> **wall-clock** seconds, and `capture/`'s audio is still a best-effort live tap.

## The registry is the only door

`defineSounds()` declares; `audio.play()` / `audio.loop()` play. Nothing else constructs a
`THREE.Audio`, and no component mounts `<Audio>` / `<PositionalAudio>` markup.

```ts
const sfx = defineSounds({ click: { url: 'click.mp3', bus: 'ui' } });
sfx.click.play(); // typed — a renamed sound is a compile error
audio.play('click', { volume: 0.5 }); // for ids only known at runtime
const bed = audio.loop('rain', { paused: true });
bed.volume = 0.4;
```

- **This is a CONTRACT, not a style preference.** Step 5 reproduces a take by replaying
  what the facade was told, so anything reaching a `THREE.Audio` around the side is
  silently absent from a recording — no error, no sound in the file.
- **`url` is relative to `public/sounds/`** — the registry prefixes `BASE_URL` itself.
- **A url LIST is a variant set**, drawn at random per play. That is the thunder-take
  picker, moved into the declaration; adding a take is one line.
- **`poly` is one-shot depth**, oldest stolen on overflow. `poly: 1` is stop-and-restart.
  Loops ignore it: each `loop()` gets its own voice and its own handle.
- **Loading is ours, not Threlte's `<Audio src>`.** `fetch` + `decodeAudioData` hands back
  the `AudioBuffer` directly — which step 5's `OfflineAudioContext` reuses rather than
  decoding twice — and gives a real per-sound status in place of the hand-maintained
  `AUDIO_TOTAL = 5 + …` counter that used to sit in GlobalAudio.svelte.
- **A voice is null until its buffer lands.** Callers that already poll (weatherAudio)
  retry each tick; callers that do not (the music/ambience beds) await `soundsReady()`.
- **`freeAt`, not `isPlaying`, decides whether a pooled voice is free.** Three's
  `stop(delay)` flips `isPlaying` false IMMEDIATELY and defers only the source's stop, so
  a `duration`-limited voice looks available while it is still ringing. Stealing it there
  orphans the live BufferSource — `play()` overwrites `this.source`, and the old one keeps
  sounding through the shared gain with nothing holding a reference to stop it.
- **Scopes, not detach functions.** `audio.scope()` → `release()` stops everything created
  through it; a scene takes one on mount and releases it on unmount.
- **Tab-hide parking is the engine's.** rAF stops when the tab hides and the AudioContext
  does not, so a loop drones at its last pitch behind a hidden tab. Loops only — a one-shot
  in flight is shorter than the blink that hid the tab.

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
  `$effect` in `AudioRuntime.svelte`. Nothing else may read `settingsState.audio.*Volume`
  to scale a voice; that duplication is what the mixer replaced.
- **`enabled` is a MUTE on the bus**, not a per-call-site `if` guard. The old guards could
  each be forgotten individually and one was: a click fired while sfx was disabled left
  the old `soundTriggers.click` counter above zero, and since `sfxEnabled` was an effect
  dependency, enabling audio replayed it.
- **ROUTING IS PER VOICE, AND CLONES ARE THE TRAP.** `routeToBus` is structural
  (`{ gain: GainNode }`) because `PositionalAudio` is not an `Audio<GainNode>` to
  TypeScript — it overrides `getOutput()` to a `PannerNode` — while both still end in
  `this.gain`. The registry routes every voice it creates, so engine code no longer clones;
  but **`Audio.clone()` is `new this.constructor(this.listener)`**, and that constructor
  wires `gain → listener.getInput()`, so any clone comes back wired **past the whole bus
  graph, at full volume**. Scene code that still clones (TestGame's `carAudio`) must call
  `routeToBus(clone, bus)` before `play()`.
- **`busAudible(id)` is for TASK-driven consumers only.** Buses are plain objects, so a
  `$derived` over them would never re-run. Components derive audibility from
  `settingsState.audio` primitives instead (`AudioRuntime.svelte`) — which is also
  order-independent, where reading the graph would race the sync effect. Audibility is only
  ever a **cost** decision: the gain node has already made a muted bus silent, but a bed
  nobody can hear should not be decoding.

## Rules

- **Import the facade, not a component** — `import { audio, engineSounds } from '$core'`.
  `engineSounds.click.play()` / `engineSounds.swoosh.play()` are the two UI one-shots the
  HUDs use; they replaced `soundActions.playClick()` / `playSwoosh()`.
- `$state.raw<VoiceHandle>()` for handles held in components — and `$state.raw` for any
  THREE.js class instance, which Svelte 5 would otherwise Proxy-wrap and break.
- **Audio defaults must be `false`** — browser autoplay policy requires audio to start
  disabled. `Loader.svelte` shows the enable prompt that unlocks it. `masterVolume` is the
  one audio setting that defaults to ON (1) and has no enable toggle: the three bus toggles
  already gate everything, and a master mute defaulting to `false` would fight that unlock.
- **`AudioRuntime` never unmounts**, which is what kills the mount/unmount races: scenes
  declare sounds and ask for voices instead of mounting audio components of their own.

## Weather audio (`weatherAudio.ts`)

The sky's audio consumer: the rain bed and thunder claps read `descriptor.weather` +
`flashState` from a task ticked by `AudioRuntime` — **never an `$effect`** (the descriptor
is plain state, not reactive; an effect would run once at mount and never again).

The triggers deliberately do NOT live in the sky layers: layers unmount with the
environment mode, and a looping bed must not. Thunder arrival is delayed ~3 s/km by
`strikeDistance` — that gap is most of what makes a storm feel sized.

It is a pure CONSUMER now: it owns no `THREE.Audio`, picks no take and clones nothing.
The takes are a variant set on the `thunder` declaration, and the flight time is a
scheduled `delay` rather than a `pendingThunder` queue this tick drained — which also
makes each arrival sample-accurate instead of landing on the next frame boundary.

**`performance.now()` is gone from this file**, and with it the repo's one sanctioned use
of it. The delay is scheduled on the `AudioContext` clock via three's `play(delay)`.
That is still WALL-CLOCK time, so a clap inside a capture take still lands at the wrong
_scene_ moment — step 3 of `DOCS/AUDIO.md` converts `PlayOptions.delay` to scene seconds,
and step 5 makes the recording itself deterministic.
