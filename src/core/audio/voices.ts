// VOICES — the THREE.Audio objects, pooled, and the handles games hold.
//
// The engine creates every voice. Games never mount <Audio>/<PositionalAudio> and never
// write an `oncreate` attach function: that plumbing existed only to hand a mounted
// instance back to the module that mixes it, and it is what made the registry unable to
// see (and step 5's offline render unable to reproduce) anything a scene played.
//
// ONE-SHOTS ARE POOLED, LOOPS ARE NOT. A one-shot draws from a pool `poly` deep and is
// handed back by finishing; a loop is a long-lived thing the caller holds and stops.

import {
	Audio as ThreeAudio,
	PositionalAudio as ThreePositionalAudio,
	Quaternion,
	Vector3,
	type AudioListener as ThreeAudioListener
} from 'three';
import { logSound } from '$extensions/logger';
import { busGain, busGraph, routeToBus } from './mixer';
import { getDef, pickBuffer } from './registry';
import { sceneNow, toContextTime } from './scheduler';
import {
	armTimeline,
	disarmTimeline,
	isRecordingAudio,
	listenerCurves,
	noteBus,
	noteStart,
	noteStop,
	sampleVolume,
	samplePosition,
	sampleRate,
	type Curve,
	type RecordedTake,
	type RecordedVoice
} from './timeline';
import type { BusId, PlayOptions, SoundDef, VoiceHandle } from './types';

/**
 * Engine-wide positional fallbacks, used for any field a declaration omits. These moved
 * here from `extensions/sound/soundState.svelte.ts` — they are engine config that the
 * runtime consumes in every build, so the Studio panel is just another caller.
 *
 * DELIBERATELY PLAIN, not `$state`: it is read inside `createVoice()`, which runs from
 * whatever called `play()` — sometimes an `$effect`. Reactive state read there would make
 * every sound-playing effect depend on the tuning knobs. The only writer is the Studio
 * panel, which drives the widgets' own state and calls `refreshPositional()` itself.
 */
export const positionalDefaults = {
	ref: 5,
	rolloff: 1.5,
	max: 80,
	panningModel: 'HRTF' as PanningModelType
};

const applyPositional = (audio: ThreePositionalAudio, def: SoundDef): void => {
	audio.setRefDistance(def.ref ?? positionalDefaults.ref);
	audio.setRolloffFactor(def.rolloff ?? positionalDefaults.rolloff);
	audio.setMaxDistance(def.max ?? positionalDefaults.max);
	audio.panner.panningModel = def.panningModel ?? positionalDefaults.panningModel;
};

/**
 * Re-apply the positional params to every live voice. The Studio panel calls this after
 * moving a fallback — a tuning slider you cannot hear is not a tuning slider.
 *
 * Reading through `def ?? positionalDefaults` again is what keeps per-sound overrides
 * winning: a declaration that set its own `ref` is unaffected by the fallback moving.
 */
export const refreshPositional = (): void => {
	for (const voice of live) {
		if (!(voice.audio instanceof ThreePositionalAudio)) continue;
		const def = getDef(voice.soundId);
		if (def) applyPositional(voice.audio, def);
	}
};

type Voice = {
	readonly soundId: string;
	readonly audio: ThreeAudio | ThreePositionalAudio;
	/**
	 * Context time at which this voice stops being busy. `Infinity` while looping.
	 *
	 * NOT DERIVABLE FROM `audio.isPlaying`, and that is the whole reason this field
	 * exists: three's `stop(delay)` flips `isPlaying` to false IMMEDIATELY and defers
	 * only the source's own stop, so a `duration`-limited voice looks free while it is
	 * still ringing. Stealing it there would orphan the live BufferSource — `play()`
	 * overwrites `this.source`, and the old one keeps sounding through the shared gain
	 * with nothing holding a reference to stop it.
	 */
	freeAt: number;
	/** Cutoff this voice was configured with, kept so a take armed mid-flight can record it. */
	lowpass: number | null;
	/** This voice's entry in the take being recorded, or null when nothing is recording. */
	rec: RecordedVoice | null;
};

let listener: ThreeAudioListener | null = null;
/** One-shot pools, keyed `soundId:g|p` — a positional voice is a different class. */
const pools = new Map<string, Voice[]>();
/** Every live voice, pooled or not. Tab-hide parking and `stopAll()` walk this. */
const live = new Set<Voice>();

