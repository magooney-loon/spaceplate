// THE MIXER — the engine's bus graph (plan: DOCS/AUDIO.md, "The mixer").
//
// Every voice connects to a BUS, never to the listener directly. A bus is a real
// GainNode, so a volume or a mute is one write on the audio thread instead of a
// number every call site multiplies in by hand at the moment it plays.
//
//   sources ──▶ ui ───────┐
//               music ────┤
//               ambience ─┼──▶ listener.gain ──▶ context.destination
//               sfx ──────┤        (master)
//                 └─ ui ──┘   (three's AudioListener — untouched)
//
// THREE'S LISTENER STAYS THE MASTER, and that is load-bearing twice: its own
// contract (setMasterVolume, the filter slot) keeps working, and capture/'s tap
// fans off `listener.gain`, so it still sees everything however many buses sit
// above it.
//
// `ui` is a CHILD of `sfx`, not a sibling: click/swoosh ride the sfx fader today
// and must keep doing so, but a game that wants UI trimmed separately now has a
// place to do it.

import type { Audio as ThreeAudio, AudioListener as ThreeAudioListener } from 'three';
import { settingsState } from '$extensions/settings';
import { logSound } from '$extensions/logger';

/** The engine's buses. Games nest their own under these — see DOCS/AUDIO.md. */
export type BusId = 'master' | 'music' | 'ambience' | 'sfx' | 'ui';

type Bus = {
	readonly id: BusId;
	/** Where sources connect. For `master` this IS three's `listener.gain`. */
	readonly input: GainNode;
	readonly parent: Bus | null;
	volume: number;
	muted: boolean;
};

/**
 * Below this a bus counts as inaudible. Only ever a COST decision — the gain node
 * has already made it silent — but a looping source that cannot be heard should not
 * be decoding, which is what `busAudible()` is for.
 */
const AUDIBLE_EPS = 1e-4;

/** Three's own ramp for volume changes (`Audio.setVolume`). Short enough to feel instant, long enough not to click. */
const RAMP = 0.01;

let listener: ThreeAudioListener | null = null;
let buses: Map<BusId, Bus> | null = null;

/** Which bus each voice is currently on — a fresh `Audio` is wired to the listener by its constructor. */
const routing = new WeakMap<ThreeAudio, Bus>();

const gainOf = (bus: Bus): number => (bus.muted ? 0 : bus.volume);

const applyGain = (bus: Bus): void => {
	bus.input.gain.setTargetAtTime(gainOf(bus), bus.input.context.currentTime, RAMP);
};

/**
 * Build the graph. Called once, from the audio runtime, after the listener exists
 * (`Camera.svelte` mounts `<AudioListener />` before it). Idempotent.
 */
export const installMixer = (audioListener: ThreeAudioListener): void => {
	if (buses) return;
	listener = audioListener;
	const context = audioListener.context;

	// Master is three's own gain — already connected to the destination.
	const master: Bus = {
		id: 'master',
		input: audioListener.getInput(),
		parent: null,
		volume: audioListener.getMasterVolume(),
		muted: false
	};

	const child = (id: BusId, parent: Bus): Bus => {
		const node = context.createGain();
		node.connect(parent.input);
		return { id, input: node, parent, volume: 1, muted: false };
	};

	const music = child('music', master);
	const ambience = child('ambience', master);
	const sfx = child('sfx', master);
	const ui = child('ui', sfx);

	buses = new Map<BusId, Bus>([
		['master', master],
		['music', music],
		['ambience', ambience],
		['sfx', sfx],
		['ui', ui]
	]);

	syncMixerFromSettings();
};

/** Tear the graph down — the runtime's unmount, and HMR. Sources are left to their own disposal. */
export const uninstallMixer = (): void => {
	if (!buses) return;
	for (const bus of buses.values()) {
		if (bus.parent) bus.input.disconnect();
	}
	buses = null;
	listener = null;
};

const busOf = (id: BusId): Bus | null => buses?.get(id) ?? null;

/**
 * Point a voice at a bus.
 *
 * **Every voice needs this, including clones.** `Audio.clone()` is
 * `new this.constructor(this.listener)` (three's `Audio.js`), and that constructor
 * wires `gain → listener.getInput()` — so a clone comes back wired PAST the whole
 * bus graph, at full volume, however its template was routed.
 */
export const routeToBus = (audio: ThreeAudio, id: BusId): void => {
	const bus = busOf(id);
	if (!bus || !listener) return;

	const from = routing.get(audio)?.input ?? listener.getInput();
	if (from === bus.input) return;
	try {
		audio.gain.disconnect(from);
	} catch {
		// Already disconnected, or never connected where we thought. Reconnecting below
		// is still correct; a double edge would be the only harm and there isn't one.
	}
	audio.gain.connect(bus.input);
	routing.set(audio, bus);
};

/**
 * Can anything on this bus actually be heard? Walks to master, so a muted `sfx`
 * silences `ui` under it. Loops gate playback on this — see AUDIBLE_EPS.
 */
export const busAudible = (id: BusId): boolean => {
	let bus = busOf(id);
	if (!bus) return false;
	while (bus) {
		if (bus.muted || bus.volume <= AUDIBLE_EPS) return false;
		bus = bus.parent;
	}
	return true;
};

export const setBusVolume = (id: BusId, volume: number): void => {
	const bus = busOf(id);
	if (!bus) return;
	bus.volume = Math.min(1, Math.max(0, volume));
	applyGain(bus);
};

export const setBusMuted = (id: BusId, muted: boolean): void => {
	const bus = busOf(id);
	if (!bus) return;
	bus.muted = muted;
	applyGain(bus);
};

/**
 * Push `settingsState.audio` into the graph. The ONE place settings meets the bus
 * tree; called from the runtime's effect on the primitives it reads.
 *
 * `enabled` is a MUTE, not a gate — the scattered `if (…Enabled)` guards this
 * replaces could each be forgotten individually, and one of them was (the stale
 * click, DOCS/AUDIO.md "Why").
 */
export const syncMixerFromSettings = (): void => {
	if (!buses) return;
	const a = settingsState.audio;
	setBusVolume('master', a.masterVolume);
	setBusVolume('music', a.musicVolume);
	setBusMuted('music', !a.musicEnabled);
	setBusVolume('ambience', a.ambienceVolume);
	setBusMuted('ambience', !a.ambienceEnabled);
	setBusVolume('sfx', a.sfxVolume);
	setBusMuted('sfx', !a.sfxEnabled);
};

/** Dev aid: what the graph currently holds. The Studio panel's voice inspector grows from this. */
export const mixerSnapshot = (): { id: BusId; volume: number; muted: boolean; gain: number }[] => {
	if (!buses) {
		logSound.warn('Mixer: not installed');
		return [];
	}
	return [...buses.values()].map((b) => ({
		id: b.id,
		volume: b.volume,
		muted: b.muted,
		gain: gainOf(b)
	}));
};
