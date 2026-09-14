// Weather audio: the rain bed and the thunder claps, driven from the sky. See
// audio/CLAUDE.md for the contract (never an `$effect` here).

import type { Audio as ThreeAudio } from 'three';
import { settingsState } from '$extensions/settings';
import { descriptor, rainAmount, snowAmount } from '$core/skybox/model';
import { flashState } from '$core/skybox/layers/lightning/flashState';

/** Rain is an ambience bed, so it rides the ambience settings, not sfx. */
let rainLevel = 0;
/** Seconds for the rain bed to fade in and out. Slow: weather does not switch on. */
const RAIN_FADE = 1.6;
/** Snow is nearly silent, but not silent -- a whiteout has a hiss to it. */
const SNOW_SHARE = 0.18;

/** Metres per second -- paces the flash-to-thunder delay that sells a storm's scale. */
const SPEED_OF_SOUND = 343;
/** Distance at which a strike is inaudible. Beyond this no thunder is scheduled. */
const THUNDER_RANGE = 4200;
/** Share of bolt strikes that voice thunder -- a clap for every bolt reads as an fx loop, not weather. */
const BOLT_THUNDER_CHANCE = 0.75;

let lastStrikeId = flashState.strikeId;
/** Thunder claps waiting on their travel time. Small and short-lived; rarely over 3. */
const pendingThunder: { atMs: number; volume: number; distance: number }[] = [];

let rainAudio: ThreeAudio | undefined;
/** The mounted thunder takes, drawn from per clap. Registered by GlobalAudio. */
const thunderTakes: ThreeAudio[] = [];

/** Hand the mounted, looping rain bed to this module. Called once from GlobalAudio. */
export const attachRainAudio = (audio: ThreeAudio): void => {
	rainAudio = audio;
};

/** Hand a mounted thunder one-shot take to this module. Called once per take from GlobalAudio. */
export const attachThunderAudio = (audio: ThreeAudio): void => {
	thunderTakes.push(audio);
};

/**
 * Vary each clap by the strike's distance: playback rate (near = sharp and short, far =
 * deep and long) and lowpass cutoff (air scatters highs over distance; nearness squared
 * so only close strikes crack). Both jittered so no two claps match. A new filter node
 * per clap -- `clone()` shares the template's filter array by reference.
 */
const modulateClap = (clap: ThreeAudio, distance: number): void => {
	const nearness = Math.max(0, 1 - distance / THUNDER_RANGE);
	clap.setPlaybackRate((0.86 + 0.22 * nearness) * (0.96 + Math.random() * 0.08));
	const filter = clap.context.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 400 * 40 ** (nearness * nearness) * (0.7 + Math.random() * 0.7);
	clap.setFilters([filter]);
};

export const tickWeatherAudio = (delta: number): void => {
	const w = descriptor.weather;

	// One bed for both, weighted: rain is loud, snow is a faint hiss. Using the shared
	// split means the bed follows sleet across the blend instead of cutting out.
	const target = rainAmount(w) + snowAmount(w) * SNOW_SHARE;

	// Framerate-independent one-pole, as the sky layers use: a hard cut would click,
	// and would make a 20 s weather blend arrive instantly in the audio.
	rainLevel += (target - rainLevel) * (1 - Math.exp(-delta / RAIN_FADE));

	// The buffer guard is real: `src` fetches asynchronously, so there are frames
	// where the Audio exists with no buffer -- play() then starts a silent source
	// that refuses the real one.
	if (rainAudio?.buffer) {
		const audible = rainLevel > 0.004 && settingsState.audio.ambienceEnabled;
		// Volume first, then play -- otherwise the frame a shower starts on gets one
		// buffer's worth of rain at whatever level was left over.
		rainAudio.setVolume(rainLevel * settingsState.audio.ambienceVolume);
		if (audible && !rainAudio.isPlaying) rainAudio.play();
		else if (!audible && rainAudio.isPlaying) rainAudio.pause();
	}

	// A new strike: schedule its thunder for when the sound would arrive. Bolts only
	// (a sheet is a cell backlighting itself, no channel to the ground), and not all
	// of them -- a clap for every event reads as a sound effect on repeat.
	if (flashState.strikeId !== lastStrikeId) {
		lastStrikeId = flashState.strikeId;
		const distance = flashState.strikeDistance;
		if (
			flashState.strikeKind === 'bolt' &&
			Math.random() < BOLT_THUNDER_CHANCE &&
			distance < THUNDER_RANGE &&
			settingsState.audio.sfxEnabled
		) {
			pendingThunder.push({
				atMs: performance.now() + (distance / SPEED_OF_SOUND) * 1000,
				// Inverse falloff, not inverse-square: squared attenuation makes thunder
				// past a few hundred metres inaudible.
				volume: Math.max(0.08, 1 - distance / THUNDER_RANGE),
				distance
			});
		}
	}

	if (pendingThunder.length > 0) {
		const now = performance.now();
		for (let i = pendingThunder.length - 1; i >= 0; i--) {
			if (pendingThunder[i].atMs > now) continue;
			const { volume, distance } = pendingThunder[i];
			pendingThunder.splice(i, 1);
			// Polyphonic: a storm can put a second strike in the air before the first
			// finishes rolling. The take is drawn uniformly at random -- the takes are
			// varieties of weather, not near/far markers (distance is already spoken for
			// by volume, rate and filter). A still-loading take is out of the draw; a
			// clap never waits on a fetch.
			const loaded = thunderTakes.filter((t) => t.buffer);
			if (settingsState.audio.sfxEnabled && loaded.length > 0) {
				const clone = loaded[Math.floor(Math.random() * loaded.length)].clone() as ThreeAudio;
				clone.setVolume(volume * settingsState.audio.sfxVolume);
				modulateClap(clone, distance);
				clone.play();
			}
		}
	}
};