export const attachListener = (audioListener: ThreeAudioListener): void => {
	listener = audioListener;
};

const now = (): number => listener?.context.currentTime ?? 0;

const isBusy = (voice: Voice): boolean => voice.audio.isPlaying || now() < voice.freeAt;

/** Scratch for placing a positional voice's panner at configure time. */
const worldPos = new Vector3();

const createVoice = (soundId: string, positional: boolean): Voice | null => {
	if (!listener) return null;
	const def = getDef(soundId);
	if (!def) return null;

	const audio = positional ? new ThreePositionalAudio(listener) : new ThreeAudio(listener);
	if (audio instanceof ThreePositionalAudio) applyPositional(audio, def);
	// Keep the editor tree clean — these are engine objects, not scene content.
	audio.userData.hideInTree = true;
	audio.userData.selectable = false;
	routeToBus(audio, def.bus ?? 'sfx');

	const voice: Voice = { soundId, audio, freeAt: 0, lowpass: null, rec: null };
	live.add(voice);
	return voice;
};

/** Apply everything that must be set BEFORE `play()`, since `play()` reads these fields. */
const configure = (voice: Voice, options: PlayOptions, loop: boolean): boolean => {
	const def = getDef(voice.soundId);
	const buffer = pickBuffer(voice.soundId);
	if (!def || !buffer) return false;
	const { audio } = voice;

	audio.setBuffer(buffer);
	audio.setLoop(loop);
	audio.setVolume((def.volume ?? 1) * (options.volume ?? 1));
	audio.setPlaybackRate(options.rate ?? 1);
	// Through the setter, not the field: `play()` re-applies `this.detune` to the new
	// source, and the field is declared read-only.
	audio.setDetune(options.detune ?? 0);

	// A FRESH filter node per voice — `Audio.copy()` shares the template's filter array
	// by reference, so reusing one would couple every clap's cutoff to the last one set.
	// Cleared explicitly when unasked: a pooled voice must not inherit the previous play's.
	if (options.lowpass !== undefined) {
		const filter = audio.context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = options.lowpass;
		audio.setFilters([filter]);
	} else if (audio.filters.length > 0) {
		audio.setFilters([]);
	}
	voice.lowpass = options.lowpass ?? null;

	if (options.at) {
		if (audio instanceof ThreePositionalAudio) {
			options.at.add(audio);
			// A per-play offset inside the parent (an exhaust tip, a hull contact). Reset
			// when absent — a pooled voice must not inherit the previous play's spot.
			if (options.position) audio.position.set(...options.position);
			else audio.position.set(0, 0, 0);
			// Land the panner on the world position NOW, as a real event the next
			// updateMatrixWorld ramp anchors to. Three only pushes a positional voice's
			// panner while `isPlaying` — one rendered frame LATER — so without this a fresh
			// voice speaks its first frame from the WORLD ORIGIN (the old clone artifact)
			// and, worse, a POOLED one from wherever its previous play left the params:
			// full presence from the wrong tip.
			const panner = audio.panner;
			if (panner.positionX) {
				audio.getWorldPosition(worldPos);
				const at = audio.context.currentTime;
				panner.positionX.setValueAtTime(worldPos.x, at);
				panner.positionY.setValueAtTime(worldPos.y, at);
				panner.positionZ.setValueAtTime(worldPos.z, at);
			}
		} else {
			logSound.warn(`Audio: "${voice.soundId}" was placed with \`at\` but is not positional`);
		}
	}
	return true;
};

const makeHandle = (voice: Voice): VoiceHandle => ({
	soundId: voice.soundId,
	get volume() {
		return voice.audio.getVolume();
	},
	set volume(v: number) {
		voice.audio.setVolume(v);
	},
	get rate() {
		return voice.audio.playbackRate;
	},
	set rate(v: number) {
		voice.audio.setPlaybackRate(v);
	},
	get playing() {
		return voice.audio.isPlaying;
	},
	get duration() {
		return voice.audio.buffer?.duration ?? 0;
	},
	pause() {
		if (!voice.audio.isPlaying) return;
		voice.audio.pause();
		// Load-bearing during a take: the rain bed pauses and resumes as weather moves,
		// and both engine beds do on a settings change. Without the pair of records the
		// replay would run them straight through.
		noteStop(voice.rec, sceneNow());
		voice.rec = null;
	},
	resume() {
		if (voice.audio.isPlaying || !voice.audio.buffer) return;
		voice.audio.play();
		// Resumes mid-buffer, so stamp the start back by the cursor and let render.ts
		// seek: `play()` has just set `_startedAt`, leaving `bufferOffset` at `_progress`.
		recordStart(voice, sceneNow() - bufferOffset(voice.audio));
	},
	stop() {
		if (voice.audio.source) voice.audio.stop();
		voice.freeAt = 0;
		release(voice);
	}
});

