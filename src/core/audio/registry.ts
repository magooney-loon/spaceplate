// THE REGISTRY — sound declarations and their decoded buffers.
//
// Pure storage and loading; it plays nothing. `audio.ts` is the facade that turns a
// declaration into a voice, and `voices.ts` owns the THREE.Audio objects.
//
// LOADING IS OURS, not Threlte's `<Audio src>` (`useLoader(AudioLoader)`), for two
// reasons: it hands back the decoded `AudioBuffer` directly — which is what the
// `OfflineAudioContext` replay (render.ts) reuses rather than decoding twice — and it gives
// a real per-sound status in place of the hand-maintained `AUDIO_TOTAL = 5 + …` counter
// that used to live in GlobalAudio.svelte.

import { BASE_URL } from '$extensions/settings';
import { logSound } from '$extensions/logger';
import type { SoundDef } from './types';

/** Every declared url is relative to this. */
const SOUND_ROOT = `${BASE_URL}sounds/`;

const defs = new Map<string, SoundDef>();
/** Decoded variants per sound, index-aligned with the declaration's url list. */
const buffers = new Map<string, AudioBuffer[]>();

let context: AudioContext | null = null;

/** Sounds whose load has not settled yet. Drives the summary log and `soundsReady()`. */
let inFlight = 0;
let settled = 0;
let failed = 0;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

const summarize = (): void => {
	if (inFlight > 0) return;
	if (failed > 0) logSound.error(`Audio files loaded (${settled - failed}/${settled})`);
	else logSound.info(`All audio files loaded (${settled})`);
	readyResolve?.();
	readyResolve = null;
	readyPromise = null;
};

/**
 * Resolves once every sound registered SO FAR has settled (loaded or failed). Callers
 * that need a buffer to exist — the music and ambience beds — await this; callers that
 * already poll every frame (weatherAudio) just retry instead.
 */
export const soundsReady = (): Promise<void> => {
	if (inFlight === 0) return Promise.resolve();
	readyPromise ??= new Promise<void>((resolve) => {
		readyResolve = resolve;
	});
	return readyPromise;
};

const decode = async (soundId: string, url: string): Promise<AudioBuffer | null> => {
	if (!context) return null;
	try {
		const response = await fetch(SOUND_ROOT + url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await context.decodeAudioData(await response.arrayBuffer());
	} catch (error) {
		logSound.error(`Audio failed to load: ${soundId} (${url})`, error);
		return null;
	}
};

const load = (soundId: string, def: SoundDef): void => {
	const urls = typeof def.url === 'string' ? [def.url] : [...def.url];
	inFlight += urls.length;
	void Promise.all(urls.map((url) => decode(soundId, url))).then((decoded) => {
		// A failed variant is dropped from the draw rather than failing the sound — a
		// clap must never wait on a fetch, and three takes are still three takes.
		const ok = decoded.filter((b): b is AudioBuffer => b !== null);
		if (ok.length > 0) buffers.set(soundId, ok);
		inFlight -= urls.length;
		settled += urls.length;
		failed += urls.length - ok.length;
		summarize();
	});
};

/**
 * Hand the registry the live `AudioContext`. Called once by the runtime, after the
 * listener exists. Anything declared before this point loads now.
 */
export const attachAudioContext = (ctx: AudioContext): void => {
	if (context) return;
	context = ctx;
	for (const [soundId, def] of defs) if (!buffers.has(soundId)) load(soundId, def);
};

export const audioContext = (): AudioContext | null => context;

/** Declare one sound. `defineSounds()` in audio.ts is the public door. */
export const registerSound = (soundId: string, def: SoundDef): void => {
	if (defs.has(soundId)) {
		logSound.warn(`Audio: sound "${soundId}" redeclared — the later declaration wins`);
	}
	defs.set(soundId, def);
	if (context) load(soundId, def);
};

export const getDef = (soundId: string): SoundDef | null => defs.get(soundId) ?? null;

/** One decoded variant, drawn at random. Null while the sound is still loading. */
export const pickBuffer = (soundId: string): AudioBuffer | null => {
	const set = buffers.get(soundId);
	if (!set || set.length === 0) return null;
	return set.length === 1 ? set[0] : set[Math.floor(Math.random() * set.length)];
};

/** Drop a scene's declarations. Buffers go with them — re-entering the scene re-fetches. */
export const unregisterSounds = (soundIds: readonly string[]): void => {
	for (const soundId of soundIds) {
		defs.delete(soundId);
		buffers.delete(soundId);
	}
};
