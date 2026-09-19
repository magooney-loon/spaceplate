// The THREE.Audio objects, pooled, and the handles games hold. The engine creates every
// voice — games never mount <Audio>/<PositionalAudio>. One-shots are pooled (a pool
// `poly` deep, handed back by finishing); loops are long-lived and the caller stops them.

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
 * Engine-wide positional fallbacks for any field a declaration omits.
 *
 * Deliberately plain, not `$state`: read inside `createVoice()`, which can run from an
 * `$effect`, and reactive state there would make every sound-playing effect depend on
 * the tuning knobs. The Studio panel is the only writer and calls `refreshPositional()`
 * itself after moving one.
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
	audio.setDistanceModel(def.distanceModel ?? 'inverse');
	// Reset to the PannerNode's own omnidirectional defaults when undeclared.
	const cone = def.cone ?? { inner: 360, outer: 360, outerGain: 0 };
	audio.setDirectionalCone(cone.inner, cone.outer, cone.outerGain);
};

/** Scratch for placing a positional voice's panner at configure time. */
const worldPos = new Vector3();
const worldQuat = new Quaternion();
const worldScale = new Vector3();
const worldFwd = new Vector3();

/**
 * Land a positional voice's panner on its current world pose immediately. Three only
 * pushes a positional voice's panner while `isPlaying`, one rendered frame later — every
 * path that starts a voice needs this, or it speaks its first frame from the wrong spot
 * (world origin for a fresh voice, the previous play's spot for a pooled one, or the
 * pause point for a resumed loop).
 */
const landPanner = (audio: ThreeAudio<AudioNode>): void => {
	if (!(audio instanceof ThreePositionalAudio)) return;
	const panner = audio.panner;
	if (!panner.positionX) return;
	audio.updateWorldMatrix(true, false);
	audio.matrixWorld.decompose(worldPos, worldQuat, worldScale);
	// Three's rest facing is local +Z.
	worldFwd.set(0, 0, 1).applyQuaternion(worldQuat);
	const at = audio.context.currentTime;
	panner.positionX.setValueAtTime(worldPos.x, at);
	panner.positionY.setValueAtTime(worldPos.y, at);
	panner.positionZ.setValueAtTime(worldPos.z, at);
	panner.orientationX.setValueAtTime(worldFwd.x, at);
	panner.orientationY.setValueAtTime(worldFwd.y, at);
	panner.orientationZ.setValueAtTime(worldFwd.z, at);
};

/** Re-apply positional params to every live voice. The Studio panel calls this after
 * moving a fallback, so a per-sound override still wins. */
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
	 * Context time this voice stops being busy. `Infinity` while looping. Not derivable
	 * from `audio.isPlaying`: three's `stop(delay)` flips that false immediately and
	 * defers only the source's own stop, so a `duration`-limited voice would look free
	 * while still ringing and stealing it would orphan the live BufferSource.
	 */
	freeAt: number;
	/** Cutoff this voice was configured with, kept so a take armed mid-flight can record it. */
	lowpass: number | null;
	/** This voice's entry in the take being recorded, or null when nothing is recording. */
	rec: RecordedVoice | null;
	/** The one handle for this voice, made on first play and reused — a scope holds every
	 * handle it's given until release, so a fresh object per play would grow unbounded. */
	handle: VoiceHandle | null;
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

const createVoice = (soundId: string, positional: boolean): Voice | null => {
	if (!listener) return null;
	const def = getDef(soundId);
	if (!def) return null;

	const audio = positional ? new ThreePositionalAudio(listener) : new ThreeAudio(listener);
	if (audio instanceof ThreePositionalAudio) applyPositional(audio, def);
	audio.userData.hideInTree = true;
	audio.userData.selectable = false;
	routeToBus(audio, def.bus ?? 'sfx');

	const voice: Voice = { soundId, audio, freeAt: 0, lowpass: null, rec: null, handle: null };
	live.add(voice);
	return voice;
};