const release = (voice: Voice): void => {
	// Every stop path funnels through here, so this is the one place a take needs.
	noteStop(voice.rec, sceneNow());
	voice.rec = null;
	live.delete(voice);
	voice.audio.removeFromParent();
	const key = poolKey(voice.soundId, voice.audio instanceof ThreePositionalAudio);
	const pool = pools.get(key);
	if (pool) {
		const i = pool.indexOf(voice);
		if (i >= 0) pool.splice(i, 1);
	}
};

const poolKey = (soundId: string, positional: boolean): string =>
	`${soundId}:${positional ? 'p' : 'g'}`;

/** A one-shot: pooled, `poly` deep, oldest stolen when every slot is busy. */
export const playOneShot = (soundId: string, options: PlayOptions = {}): VoiceHandle | null => {
	const def = getDef(soundId);
	if (!def || !listener) return null;

	const positional = options.at !== undefined;
	const key = poolKey(soundId, positional);
	const pool = pools.get(key) ?? [];
	if (!pools.has(key)) pools.set(key, pool);

	const poly = Math.max(1, def.poly ?? 1);
	let voice = pool.find((v) => !isBusy(v));

	if (!voice && pool.length < poly) {
		voice = createVoice(soundId, positional) ?? undefined;
		if (voice) pool.push(voice);
	}
	if (!voice) {
		// Every slot busy: steal the one that frees soonest. `poly: 1` makes this the
		// stop-and-restart the old `playOneShot` did.
		voice = pool.reduce((a, b) => (a.freeAt <= b.freeAt ? a : b));
		if (voice.audio.source) voice.audio.stop();
	}
	if (!configure(voice, options, false)) return null;

	// `delay` is SCENE seconds: converted here, in the one place that knows about both
	// clocks. Three's `play()` wants an offset from `context.currentTime`, so the absolute
	// context time comes back as a relative one. Clamped at 0 — the anchor can sit a
	// fraction behind on the frame a take claims the clock.
	const startScene = sceneNow() + Math.max(0, options.delay ?? 0);
	const startedAt = toContextTime(startScene);
	voice.audio.play(Math.max(0, startedAt - now()));
	// Stamped at the SCHEDULED scene time, not now: a thunder clap eight seconds out
	// belongs eight seconds into the take, wherever the live monitor happened to put it.
	recordStart(voice, startScene);

	const natural = voice.audio.buffer ? voice.audio.buffer.duration / voice.audio.playbackRate : 0;
	const span = options.duration !== undefined ? Math.min(options.duration, natural) : natural;
	if (options.duration !== undefined && voice.audio.source) {
		// `Audio.source` is typed as the base AudioNode; it is always a BufferSource for
		// a buffer-backed voice, which is the only kind the registry makes. `span` needs no
		// conversion: the scene↔context map has slope 1, so intervals carry over unchanged.
		(voice.audio.source as AudioBufferSourceNode).stop(startedAt + span);
	}
	voice.freeAt = startedAt + span;
	// A `duration` one-shot's deadline is knowable at START, so stamp it on the take
	// record now: nothing reaps a pooled voice when freeAt passes, so a later noteStop
	// would never land and the replay would run the buffer to its natural end — a 3 s
	// scrape droning under a 0.3 s hit (found by the carAudio acceptance pass).
	if (options.duration !== undefined && voice.rec && voice.rec.stopScene === null) {
		voice.rec.stopScene = startScene + span;
	}

	return makeHandle(voice);
};

/** A loop: its own voice, alive until the handle (or its scope) stops it. */
export const startLoop = (soundId: string, options: PlayOptions = {}): VoiceHandle | null => {
	const voice = createVoice(soundId, options.at !== undefined);
	if (!voice) return null;
	if (!configure(voice, options, true)) {
		release(voice);
		return null;
	}
	voice.freeAt = Infinity;
	if (!options.paused) {
		const startScene = sceneNow() + Math.max(0, options.delay ?? 0);
		voice.audio.play(Math.max(0, toContextTime(startScene) - now()));
		recordStart(voice, startScene);
	}
	return makeHandle(voice);
};

