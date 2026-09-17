# Audio — the mixer, the registry and the scene clock

> **Status: ACTIVE PLAN — steps 1–4 are built; steps 5–6 are not.** The layer lives in
> `src/core/audio/` (+ the panel in `src/extensions/audio/`) and its contracts have moved
> into those two `CLAUDE.md` files; read them for how it works. Still a plan: the
> **offline render** — `capture/`'s audio is the best-effort live tap, though the drift it
> causes is now measurable via `schedulerDrift()` — and the carAudio acceptance pass.
>
> This is the full rework of `src/core/audio/` +
> `src/extensions/sound/` into one general-purpose engine audio layer, and the fix for
> `capture/`'s audio drift. Folds into `src/core/audio/CLAUDE.md` +
> `src/extensions/audio/CLAUDE.md` as it lands; delete this file once the implementation
> order at the bottom is done.
>
> Precedent for the shape: `DOCS/input.md`. The engine stops knowing what sounds exist,
> the same way it stopped knowing what actions exist.

## Why

The engine has two audio systems that share nothing, and a third one in a scene that exists
because neither fits.

**There are no buses.** `settingsState.audio.{sfx,music,ambience}{Volume,Enabled}` are plain
numbers and booleans, and every voice multiplies them in by hand at the moment it plays:

```ts
rainAudio.setVolume(rainLevel * settingsState.audio.ambienceVolume); // weatherAudio.ts:74
clone.setVolume(volume * settingsState.audio.sfxVolume); // weatherAudio.ts:115
$effect(() => {
	if (ostAudio) ostAudio.setVolume(settingsState.audio.musicVolume);
}); // GlobalAudio.svelte:80
```

`enabled` is then enforced by `if (settingsState.audio.sfxEnabled)` guards scattered across
three files — carAudio alone has a dozen. Miss one and a muted bus plays. Change a volume
and it lands whenever that voice's tick next runs. There is no master volume, no ducking, no
mute-all, no way to ask what is playing. A `GainNode` does all of it in one place, on the
audio thread, with `setTargetAtTime` smoothing for free — and three wires each `Audio` to the
listener with exactly **one edge** (`this.gain.connect(listener.getInput())`, `Audio.js:65`),
so re-routing is a one-line disconnect/connect per voice.

**The trigger scheme is a counter, and it has a real bug.** `soundTriggers` supports exactly
two sounds and only parameterless one-shots:

```ts
$effect(() => {
	if (soundTriggers.click > 0 && settingsState.audio.sfxEnabled) {
		playOneShot(clickAudio);
		soundTriggers.click = 0;
	}
}); // GlobalAudio.svelte:102
```

It reads and writes the same reactive object in one effect — the pattern
`extensions/CLAUDE.md` bans — and gets away with it only because the guard makes it
conditional. But **audio defaults to disabled** (autoplay policy), so every `playClick()` a
player fires before enabling audio leaves the counter above zero; `sfxEnabled` is a
dependency, so flipping it on re-runs the effect and plays a click the player asked for
minutes ago.

**Assets are hardcoded in a component.** `GlobalAudio.svelte` names all nine files in
`<script>` consts and mounts one `<Audio>` per file in markup, with a hand-maintained
`AUDIO_TOTAL = 5 + THUNDER_URLS.length` load counter beside them. A game replacing the
engine's sounds edits engine code.

**Pooling is hand-rolled three times, two of them leaky.** `playPolyphonic` clones per call
and never reaps or disconnects; `weatherAudio` clones thunder the same way; `carAudio` keeps
`livePops[]` and reaps properly in its tick. One primitive, three implementations.

**`extensions/sound/` is a panel wearing an extension's clothes.** Five files of substance:
five positional params read by exactly one component in the app
(`DemoScene/DemoPhysicsBodies.svelte`), a Studio panel that mostly proxies
`settingsState.audio`, and two dead exports — `listenerEnabled` is declared and never read,
`defaultSoundState()` is exported and called only by its own module.

