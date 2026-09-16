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
	type AudioListener as ThreeAudioListener
} from 'three';
import { logSound } from '$extensions/logger';
import { routeToBus } from './mixer';
import { getDef, pickBuffer } from './registry';
import type { PlayOptions, VoiceHandle } from './types';

/**
 * Engine-wide positional fallbacks, used for any field a declaration omits. These moved
 * here from `extensions/sound/soundState.svelte.ts` — they are engine config that the
 * runtime consumes in every build, so the Studio panel is just another caller.
 */
export const positionalDefaults = {
	ref: 5,
	rolloff: 1.5,
	max: 80,
	panningModel: 'HRTF' as PanningModelType
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
	if (audio instanceof ThreePositionalAudio) {
		audio.setRefDistance(def.ref ?? positionalDefaults.ref);
		audio.setRolloffFactor(def.rolloff ?? positionalDefaults.rolloff);
		audio.setMaxDistance(def.max ?? positionalDefaults.max);
		audio.panner.panningModel = def.panningModel ?? positionalDefaults.panningModel;
	}
	// Keep the editor tree clean — these are engine objects, not scene content.
	audio.userData.hideInTree = true;
	audio.userData.selectable = false;
	routeToBus(audio, def.bus ?? 'sfx');

	const voice: Voice = { soundId, audio, freeAt: 0 };
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

	if (options.at) {
		if (audio instanceof ThreePositionalAudio) options.at.add(audio);
		else logSound.warn(`Audio: "${voice.soundId}" was placed with \`at\` but is not positional`);
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
	pause() {
		if (voice.audio.isPlaying) voice.audio.pause();
	},
	resume() {
		if (!voice.audio.isPlaying && voice.audio.buffer) voice.audio.play();
	},
	stop() {
		if (voice.audio.source) voice.audio.stop();
		voice.freeAt = 0;
		release(voice);
	}
});

const release = (voice: Voice): void => {
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

	const delay = Math.max(0, options.delay ?? 0);
	voice.audio.play(delay);

	const startedAt = now() + delay;
	const natural = voice.audio.buffer ? voice.audio.buffer.duration / voice.audio.playbackRate : 0;
	const span = options.duration !== undefined ? Math.min(options.duration, natural) : natural;
	if (options.duration !== undefined && voice.audio.source) {
		// `Audio.source` is typed as the base AudioNode; it is always a BufferSource for
		// a buffer-backed voice, which is the only kind the registry makes.
		(voice.audio.source as AudioBufferSourceNode).stop(startedAt + span);
	}
	voice.freeAt = startedAt + span;

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
	if (!options.paused) voice.audio.play(Math.max(0, options.delay ?? 0));
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

/** How many voices are live. The Studio panel's inspector grows from this. */
export const voiceCount = (): number => live.size;