/** Stop everything, or everything of one sound. */
export const stopAllVoices = (soundId?: string): void => {
	for (const voice of [...live]) {
		if (soundId && voice.soundId !== soundId) continue;
		if (voice.audio.source) voice.audio.stop();
		release(voice);
	}
};

/**
 * Tab-hide parking. rAF stops when the tab hides but the AudioContext does not, so a
 * bed drones at its last pitch behind a hidden tab — found once per scene that owns a
 * loop (CarEngineAudio.svelte), so the engine owns it now.
 *
 * Loops only: a one-shot in flight is shorter than the blink that hid the tab.
 */
const parked: Voice[] = [];

export const parkVoices = (): void => {
	if (parked.length > 0) return;
	for (const voice of live) {
		if (voice.freeAt === Infinity && voice.audio.isPlaying) {
			voice.audio.pause();
			parked.push(voice);
		}
	}
};

export const unparkVoices = (): void => {
	for (const voice of parked) {
		if (live.has(voice) && !voice.audio.isPlaying) voice.audio.play();
	}
	parked.length = 0;
};

// ── Take recording ──────────────────────────────────────────────────────────────
//
// The driving half of `timeline.ts`, here because this module owns the live voice set.
// Everything below is inert unless a capture take has armed it.

/**
 * Three's playback cursor for a voice, in buffer seconds.
 *
 * Reaches into `_progress` / `_startedAt`, which are the same fields `Audio.pause()` uses
 * to resume where it left off. Needed for ONE case, and it is not an edge case: the music
 * and ambience beds have been looping since boot, so a take that arms mid-session has no
 * `start` event for them and would render them from silence — or from sample 0, an
 * audible jump — without this.
 *
 * Typed `Audio<AudioNode>` (the DOM global) because a voice may be a `PositionalAudio`,
 * which is not an `Audio<GainNode>` to TypeScript (`getOutput()` overrides to a
 * `PannerNode`) — the same trap `routeToBus` documents. Only base-class members are read.
 */
const bufferOffset = (audio: ThreeAudio<AudioNode>): number => {
	const a = audio as unknown as { _progress?: number; _startedAt?: number };
	const progress = a._progress ?? 0;
	if (!audio.isPlaying || a._startedAt === undefined) return progress;
	const elapsed = (audio.context.currentTime - a._startedAt) * audio.playbackRate;
	const raw = progress + Math.max(0, elapsed);
	const length = audio.buffer?.duration ?? 0;
	return audio.loop && length > 0 ? raw % length : raw;
};

const positionalParamsOf = (audio: ThreeAudio<AudioNode>) =>
	audio instanceof ThreePositionalAudio
		? {
				ref: audio.panner.refDistance,
				rolloff: audio.panner.rolloffFactor,
				max: audio.panner.maxDistance,
				panningModel: audio.panner.panningModel,
				distanceModel: audio.panner.distanceModel
			}
		: null;

/**
 * Enter a voice into the take. `startScene` is absolute scene time and may sit BEFORE the
 * take armed, for a bed already in flight — `render.ts` clips that against the take window.
 */
const recordStart = (voice: Voice, startScene: number): void => {
	if (!isRecordingAudio() || !voice.audio.buffer) return;
	// A pooled voice can be STOLEN mid-take — close the previous entry before the new one
	// takes the slot, or it would run to the end of the take with no stop.
	if (voice.rec) noteStop(voice.rec, sceneNow());
	voice.rec = noteStart({
		soundId: voice.soundId,
		bus: getDef(voice.soundId)?.bus ?? 'sfx',
		buffer: voice.audio.buffer,
		startScene,
		loop: voice.audio.loop,
		detune: voice.audio.detune,
		lowpass: voice.lowpass,
		positional: positionalParamsOf(voice.audio)
	});
	// Seed the automation AT THE START, not at the next frame's sample: render.ts's
	// applyCurve falls back to gain 1 / rate 1 / the origin for an empty curve, and a
	// short one-shot (a pop) must not open its take segment there. The epsilon gate
	// keeps the next per-frame sample from duplicating these.
	if (voice.rec) {
		sampleVolume(voice.rec.volume, startScene, voice.audio.getVolume());
		sampleRate(voice.rec.rate, startScene, voice.audio.playbackRate);
		if (voice.rec.pos) {
			voice.audio.getWorldPosition(worldPos);
			samplePosition(voice.rec.pos.x, startScene, worldPos.x);
			samplePosition(voice.rec.pos.y, startScene, worldPos.y);
			samplePosition(voice.rec.pos.z, startScene, worldPos.z);
		}
	}
};