/** Apply everything that must be set before `play()`, since `play()` reads these fields. */
const configure = (voice: Voice, options: PlayOptions, loop: boolean): boolean => {
	const def = getDef(voice.soundId);
	const buffer = pickBuffer(voice.soundId);
	if (!def || !buffer) return false;
	const { audio } = voice;

	audio.setBuffer(buffer);
	audio.setLoop(loop);
	audio.setVolume((def.volume ?? 1) * (options.volume ?? 1));
	audio.setPlaybackRate(options.rate ?? 1);
	// Through the setter: `play()` re-applies `this.detune` and the field is read-only.
	audio.setDetune(options.detune ?? 0);

	// A fresh filter node per voice — `Audio.copy()` shares the template's filter array
	// by reference, so reusing one would couple every clap's cutoff to the last one set.
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
			if (options.position) audio.position.set(...options.position);
			else audio.position.set(0, 0, 0);
			landPanner(audio);
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
		noteStop(voice.rec, sceneNow());
		voice.rec = null;
	},
	resume() {
		if (voice.audio.isPlaying || !voice.audio.buffer) return;
		landPanner(voice.audio);
		voice.audio.play();
		// Resumes mid-buffer: stamp the start back by the cursor and let render.ts seek.
		recordStart(voice, sceneNow() - bufferOffset(voice.audio));
	},
	stop() {
		if (voice.audio.source) voice.audio.stop();
		voice.freeAt = 0;
		release(voice);
	}
});

const release = (voice: Voice): void => {
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
		voice = pool.reduce((a, b) => (a.freeAt <= b.freeAt ? a : b));
		if (voice.audio.source) voice.audio.stop();
	}
	if (!configure(voice, options, false)) return null;

	// `delay` is scene seconds; clamped at 0 since the anchor can sit a fraction behind
	// on the frame a take claims the clock.
	const startScene = sceneNow() + Math.max(0, options.delay ?? 0);
	const startedAt = toContextTime(startScene);
	voice.audio.play(Math.max(0, startedAt - now()));
	// Stamped at the scheduled scene time, not now.
	recordStart(voice, startScene);

	const natural = voice.audio.buffer ? voice.audio.buffer.duration / voice.audio.playbackRate : 0;
	const span = options.duration !== undefined ? Math.min(options.duration, natural) : natural;
	if (options.duration !== undefined && voice.audio.source) {
		(voice.audio.source as AudioBufferSourceNode).stop(startedAt + span);
	}
	voice.freeAt = startedAt + span;
	// A `duration` one-shot's deadline is knowable at start: stamp it now, since nothing
	// reaps a pooled voice when freeAt passes and a later noteStop would never land.
	if (options.duration !== undefined && voice.rec && voice.rec.stopScene === null) {
		voice.rec.stopScene = startScene + span;
	}

	return (voice.handle ??= makeHandle(voice));
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
	return (voice.handle ??= makeHandle(voice));
};

/** Stop everything, or everything of one sound. */
export const stopAllVoices = (soundId?: string): void => {
	for (const voice of [...live]) {
		if (soundId && voice.soundId !== soundId) continue;
		if (voice.audio.source) voice.audio.stop();
		release(voice);
	}
};

/** Tab-hide parking: rAF stops when the tab hides but the AudioContext does not, so a
 * loop would otherwise drone at its last pitch behind a hidden tab. Loops only — a
 * one-shot in flight is shorter than the blink that hid the tab. */
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
		if (live.has(voice) && !voice.audio.isPlaying) {
			landPanner(voice.audio);
			voice.audio.play();
		}
	}
	parked.length = 0;
};

/** Detach finished pooled positional one-shots from their `at` parent, so a slot doesn't
 * pin a dead subtree after its scene unmounts. Called per frame by AudioRuntime's task.
 * Loops are not pooled; their handle or scope detaches them. */
export const reapVoices = (): void => {
	for (const pool of pools.values()) {
		for (const voice of pool) {
			if (voice.audio.parent && !isBusy(voice)) voice.audio.removeFromParent();
		}
	}
};

// ── Take recording ──────────────────────────────────────────────────────────────
// The driving half of timeline.ts, here because this module owns the live voice set.
// Inert unless a capture take has armed it.

