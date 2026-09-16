# Audio (`src/core/audio/`)

```
types.ts            — SoundDef, PlayOptions, VoiceHandle, AudioScope, BusId
mixer.ts            — THE BUS GRAPH: real GainNodes, routeToBus(), busAudible(),
                      busGraph()/busGain() for the take recorder
registry.ts         — declarations + decoded buffers; fetch/decodeAudioData, variant sets
scheduler.ts        — scene time ↔ AudioContext time; the take anchor; schedulerDrift()
voices.ts           — the THREE.Audio objects: one-shot pools, loops, handles, parking;
                      also drives the take recorder (it owns the live voice set)
timeline.ts         — the take recorder's STORAGE: events + epsilon-gated automation,
                      stamped in scene seconds; imports nothing from voices.ts
render.ts           — the OfflineAudioContext replay of a recorded take → one AudioBuffer
audio.ts            — THE FACADE: defineSounds() + `audio`. The only door.
engineSounds.ts     — the ENGINE's own manifest (click/swoosh/ost/ambience/rain/thunder)
AudioRuntime.svelte — renders nothing: listener hookup, settings sync, the two beds,
                      tab-hide parking, the weather tick, the per-frame take sampling
weatherAudio.ts     — rain bed + thunder claps; the sky's audio consumer
index.ts            — barrel
```

> **Reworked per `DOCS/AUDIO.md`** — steps 1–5 have landed (the mixer, the registry +
> voices, the scene clock, the panel rename, and the deterministic capture render that
> replaced `capture/`'s live tap). What remains is step 6, the acceptance pass against
> `TestGame/carAudio.ts`. **Not yet runtime-verified by ear.**

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
  the `AudioBuffer` directly — which the `OfflineAudioContext` replay (`render.ts`) reuses
  rather than decoding twice — and gives a real per-sound status in place of the
  hand-maintained `AUDIO_TOTAL = 5 + …` counter that used to sit in GlobalAudio.svelte.
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
  slot) keeps working, and every bus ends at `listener.gain`, so nothing bypasses the graph
  however many buses sit above it. Don't re-parent it. (A capture tap used to fan off this
  node; the offline render replaced it — see "Deterministic takes" below.)
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
  session; it makes the UNIT explicit so the offline render can replay a take against it.
  Only the ORIGIN moves.
- **In realtime the anchor is re-glued every frame**, which also absorbs the small real
  drift between rAF time and the audio hardware clock that a once-at-boot anchor would
  accumulate. **When a fixed-step source claims the engine clock the anchor freezes**, and
  the gap that then opens IS the capture drift.
- **`schedulerDrift()` measures that gap** — how far the live audio clock has run ahead of
  scene time since a take began, in seconds. Zero in realtime. That gap is exactly how far
  the old live tap's sound ran ahead of its picture; the offline render removed it from
  takes, and this remains the honest gauge of how far the live monitor has fallen behind
  mid-take.
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

## Deterministic takes (`timeline.ts` + `render.ts`)

A capture take's video is `frameCount / fps` scene-seconds however long each frame took to
 draw, so a recording tapped off the live graph can never match it — the live clock runs at
 wall pace (slope 1, above) and drifts by exactly how far the renderer fell behind. The fix
is the registry itself: while a take is armed the layer RECORDS what it was told, stamped
in scene seconds, and `render.ts` re-performs it into an `OfflineAudioContext`.

- **Two kinds of record.** EVENTS are discrete and rare — a voice started (at its
  SCHEDULED scene time, so a thunder clap delayed 8 s lands 8 s into the take) or stopped
  (every stop path funnels through `release()`; pause/resume and pool steals close their
  entries too). AUTOMATION is continuous — per-voice `volume` / `rate` / world position,
  per-bus gain, and the listener pose (9 floats) — sampled once per frame by
  `AudioRuntime`'s task, AFTER the consumers have written the frame's values.
  EPSILON-GATED, so a steady bed costs one breakpoint and a moving one a float per frame
  (same discipline as `skyMeta`'s mirror).
- **A bed already sounding when the take arms is entered with its playback cursor**, so
  the replay seeks into the buffer by exactly what has already been heard — the music and
  ambience beds have been looping since boot, and without this the take would render them
  from silence (or from sample 0, an audible jump).
- **The replay rebuilds the graph, not the voices**: the bus tree from `busGraph()` with
  its recorded gains; per voice a BufferSource over the SAME decoded `AudioBuffer` (buffers
  are not context-bound — the reason loading is ours), a `BiquadFilterNode` and
  `PannerNode` rebuilt from the recorded params, curves applied via `setValueAtTime` /
  `linearRampToValueAtTime`, `start(t)` / `stop(t)` clipped to the take window. Where the
  listener has no AudioParams (Firefox was late) it is pinned to its start-of-take pose
  and a warning is logged.
- **`audio.recording` is the door** — `arm(sceneTime)` / `render(durationScene)` /
  `discard()`. `capture/` arms at the same synchronous instant it claims the engine clock
  and renders with `frameCount / fps`; the buffer comes back exactly that long, so sync
  with the video is exact by construction at any render speed.
- **The cost, stated plainly:** anything that does not go through the registry is invisible
  to the recorder and silently absent from the take. A scene mounting a raw `<Audio>`, or
  calling `.setVolume()` on a `THREE.Audio` directly, gets no error and no sound in the
  file. That is the price of determinism, and the reason the registry is the only door.

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
(slope 1, above), so it will not be where a _slow_ take's picture is — but the take
records it at its scene time and the offline render puts it back exactly there. The
monitor is best-effort; the file is exact.