**Audio is the one thing the engine clock does not reach.** `weatherAudio.ts` schedules
thunder on `performance.now()` — the repo's one sanctioned use — and `capture/`'s tap records
real `AudioContext` output. Both are wall-clock, while everything else in the app runs on
scene time (`core/utils/engineClock.ts`). Under a take the two diverge exactly as far as the
render falls behind, which is the documented sync problem and also why a captured thunder
clap lands at the wrong scene moment.

**And `TestGame/audio/carAudio.ts` is the proof.** 752 lines of layer crossfading, one-shot
pools with per-hit jitter, edge-triggered voices, park/detach lifecycle and loudest-source-wins
mixing — written from scratch, with a header explaining that the engine's path "is built for
UI one-shots and weather beds, not for a scene-local engine". That file is not migrating (see
_carAudio is the spec, not the migration_ below), but everything it had to invent is the
requirements list for this rework.

## The model

```
      GAME                                ENGINE
      ────                                ──────
      defineSounds({ … })  ──declares──▶  registry ──▶ buffers (fetch + decodeAudioData)
                                              │
      audio.play('click')  ──────────────▶  voices ──▶ bus graph ──▶ listener.gain ──▶ speakers
      audio.loop('rain')                      │           │
           │                                  │           └── settings (real GainNodes)
           └── handle: .volume .rate .stop     │
                                              ▼
                                          timeline ──▶ OfflineAudioContext ──▶ capture/
                                       (scene time)        (deterministic)
```

Four pieces, each replacing something that is currently duplicated:

- **Bus** — a `GainNode` with an id. Sources connect to a bus, never to the listener directly.
  Settings drive bus gain; nothing multiplies a volume by hand again.
- **Sound** — a _declaration_: id, url(s), bus, loop/poly/positional defaults. Data, not markup.
- **Voice** — one playing instance. Pooled, reaped, and addressable through a handle.
- **Timeline** — what the layer was _told_ to do, stamped in scene seconds. The thing that
  makes a take reproducible.

## The mixer

One bus tree, inserted **between the sources and three's listener**, which stays the master:

```
sources ──▶ ui ───────┐
            music ────┤
            ambience ─┼──▶ listener.gain ──▶ context.destination
            sfx ──────┤        (master)
              └ engine┘   (three's AudioListener — unchanged)
```

Keeping `listener.gain` as master is deliberate and load-bearing in two places: three's
`AudioListener` contract (`setMasterVolume`, the filter slot) keeps working untouched, and
**`capture/`'s tap point stays valid** — it fans off `listener.gain`, so it still sees
everything regardless of how many buses exist above it.

Routing is one function, and it is uniform for `Audio` and `PositionalAudio` alike — both end
in `this.gain`, because `PositionalAudio` puts its panner _upstream_ (`panner.connect(this.gain)`,
`PositionalAudio.js:60`) and only overrides `getOutput()`:

```ts
const routeToBus = (audio: ThreeAudio, bus: Bus) => {
	audio.gain.disconnect(listener.getInput());
	audio.gain.connect(bus.input);
};
```

Panning is unaffected: a `PannerNode` is evaluated against `context.listener`, not against
whatever is downstream of it.

Buses nest. The engine ships `master ▸ { music, ambience, sfx, ui }`; a game adds its own with
a parent, which is how a car game gets one fader for every voice the car makes:

```ts
defineBuses({ engine: { parent: 'sfx' }, tires: { parent: 'sfx' } });
```

**`enabled` becomes `muted` on the bus.** Every scattered `if (…Enabled)` guard deletes. The
one thing that still reads the flag is a _cost_ decision, not a correctness one — a looping
source that is inaudible should not be decoding — so a handle exposes `audible` (its bus chain
is unmuted and above epsilon) and loops gate playback on it. That is what `weatherAudio.ts:71`
already does by hand for rain.

## Declaring sounds

The registry is the single door. Nothing else mounts a `THREE.Audio`.