/**
 * Three's playback cursor for a voice, in buffer seconds. Reaches into `_progress` /
 * `_startedAt` (the same fields `Audio.pause()` uses to resume). Needed so a bed already
 * looping when a take arms mid-session doesn't render from silence or a sample-0 jump.
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
				distanceModel: audio.panner.distanceModel,
				cone: {
					inner: audio.panner.coneInnerAngle,
					outer: audio.panner.coneOuterAngle,
					outerGain: audio.panner.coneOuterGain
				}
			}
		: null;

/** Sample a positional voice's world pose into its take record — position, plus facing if directional. */
const samplePose = (voice: Voice, rec: RecordedVoice, sceneTime: number): void => {
	if (!rec.pos) return;
	voice.audio.updateWorldMatrix(true, false);
	voice.audio.matrixWorld.decompose(worldPos, worldQuat, worldScale);
	samplePosition(rec.pos.x, sceneTime, worldPos.x);
	samplePosition(rec.pos.y, sceneTime, worldPos.y);
	samplePosition(rec.pos.z, sceneTime, worldPos.z);
	if (rec.orient) {
		worldFwd.set(0, 0, 1).applyQuaternion(worldQuat);
		sampleVolume(rec.orient.x, sceneTime, worldFwd.x);
		sampleVolume(rec.orient.y, sceneTime, worldFwd.y);
		sampleVolume(rec.orient.z, sceneTime, worldFwd.z);
	}
};

/**
 * Enter a voice into the take. `startScene` may sit before the take armed, for a bed
 * already in flight — render.ts clips that against the take window.
 */
const recordStart = (voice: Voice, startScene: number): void => {
	if (!isRecordingAudio() || !voice.audio.buffer) return;
	// A pooled voice can be stolen mid-take — close the previous entry first.
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
	// Seed automation at the start, not the next frame's sample, so a short one-shot
	// doesn't open its take segment at render.ts's gain-1/rate-1 fallback.
	if (voice.rec) {
		sampleVolume(voice.rec.volume, startScene, voice.audio.getVolume());
		sampleRate(voice.rec.rate, startScene, voice.audio.playbackRate);
		samplePose(voice, voice.rec, startScene);
	}
};

/** Per-bus gain curves, index-aligned with the take's bus list. */
let busCurves: { id: BusId; curve: Curve }[] = [];

const listenerPos = new Vector3();
const listenerQuat = new Quaternion();
const listenerScale = new Vector3();
const listenerFwd = new Vector3();
const listenerUp = new Vector3();

/** Begin recording: snapshot the bus graph and every voice already sounding, then the
 * per-frame sampler takes over. */
export const armRecording = (sceneTime: number): void => {
	armTimeline(sceneTime);
	busCurves = [];
	for (const bus of busGraph()) {
		const curve = noteBus(bus.id, bus.parent);
		if (curve) busCurves.push({ id: bus.id, curve });
	}
	for (const voice of live) {
		if (!voice.audio.isPlaying) continue;
		// Started before the take: stamp at `now - offset` so the replay seeks into the
		// buffer by exactly what's already been heard.
		recordStart(voice, sceneTime - bufferOffset(voice.audio));
	}
	tickRecording(sceneTime);
};

export const disarmRecording = (): RecordedTake | null => {
	for (const voice of live) voice.rec = null;
	busCurves = [];
	return disarmTimeline();
};

/** Sample every automated parameter for this frame. Epsilon-gated inside timeline.ts. */
export const tickRecording = (sceneTime: number): void => {
	if (!isRecordingAudio()) return;

	for (const { id, curve } of busCurves) sampleVolume(curve, sceneTime, busGain(id));

	for (const voice of live) {
		const rec = voice.rec;
		if (!rec) continue;
		sampleVolume(rec.volume, sceneTime, voice.audio.getVolume());
		sampleRate(rec.rate, sceneTime, voice.audio.playbackRate);
		samplePose(voice, rec, sceneTime);
	}

	const curves = listenerCurves();
	if (curves && listener) {
		listener.matrixWorld.decompose(listenerPos, listenerQuat, listenerScale);
		// Same basis three's own AudioListener feeds Web Audio: forward -Z, up = object up.
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

/** What is playing, on which bus, at what gain — the Studio panel's inspector. A
 * snapshot taken on demand, not a `$state` mirror updated per frame. */
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