/** Per-bus gain curves, index-aligned with the take's bus list. */
let busCurves: { id: BusId; curve: Curve }[] = [];

const listenerPos = new Vector3();
const listenerQuat = new Quaternion();
const listenerScale = new Vector3();
const listenerFwd = new Vector3();
const listenerUp = new Vector3();

/**
 * Begin recording. Snapshots the bus graph and every voice already sounding, then the
 * per-frame sampler takes over.
 */
export const armRecording = (sceneTime: number): void => {
	armTimeline(sceneTime);
	busCurves = [];
	for (const bus of busGraph()) {
		const curve = noteBus(bus.id, bus.parent);
		if (curve) busCurves.push({ id: bus.id, curve });
	}
	for (const voice of live) {
		if (!voice.audio.isPlaying) continue;
		// Started before the take: stamp it at `now − offset` so the replay seeks into the
		// buffer by exactly the amount that has already been heard.
		recordStart(voice, sceneTime - bufferOffset(voice.audio));
	}
	tickRecording(sceneTime);
};

export const disarmRecording = (): RecordedTake | null => {
	for (const voice of live) voice.rec = null;
	busCurves = [];
	return disarmTimeline();
};

/** Sample every automated parameter for this frame. Epsilon-gated inside `timeline.ts`. */
export const tickRecording = (sceneTime: number): void => {
	if (!isRecordingAudio()) return;

	for (const { id, curve } of busCurves) sampleVolume(curve, sceneTime, busGain(id));

	for (const voice of live) {
		const rec = voice.rec;
		if (!rec) continue;
		sampleVolume(rec.volume, sceneTime, voice.audio.getVolume());
		sampleRate(rec.rate, sceneTime, voice.audio.playbackRate);
		if (rec.pos) {
			voice.audio.getWorldPosition(listenerPos);
			samplePosition(rec.pos.x, sceneTime, listenerPos.x);
			samplePosition(rec.pos.y, sceneTime, listenerPos.y);
			samplePosition(rec.pos.z, sceneTime, listenerPos.z);
		}
	}

	const curves = listenerCurves();
	if (curves && listener) {
		listener.matrixWorld.decompose(listenerPos, listenerQuat, listenerScale);
		// Same basis three's own AudioListener.updateMatrixWorld feeds the Web Audio
		// listener: forward is -Z, up is the object's up, both in world space.
		listenerFwd.set(0, 0, -1).applyQuaternion(listenerQuat);
		listenerUp.copy(listener.up).applyQuaternion(listenerQuat);
		samplePosition(curves.x, sceneTime, listenerPos.x);
		samplePosition(curves.y, sceneTime, listenerPos.y);
		samplePosition(curves.z, sceneTime, listenerPos.z);
		sampleVolume(curves.fx, sceneTime, listenerFwd.x);
		sampleVolume(curves.fy, sceneTime, listenerFwd.y);
		sampleVolume(curves.fz, sceneTime, listenerFwd.z);
		sampleVolume(curves.ux, sceneTime, listenerUp.x);
		sampleVolume(curves.uy, sceneTime, listenerUp.y);
		sampleVolume(curves.uz, sceneTime, listenerUp.z);
	}
};

/** How many voices are live. */
export const voiceCount = (): number => live.size;

/**
 * What is playing, on which bus, at what gain — the Studio panel's inspector.
 *
 * A SNAPSHOT taken on demand rather than a `$state` mirror updated per frame: a reactive
 * write nobody is looking at is still an invalidation, and this would be one per voice
 * per frame to drive a readout that is only ever glanced at.
 */
export const voiceSnapshot = (): {
	soundId: string;
	bus: BusId;
	volume: number;
	rate: number;
	playing: boolean;
	positional: boolean;
}[] =>
	[...live].map((voice) => ({
		soundId: voice.soundId,
		bus: getDef(voice.soundId)?.bus ?? 'sfx',
		volume: voice.audio.getVolume(),
		rate: voice.audio.playbackRate,
		playing: voice.audio.isPlaying,
		positional: voice.audio instanceof ThreePositionalAudio
	}));
