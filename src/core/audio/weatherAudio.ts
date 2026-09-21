// Weather audio: the rain bed and the thunder claps, driven from the sky. See
// audio/CLAUDE.md for the contract (never an `$effect` here).

import { busAudible } from './mixer';
import { engineSounds } from './engineSounds';
import type { VoiceHandle } from './types';
import { descriptor, rainAmount, snowAmount } from '$core/skybox/model';
import { flashState } from '$core/skybox/layers/lightning/flashState';

/** Rain is an ambience bed, so it rides the ambience bus, not sfx. */
let rainLevel = 0;
/** Seconds for the rain bed to fade in and out. Slow: weather does not switch on. */
const RAIN_FADE = 1.6;
/** Snow is nearly silent, but not silent — a whiteout has a hiss to it. */
const SNOW_SHARE = 0.18;

/** Metres per second — paces the flash-to-thunder delay that sells a storm's scale. */
const SPEED_OF_SOUND = 343;
/** Distance at which a strike is inaudible. Beyond this no thunder is scheduled. */
const THUNDER_RANGE = 4200;
/** Share of bolt strikes that voice thunder — a clap for every bolt reads as an fx loop. */
const BOLT_THUNDER_CHANCE = 0.75;

let lastStrikeId = flashState.strikeId;

/** The looping bed. Created on the first tick after its buffer lands; never restarted. */
let rainBed: VoiceHandle | null = null;

/**
 * Vary each clap by the strike's distance: playback rate (near = sharp and short, far =
 * deep and long) and lowpass cutoff (air scatters highs over distance; nearness squared
 * so only close strikes crack). Both jittered so no two claps match.
 */
const clapVoicing = (distance: number): { rate: number; lowpass: number } => {
	const nearness = Math.max(0, 1 - distance / THUNDER_RANGE);
	return {
		rate: (0.86 + 0.22 * nearness) * (0.96 + Math.random() * 0.08),
		lowpass: 400 * 40 ** (nearness * nearness) * (0.7 + Math.random() * 0.7)
	};
};

export const tickWeatherAudio = (delta: number): void => {
	const w = descriptor.weather;

	// One bed for both, weighted: rain is loud, snow is a faint hiss.
	const target = rainAmount(w) + snowAmount(w) * SNOW_SHARE;

	// Framerate-independent one-pole, as the sky layers use — a hard cut would click.
	rainLevel += (target - rainLevel) * (1 - Math.exp(-delta / RAIN_FADE));

	// Lazily created: this module already polls every frame, so retrying is free, and
	// `loop()` returns null until the buffer has decoded.
	rainBed ??= engineSounds.rain.loop({ paused: true, volume: 0 });

	if (rainBed) {
		// The setting is the bus's (core/audio/mixer.ts); this level is the weather's own.
		const audible = rainLevel > 0.004 && busAudible('ambience');
		// Volume first, then play, so the frame a shower starts on isn't a full buffer of
		// rain at whatever level was left over.
		rainBed.volume = rainLevel;
		if (audible && !rainBed.playing) rainBed.resume();
		else if (!audible && rainBed.playing) rainBed.pause();
	}

	// A new strike: schedule its thunder for when the sound would arrive. Bolts only
	// (a sheet is a cell backlighting itself, no channel to the ground), and not all of
	// them — a clap for every event reads as a sound effect on repeat.
	if (flashState.strikeId !== lastStrikeId) {
		lastStrikeId = flashState.strikeId;
		const distance = flashState.strikeDistance;
		if (
			flashState.strikeKind === 'bolt' &&
			Math.random() < BOLT_THUNDER_CHANCE &&
			distance < THUNDER_RANGE &&
			busAudible('sfx')
		) {
			const { rate, lowpass } = clapVoicing(distance);
			engineSounds.thunder.play({
				delay: distance / SPEED_OF_SOUND,
				// Inverse falloff, not inverse-square: squared attenuation makes thunder
				// past a few hundred metres inaudible.
				volume: Math.max(0.08, 1 - distance / THUNDER_RANGE),
				rate,
				lowpass
			});
		}
	}
};