```ts
defineSounds({
	click: { url: 'click.mp3', bus: 'ui' },
	swoosh: { url: 'swoosh.mp3', bus: 'ui', poly: 4 },
	ost: { url: 'ost.mp3', bus: 'music', loop: true },
	rain: { url: 'skybox/rain.opus', bus: 'ambience', loop: true },
	// A list is a VARIANT SET — one is drawn per play. This is weatherAudio's thunder
	// take picker and carAudio's two pop takes, generalised into the declaration.
	thunder: { url: ['skybox/thunder-1.opus', …], bus: 'sfx', poly: 3 },
	// Positional defaults live on the sound, not on a global — carAudio's REF_DISTANCE /
	// ROLLOFF / MAX_DISTANCE stop being scene-local consts with a comment apologising
	// for it. Engine-wide fallbacks fill anything omitted.
	engineIdle: { url: 'engine/idle.opus', bus: 'engine', loop: true, ref: 10, rolloff: 1.4, max: 300 }
});
```

- `url` is resolved through `BASE_URL`, as every static asset already is.
- Loading is the registry's: `fetch` → `context.decodeAudioData`, giving an `AudioBuffer`
  directly. That replaces the hand-maintained `AUDIO_TOTAL` counter with a real per-sound
  status, and is what lets the offline render reuse the _same_ decoded buffers.
- **Definitions are additive and scoped.** The engine's own manifest
  (`core/audio/engineSounds.ts`) is data a game can delete; a scene declares its own on mount.

## Playing

```ts
audio.play('click'); // one-shot; restart semantics
audio.play('thunder', { volume, rate, lowpass, delay: 2.4 }); // all optional
audio.play('pop', { at: tipObject }); // positional: parented, panned, reaped

const bed = audio.loop('rain'); // a handle
bed.volume = 0.4; // setTargetAtTime under the hood — no clicks
bed.rate = 1.08;
bed.stop();
```

Three things this collapses:

- **`delay` is in SCENE seconds**, scheduled by the engine's scheduler. `weatherAudio`'s
  `pendingThunder` array, its `performance.now()` arithmetic and its per-frame drain loop all
  become `audio.play('thunder', { delay: distance / SPEED_OF_SOUND, … })` — and the clap lands
  at the right _scene_ moment inside a take, which it does not today.
