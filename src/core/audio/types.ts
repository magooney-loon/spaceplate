// The audio layer's vocabulary. See DOCS/AUDIO.md for the design and
// core/audio/CLAUDE.md for the contracts.

import type { Object3D } from 'three';

/** The engine's buses. Games nest their own under these — core/audio/mixer.ts. */
export type BusId = 'master' | 'music' | 'ambience' | 'sfx' | 'ui';

/**
 * A sound DECLARATION — data, not markup. Registered with `defineSounds()`.
 *
 * `url` is relative to `public/sounds/` (`'click.mp3'`, `'skybox/rain.opus'`); the
 * registry prefixes `BASE_URL` itself, as every static asset path must.
 *
 * **A LIST OF URLS IS A VARIANT SET** — one is drawn at random per play. That is the
 * thunder-take picker and the two exhaust-pop takes, moved into the declaration.
 */
export type SoundDef = {
	readonly url: string | readonly string[];
	/** Defaults to `sfx`. */
	readonly bus?: BusId;
	/** Voice-level trim baked into the declaration, multiplied by any per-play volume. */
	readonly volume?: number;
	/**
	 * How many one-shots of this sound may overlap. 1 (the default) is stop-and-restart;
	 * above 1 is a pool of that depth, oldest stolen on overflow. Loops ignore it — each
	 * `loop()` gets its own voice and its own handle.
	 */
	readonly poly?: number;
	/** Positional defaults, used when a voice is placed with `at`. Fall back to `positionalDefaults`. */
	readonly ref?: number;
	readonly rolloff?: number;
	readonly max?: number;
	readonly panningModel?: PanningModelType;
	/** Web Audio's distance curve. Defaults to `'inverse'`, the PannerNode's own default. */
	readonly distanceModel?: DistanceModelType;
	/**
	 * A directional source: full level inside `inner` degrees, `outerGain` beyond `outer`,
	 * aimed down the voice's local +Z (three's convention). Omitted = omnidirectional.
	 */
	readonly cone?: { readonly inner: number; readonly outer: number; readonly outerGain: number };
};

export type PlayOptions = {
	/** Multiplied by the declaration's own `volume`. */
	volume?: number;
	/** Playback rate. Pitch and speed together — three resamples on the audio thread. */
	rate?: number;
	/** Cents, applied on top of `rate`. */
	detune?: number;
	/**
	 * Cutoff in Hz for a lowpass on this voice alone. A FRESH BiquadFilterNode per play —
	 * sharing one across voices is the trap `weatherAudio`'s clap modulation documents.
	 */
	lowpass?: number;
	/**
	 * SCENE seconds to wait before the voice sounds (`core/audio/scheduler.ts`), converted
	 * to the AudioContext clock and scheduled natively — sample-accurate, not polled on a
	 * frame boundary.
	 *
	 * Scene and context time run at the same rate except while a capture take owns the
	 * engine clock, and the conversion preserves intervals exactly, so in a normal session
	 * this is simply "seconds from now".
	 */
	delay?: number;
	/** Stop this many SCENE seconds after it starts, rather than at the end of the buffer. */
	duration?: number;
	/** Place the voice in the world: a `PositionalAudio` parented to this object. */
	at?: Object3D;
	/**
	 * A local offset inside `at`, in that object's own space — the exhaust tip a pop
	 * speaks from, the hull point a scrape shriek lands at. Reset to the parent's origin
	 * when absent, so a pooled voice cannot inherit the previous play's spot. Only
	 * meaningful with `at`.
	 */
	position?: [number, number, number];
	/** Create the voice without starting it. Loops only — a handle you drive yourself. */
	paused?: boolean;
};

/** A playing (or scheduled) instance. Returned by `play()` / `loop()`. */
export type VoiceHandle = {
	readonly soundId: string;
	/** The voice's own level. The bus carries the player's setting — never read a setting here. */
	volume: number;
	rate: number;
	/** False once the buffer has run out, the deadline passed, or `stop()` was called. */
	readonly playing: boolean;
	/** The decoded buffer's length in seconds — for fades timed against a take's own tail. */
	readonly duration: number;
	/** Keeps position, unlike `stop()`. What tab-hide parking and the bed toggles use. */
	pause(): void;
	resume(): void;
	stop(): void;
};

/** What `defineSounds()` hands back: typed access, so a renamed sound is a type error. */
export type SoundRef = {
	readonly soundId: string;
	play(options?: PlayOptions): VoiceHandle | null;
	loop(options?: PlayOptions): VoiceHandle | null;
};

/**
 * Everything created through a scope dies with it. A scene takes one on mount and
 * releases it on unmount — one line in place of a hand-written detach function.
 */
export type AudioScope = {
	play(soundId: string, options?: PlayOptions): VoiceHandle | null;
	loop(soundId: string, options?: PlayOptions): VoiceHandle | null;
	release(): void;
};
