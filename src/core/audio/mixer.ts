// The engine's bus graph. Every voice connects to a bus, never to the listener directly
// — a bus is a real GainNode, so a volume or mute is one write on the audio thread.
//
//   sources ──▶ music ────┐
//               ambience ─┼──▶ listener.gain ──▶ context.destination
//               sfx ──────┤        (master)
//                 └─ ui ──┘
//
// Three's listener stays the master: its own contract (setMasterVolume, the filter
// slot) keeps working, and every bus ends at `listener.gain`, so nothing bypasses the
// graph. `ui` is a child of `sfx`, not a sibling, so click/swoosh ride the sfx fader.

import type { AudioListener as ThreeAudioListener } from 'three';
import { settingsState } from '$extensions/settings';
import { logSound } from '$extensions/logger';
import type { BusId } from './types';

export type { BusId };

/**
 * What the mixer needs of a voice: its output gain. Structural rather than `Audio`
 * because `PositionalAudio` is not an `Audio<GainNode>` to TypeScript — it overrides
 * `getOutput()` to a `PannerNode` — but both still end in `this.gain`.
 */
type Routable = { gain: GainNode };

type Bus = {
	readonly id: BusId;
	/** Where sources connect. For `master` this IS three's `listener.gain`. */
	readonly input: GainNode;
	readonly parent: Bus | null;
	volume: number;
	muted: boolean;
};

/** Below this a bus counts as inaudible — a cost decision, since the gain node has
 * already made it silent, but a looping source nobody can hear shouldn't decode. */
const AUDIBLE_EPS = 1e-4;

/** Ramp time for volume changes. Short enough to feel instant, long enough not to click. */
const RAMP = 0.01;

let listener: ThreeAudioListener | null = null;
let buses: Map<BusId, Bus> | null = null;

/** Which bus each voice is currently on. */
const routing = new WeakMap<Routable, Bus>();

const gainOf = (bus: Bus): number => (bus.muted ? 0 : bus.volume);

const applyGain = (bus: Bus): void => {
	bus.input.gain.setTargetAtTime(gainOf(bus), bus.input.context.currentTime, RAMP);
};

/** Build the graph. Called once, from the audio runtime, after the listener exists. Idempotent. */
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

/** Tear the graph down. Sources are left to their own disposal. */
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
 * Point a voice at a bus. Every voice needs this, including clones — `Audio.clone()`
 * wires `gain → listener.getInput()`, past the whole bus graph, at full volume.
 */
export const routeToBus = (audio: Routable, id: BusId): void => {
	const bus = busOf(id);
	if (!bus || !listener) return;

	const from = routing.get(audio)?.input ?? listener.getInput();
	if (from === bus.input) return;
	try {
		audio.gain.disconnect(from);
	} catch {
		// Already disconnected, or never connected where expected — reconnecting below is still correct.
	}
	audio.gain.connect(bus.input);
	routing.set(audio, bus);
};

/** Can anything on this bus actually be heard? Walks to master, so a muted `sfx`
 * silences `ui` under it. Loops gate playback on this. */
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

/** Push `settingsState.audio` into the graph. The one place settings meets the bus
 * tree. `enabled` is a mute on the bus, not a per-call-site guard. */
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

/** The bus tree's shape and current gains — what render.ts rebuilds offline, and what
 * timeline.ts attaches its gain curves to. */
export const busGraph = (): { id: BusId; parent: BusId | null; gain: number }[] => {
	if (!buses) return [];
	return [...buses.values()].map((b) => ({
		id: b.id,
		parent: b.parent?.id ?? null,
		gain: gainOf(b)
	}));
};

/** The live gain of one bus, for per-frame sampling. */
export const busGain = (id: BusId): number => {
	const bus = busOf(id);
	return bus ? gainOf(bus) : 1;
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