- **`lowpass` and `rate` jitter are first-class**, because the thunder-clap contract ("no two
  hits alike") is reinvented verbatim in `carAudio`'s pops and its scrape shriek. A fresh
  `BiquadFilterNode` per voice is the engine's job — `clone()` sharing the template's filter
  array by reference is a trap `weatherAudio.ts:46` documents and every future caller would
  re-discover.
- **`poly` decides one-shot semantics.** `poly: 1` is stop-and-restart (today's
  `playOneShot`); `poly > 1` is a pool of that depth with oldest-stolen overflow, reaped
  centrally. No caller writes a `livePops[]` array again.

### Handles, scopes and lifecycle

A voice belongs to a **scope**, and releasing the scope stops and disposes everything created
through it:

```ts
const scope = audio.scope(); // in a scene component
scope.loop('engineIdle', { at: engineBay });
$effect(() => () => scope.release()); // one line replaces detachCarAudio()'s 35
```

Two lifecycle rules move from scene code into the engine, because both are engine-shaped:

- **Tab hide parks loops.** rAF stops when the tab hides, the `AudioContext` does not, so a
  bed drones at its last pitch behind a hidden tab — `CarEngineAudio.svelte:57` discovered
  this and every future looping voice would too. The runtime pauses loop voices on
  `visibilitychange` and resumes them where they were.
- **Scene switch releases the scene's scope.** `Scene.svelte` unmounts the whole tree; the
  scope goes with it.

## Scene time

This is the load-bearing new piece, and the prerequisite for everything in the next section.

Every timestamp in the layer is `engineClock.elapsed` — scene seconds — not
`context.currentTime`. In realtime the two run at the same _rate_ with different origins, so
the scheduler keeps an anchor and converts:

```
contextTime = audioOrigin + (sceneTime − sceneOrigin)
```

re-anchored whenever `engineClock.fixed` flips (the clock handover in and out of a take). A
delayed play becomes `source.start(contextTime)` — Web Audio's own sample-accurate
scheduling, which is strictly better than today's per-frame `performance.now()` polling even
before the capture argument.

**Under a take the conversion stops being an offset and starts diverging** — scene time
advances `1/fps` per rendered frame while wall time advances however long the frame took.
That divergence _is_ the drift. So the scheduler has two modes, and the recording one does not
try to fix the live graph:

- **realtime** — convert and schedule on the live graph. What ships in production.
- **recording** — schedule on the live graph _and_ append to the timeline. The live graph is
  a best-effort monitor so the operator hears the take being made; **nothing in the output
  depends on it.**

## Deterministic takes

The capture fix. Because the registry is the only door, the layer can record what it was told
and re-perform it offline.

Two kinds of record, both stamped in scene seconds:

- **Events** — discrete: `{ t, kind: 'start' | 'stop', voiceId, soundId, variant, params }`.
  Cheap and rare.
- **Automation** — continuous: each live voice's `volume` / `rate` / world position, sampled
  once per frame by the runtime's task. **Epsilon-gated** — a breakpoint is only appended when
  the value actually moved — so a steady bed costs nothing and an rpm-tracking engine layer
  costs one float per frame. Same discipline as `skyMeta`'s epsilon-gated mirror.

Plus the **listener pose** per frame (position + orientation, 9 floats, epsilon-gated), because
positional voices are panned against it.

At finalize:

```
OfflineAudioContext(2, ceil(sceneDuration × 48000), 48000)
  ├─ rebuild the bus graph (the same ids, the recorded gains)
  ├─ per voice: BufferSource (the SAME decoded AudioBuffer — buffers are not context-bound)
  │             + PannerNode fed the recorded position breakpoints, where positional
  │             + BiquadFilterNode rebuilt from the recorded params
  │             + automation via setValueAtTime / linearRampToValueAtTime
  │             + start(t) / stop(t)
  └─ startRendering() ──▶ one AudioBuffer of exactly the take's scene duration
```

**Sync is exact by construction, at any render speed.** The video track is
`frameCount / fps` scene-seconds and the audio buffer is `frameCount / fps` scene-seconds,
both derived from the same counter. A 4K take rendering at 8 fps on a laptop produces the
same file as one rendering at 60.

Encoding needs no new mechanism: mediabunny already ships `AudioBufferSource`
(`add(audioBuffer)`, push-style like the video's `VideoSampleSource`), so `encoder.ts` swaps
`MediaStreamAudioTrackSource` for it and `Capture.svelte` deletes `attachAudioTap` /
`releaseAudioTap` and the hand-typed `useAudioListener` return type with them. The offline
render is async and lands inside `isFinalizing`, which exists for exactly this window.

**The cost, stated plainly:** anything that does not go through the registry is invisible to
the recorder and silently absent from the take. A scene mounting a raw `<Audio>`, or calling
`.setVolume()` on a `THREE.Audio` directly, gets no error and no sound in the file. That is
the price of determinism and the reason the registry has to be the only door — it should be
called out in `core/audio/CLAUDE.md` in the same tone as the descriptor contract.

## Positional audio

The registry creates the `THREE.PositionalAudio` and adds it to the target object; games never
write `<Audio>` / `<PositionalAudio>` markup or `oncreate` attach functions again. That deletes
`GlobalAudio.svelte` outright — a 192-line component whose entire job is mounting nine tags —
and it deletes the _pattern_ of `attachRainAudio` / `attachThunderAudio` /
`attachEngineLayer` / the other ten, which exist only to hand a mounted instance back to the
module that mixes it.

`Camera.svelte`'s `<AudioListener />` stays: it is the listener's pose tracking, and the mixer
attaches to it.

The five params in `extensions/sound/soundState.svelte.ts` become **per-sound fields with
engine-wide fallbacks** (above), so `DemoPhysicsBodies.svelte` stops threading four props
through `useSound()` and the two dead exports go.

## Settings and the Studio panel

`settingsState.audio` keeps its shape and its localStorage keys — it is the persisted source of
truth — but `audioActions.setSfxVolume(v)` now writes a gain node instead of a number other
code reads. `musicEnabled` / `ambienceEnabled` / `sfxEnabled` drive `bus.muted`. Master volume
becomes a real setting, which it cannot be today.

**`extensions/sound/` → `extensions/audio/`, and it becomes panel-only**, exactly like
`extensions/skybox/`: its state is engine config (positional fallbacks, bus declarations) that
`AudioRuntime` consumes in every build, so it lives in `core/audio/` and the panel is just
another caller. The row in `extensions/CLAUDE.md`'s inventory should end up reading like
skybox's. The panel gains what it could not have before: real bus faders, and a **voice
inspector** — what is playing, on which bus, at what gain — which is the thing that would have
made tuning `carAudio` an afternoon instead of a fortnight.

## carAudio is the spec, not the migration

`TestGame/CLAUDE.md` is explicit that nothing in that scene is engine architecture, and that
boundary holds — `carAudio.ts` is not being ported. It is being used as the **acceptance
test**: the new API is not general-purpose until each of these is expressible without dropping
to raw `THREE.Audio`.

| carAudio does                                                                         | The layer must offer                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| six rpm loops, two crossfaded by tacho, each pitched `rpm/anchor`                     | handles with live `volume` + `rate`, no per-voice `$effect` |
| pops: fuzzy take choice, per-hit volume/rate/lowpass jitter, clones at the firing tip | variant sets + `{ volume, rate, lowpass, at }` on `play()`  |
| `livePops[]` reaped in the tick                                                       | central pooling via `poly`                                  |
| squeal/scrape loops on loudest-source-wins levels                                     | `audible` gating + smoothed `volume`                        |
| scrape shriek deadline-stopped at 0.22–0.72 s                                         | `play(…, { duration })`                                     |
| `parkCarAudio()` on tab hide, `detachCarAudio()` on unmount                           | engine-owned visibility parking + `scope.release()`         |
| 12 attach functions + 20 mounted components                                           | `scope.loop(id, { at })`                                    |
| every voice multiplying `settingsState.audio.sfxVolume`                               | a bus                                                       |

If a row cannot be done cleanly, the API is wrong — not the scene.

## Files

```
core/audio/
  CLAUDE.md             — the contracts (registry is the only door; scene time; no $effect)
  index.ts              — barrel: audio, defineSounds, defineBuses
  types.ts              — SoundDef, BusDef, PlayOptions, VoiceHandle, Scope
  mixer.ts              — the bus graph, routeToBus(), settings ↔ gain wiring
  registry.ts           — defineSounds/defineBuses, loading, variant picking
  voices.ts             — the pool: acquire/release/steal, one-shot reaping
  scheduler.ts          — scene ↔ context time, delayed starts, the recording split
  timeline.ts           — the take recorder (events + epsilon-gated automation)
  render.ts             — OfflineAudioContext replay → AudioBuffer
  AudioRuntime.svelte   — the ONE component: listener hookup + the per-frame task
                          (automation sampling, reaping, loop gating). Replaces GlobalAudio.
  engineSounds.ts       — the engine's own manifest. Data; a game deletes it.
  weatherAudio.ts       — stays, as a thin consumer: no clones, no performance.now(),
                          no pendingThunder array

extensions/audio/       — was extensions/sound/; PANEL-ONLY, like extensions/skybox/
  CLAUDE.md
  AudioExtension.svelte — bus faders (real gain), voice inspector, positional fallbacks
```

Deleted: `GlobalAudio.svelte`, `globalAudio.svelte.ts` (`soundTriggers` / `soundActions`),
`extensions/sound/{types,soundState.svelte,useSound,index}.ts`.

Call sites to update: `soundActions.playClick()` → `audio.play('click')` in five HUD files
plus `extensions/scene/scene.svelte.ts:46`'s `playSwoosh()`; `core/index.ts:12`'s export;
`DemoPhysicsBodies.svelte`'s `useSound()` props.

## Considered and rejected

- **Realtime-locked takes** (pace the take to wall clock, pad with duplicate frames when the
  render falls behind). Sync is exact and it is far less work — but it throws away the whole
  point of the offline path, which is that a heavy scene renders a _clean_ file on a machine
  that cannot draw it at speed. It makes the video worse to make the audio right.
- **Resampling the wall-clock tap to fit the video's duration.** Time-compressing `W` wall
  seconds into `N/fps` scene seconds pitch-shifts everything — a click becomes a tick an
  octave up. Seductive because it is a two-line fix; wrong for any sound with a fixed
  character.
- **Suspending the `AudioContext` on held frames** to make the live graph follow the take's
  clock. `suspend()`/`resume()` is coarse, clicks, and would still not make a _rendered_ frame
  cost exactly `1/fps` of audio.
- **An AudioWorklet mixer.** Reimplements on the main thread's behalf what `GainNode` /
  `PannerNode` / `BiquadFilterNode` already do natively on the audio thread.
- **Keeping `soundTriggers` as a compatibility shim.** Six call sites. Keeping it means
  keeping the counter bug and a second door past the registry, which the offline render
  cannot see through.
- **WebGPU compute audio.** Already argued and rejected in `carAudio.ts`'s header — the
  three.js example is offline batch (process a whole buffer, read it back, play it once),
  while a live-pitched voice needs per-frame rate changes, which `setPlaybackRate` already
  does on the audio thread with no readback.

## Verify before building

Four things this plan asserts that should be confirmed in a browser first — none is a
blocker, all would change details:

1. **`AudioBuffer` reuse across contexts.** The spec does not bind a buffer to its creating
   context, and the offline render depends on reusing the registry's decoded buffers rather
   than decoding twice. Confirm in Chrome and Firefox.
2. **HRTF panning + listener automation in `OfflineAudioContext`.** `PannerNode` is fine;
   the risk is `context.listener`'s `positionX`/`orientationX` **AudioParams**, which Firefox
   supported late (the deprecated `setPosition()` has no offline equivalent — you cannot
   sample it during a render). If it is unavailable, positional voices in a take fall back to
   equalpower, or the layer bakes panning into per-voice stereo gain.
3. **mediabunny accepting the whole audio track after all video frames.** `AudioBufferSource`
   is push-style, but the muxer may prefer interleaved input. A 60 s stereo f32 buffer at
   48 kHz is ~23 MB, so chunking the `add()` calls is available if it matters.
4. **Offline render wall-cost at the 60 s cap.** `startRendering()` is normally many times
   realtime, but it lands inside `isFinalizing` next to the video drain — worth measuring so
   the panel's status line is honest about it.

## Implementation order

Each step leaves the app working.

1. ~~**Mixer.**~~ **DONE.** Bus graph + `routeToBus`, `settingsState.audio` drives real
   gains, `masterVolume` added (settings, HUD and Studio panel). `GlobalAudio` keeps its
   tags; six per-voice volume effects became one sync effect, and the hand-multiplied
   volumes and `if (…Enabled)` guards came out of `GlobalAudio` and `weatherAudio`. The
   stale-click bug fell out with the sfx guard. **Not yet runtime-verified by ear.**
2. ~~**Registry + voices.**~~ **DONE.** `types.ts` / `registry.ts` / `voices.ts` /
   `audio.ts` / `engineSounds.ts` / `AudioRuntime.svelte` / `index.ts`.
   `GlobalAudio.svelte` and `globalAudio.svelte.ts` deleted; the six call sites are
   `engineSounds.click.play()` / `.swoosh.play()`. `weatherAudio` is a pure consumer —
   no THREE.Audio, no take picker, no clones, and `pendingThunder` + `performance.now()`
   are gone (the flight time is a scheduled `delay`). **Not yet runtime-verified by ear.**
3. ~~**Scene clock.**~~ **DONE.** `scheduler.ts`: scene ↔ context conversion, the anchor
   (re-glued per frame in realtime, frozen on the handover into a take), and
   `schedulerDrift()`. `PlayOptions.delay` / `duration` are scene seconds.
   `performance.now()` left `weatherAudio` in step 2 and its "one sanctioned use" note is
   gone from `core/utils/CLAUDE.md`.

   **Behaviour in a normal session is unchanged, by construction** — the scene↔context map
   has slope 1, so intervals carry over exactly and only the origin moves. What this buys
   is the explicit unit step 5 replays against, plus the drift measurement.

4. ~~**Rename + panel.**~~ **DONE.** `extensions/sound/` → `extensions/audio/`, panel-only
   (`types.ts` + `AudioExtension.svelte`, no barrel — the `extensions/skybox/` shape).
   Master fader + bus faders through `audioActions` (`on:change`, not the `bind:` the old
   panel used), positional fallbacks with a live `refreshPositional()`, and an inspector
   button that logs buses, voices and `schedulerDrift()`. `soundState.svelte.ts`,
   `useSound.ts` and `index.ts` deleted, along with `listenerEnabled` and
   `defaultSoundState()`, which nothing ever read. `DemoPhysicsBodies.svelte` moved off
   `useSound()` + `<PositionalAudio>` onto a scene-declared sound and an `audio.scope()` —
   the last hand-multiplied `sfxVolume` in the app, and the first real consumer of
   positional `at`. **Not yet runtime-verified by ear.**
5. ~~**Timeline + offline render.**~~ **DONE.** `timeline.ts` (pure storage: events +
   epsilon-gated automation, stamped in scene seconds) and `render.ts` (the
   OfflineAudioContext replay → one AudioBuffer of exactly the take's scene length). The
   driving half lives in `voices.ts`, which owns the live voice set: `armRecording`
   snapshots the bus graph and every bed already sounding (cursor included), every
   start/pause/resume/steal/release path stamps the take, and `AudioRuntime`'s task samples
   automation LAST so it records what consumers just wrote. `audio.recording` is the door
   (`arm` / `render` / `discard`). `capture/` arms at the same synchronous instant it
   claims the engine clock, renders with `frameCount / fps` inside `isFinalizing`, and
   mediabunny's `AudioBufferSource` replaced the `MediaStreamAudioTrackSource` tap —
   `useAudioListener` and the hand-typed return left `Capture.svelte` with it. The live-tap
   section of `capture/CLAUDE.md` is now "Audio: a deterministic offline render", the
   history of a fixed bug. **Not yet runtime-verified by ear.**
6. ~~**Acceptance pass.**~~ **DONE.** Every row of the table above is expressed
   through the registry — and the sounds stay in the GAME: TestGame declares its own
   manifest (`audio/carSounds.ts` — urls, gains, positional params, pool depth),
   `core/audio/` remains mechanism only. Bed = six `scope.loop` handles with live
   `volume`/`rate` and pause/resume on crossfade weight, no per-voice `$effect`; pops
   = two energy-split ids (a variant set draws at random — the crossover is
   energy-driven) + `{ volume, rate, lowpass, at, position }` per play; overlap =
   `poly` pools (the clone lists and their reaping are gone); squeal/scrape =
   `busAudible` gating + slewed handle volume; the shriek deadline = `{ duration }`
   — which the pass caught recording WRONG (duration one-shots never stamped their
   stop, so takes replayed the whole 3 s buffer — fixed in voices.ts); lifecycle =
   the scope + engine-owned parking (`parkCarAudio` deleted); the sfx bus replaces
   both hand-multiplied `master` locals. The API grew `PlayOptions.position` and
   `VoiceHandle.duration` (the crank-tail fade reads the latter). Two more deltas
   the ears caught on first drive, both specific to the per-play-positioned pooled
   one-shots: pool depth 4 chopped limiter-stutter strings and multi-hit grinds
   (the old clone lists were unbounded — now 8), and a pooled positional voice
   opened from its PREVIOUS play's panner spot (three pushes the panner only while
   `isPlaying`, a frame late — the registry now lands it at play time, and seeds the
   take's opening automation the same way). Third, the loud one: the old clones'
   panners never saw the mounted ref 10/rolloff 1.4 (`Audio.clone()` copies no
   panner param), so pops/hits ran at panner defaults ≈ 1/distance — the gains were
   tuned against that, and the hit declarations now declare it (`HIT_POS`, ref 1 /
   rolloff 1) instead of the car's CAR_POS. **Not yet runtime-verified by ear.**

```

```
