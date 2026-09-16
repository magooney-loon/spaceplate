# Audio (`src/core/audio/`)

```
types.ts            — SoundDef, PlayOptions, VoiceHandle, AudioScope, BusId
mixer.ts            — THE BUS GRAPH: real GainNodes, routeToBus(), busAudible()
registry.ts         — declarations + decoded buffers; fetch/decodeAudioData, variant sets
scheduler.ts        — scene time ↔ AudioContext time; the take anchor; schedulerDrift()
voices.ts           — the THREE.Audio objects: one-shot pools, loops, handles, parking
audio.ts            — THE FACADE: defineSounds() + `audio`. The only door.
engineSounds.ts     — the ENGINE's own manifest (click/swoosh/ost/ambience/rain/thunder)
AudioRuntime.svelte — renders nothing: listener hookup, settings sync, the two beds,
                      tab-hide parking, the weather tick
weatherAudio.ts     — rain bed + thunder claps; the sky's audio consumer
index.ts            — barrel
```

> **Being reworked — `DOCS/AUDIO.md` is the plan.** Steps 1–3 (the mixer, the registry,
> the scene clock) have landed. The `extensions/audio` rename (step 4) and the
> deterministic capture render (step 5) have not — `capture/`'s audio is still a
> best-effort live tap, and the drift is now _measurable_ (`schedulerDrift()`) but not
> yet _fixed_.

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

## Scene time (`scheduler.ts`)

Every timestamp the layer accepts is **scene** seconds (`engineClock.elapsed`), never
`context.currentTime`. Web Audio can only be scheduled in context seconds, so one module
owns the conversion:

```
contextTime = anchorContext + (sceneTime − anchorScene)
```

- **The map is affine with SLOPE 1, and that is the thing to understand.** Intervals carry
  over exactly — a `delay` of 2 scene-seconds is always scheduled 2 context-seconds out,
  in realtime and inside a take alike. So this changes no observable behaviour in a normal
  session; it makes the UNIT explicit so step 5 can replay a take against it. Only the
  ORIGIN moves.
- **In realtime the anchor is re-glued every frame**, which also absorbs the small real
  drift between rAF time and the audio hardware clock that a once-at-boot anchor would
  accumulate. **When a fixed-step source claims the engine clock the anchor freezes**, and
  the gap that then opens IS the capture drift.
- **`schedulerDrift()` measures that gap** — how far the live audio clock has run ahead of
  scene time since a take began, in seconds. Zero in realtime. It is exactly how far a
  captured file's sound runs ahead of its picture today. Step 5 removes the drift; until
  then it is at least visible instead of theoretical.
- **The live graph during a take is a MONITOR.** Slope 1 means it plays a take's audio at
  wall-clock pace regardless of how slowly the renderer is going, which is deliberately
  _not_ corrected: a take's rate is whatever the renderer manages that frame, it is not
  known in advance, and nothing in a recording may depend on the live context. Correctness
  comes from replaying scene-time stamps offline.
- **`tickScheduler()` must run before anything that schedules a voice**, which is why
  `AudioRuntime`'s task calls it first rather than letting `weatherAudio` own a task. It
  is a plain main-stage task, so a scene's own audio tick could beat it on the frame a
  take starts and use the previous anchor — one frame of slop in a monitor, and the
  recorded stamps are unaffected.

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
of it. The flight time is a `delay` in SCENE seconds, converted by `scheduler.ts` and
scheduled natively on the `AudioContext` clock.

A clap fired inside a capture take is still voiced on the live monitor at wall-clock pace
(slope 1, above), so it is not where a _slow_ take's picture is — but the delay is now
expressed in the unit step 5's offline render replays against, which is what makes it
fixable rather than merely wrong.
