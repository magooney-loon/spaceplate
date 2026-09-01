// Weather audio: the rain bed and the thunder claps, driven from the sky.
//
// THE CONTRACT. This is the audio consumer of the same plain-state contract the render
// layers use (DOCS/weather-system.md §14.1): the descriptor is a plain mutable object
// written by one model task, and lightning publishes strikes to `flashState`. Nothing
// here may be an `$effect` -- it would run once at mount and never again. GlobalAudio
// mounts the `<Audio>` objects (it registers the sound files) and hands them over via
// the attach functions; its task calls `tickWeatherAudio(delta)`.
//
// WHY THE TRIGGERS DO NOT LIVE IN THE LAYERS (Rain.svelte / Lightning.svelte): the
// layers unmount whenever the environment mode is not the procedural sky, and a
// looping bed torn down with a render component is exactly the race the
// "GlobalAudio never unmounts" rule exists to prevent (see src/CLAUDE.md). The layers
// already publish everything audio needs as plain state -- `flashState.strikeId` /
// `strikeDistance` for thunder, `descriptor.weather` for the bed. This file is the
// single seam for the planned audio-engine rework.

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

/**
 * Metres per second. Real thunder is the same event as the flash arriving late, and
 * that delay is most of what gives a storm a sense of scale -- a bolt overhead cracks
 * within a second, one on the horizon rumbles ten seconds after you saw it.
 */
const SPEED_OF_SOUND = 343;
/** Distance at which a strike is inaudible. Beyond this no thunder is scheduled. */
const THUNDER_RANGE = 4200;

let lastStrikeId = flashState.strikeId;
/** Thunder claps waiting on their travel time. Small and short-lived; rarely over 3. */
const pendingThunder: { atMs: number; volume: number }[] = [];

let rainAudio: ThreeAudio | undefined;
let thunderAudio: ThreeAudio | undefined;

/** Hand the mounted, looping rain bed to this module. Called once from GlobalAudio. */
export const attachRainAudio = (audio: ThreeAudio): void => {
	rainAudio = audio;
};

/** Hand the mounted thunder one-shot to this module. Called once from GlobalAudio. */
export const attachThunderAudio = (audio: ThreeAudio): void => {
	thunderAudio = audio;
};

export const tickWeatherAudio = (delta: number): void => {
	const w = descriptor.weather;

	// One bed for both, weighted: rain is loud, snow is a faint hiss. Using the shared
	// split means the bed follows sleet across the blend instead of cutting out.
	const target = rainAmount(w) + snowAmount(w) * SNOW_SHARE;

	// Framerate-independent one-pole, as the sky layers use. A hard cut here would
	// click, and worse, would make a 20 s weather blend arrive instantly in the audio
	// while it was still ramping visually.
	rainLevel += (target - rainLevel) * (1 - Math.exp(-delta / RAIN_FADE));

	// The buffer guard is not paranoia: `src` is fetched asynchronously, so there are
	// real frames after mount where the Audio object exists with nothing in it, and
	// `play()` on an empty buffer starts a silent source that then refuses the real one.
	if (rainAudio?.buffer) {
		const audible = rainLevel > 0.004 && settingsState.audio.ambienceEnabled;
		// Volume first, then play -- otherwise the frame a shower starts on gets one
		// buffer's worth of rain at whatever level was left over.
		rainAudio.setVolume(rainLevel * settingsState.audio.ambienceVolume);
		if (audible && !rainAudio.isPlaying) rainAudio.play();
		else if (!audible && rainAudio.isPlaying) rainAudio.pause();
	}

	// A new strike: schedule its thunder for when the sound would actually arrive.
	if (flashState.strikeId !== lastStrikeId) {
		lastStrikeId = flashState.strikeId;
		const distance = flashState.strikeDistance;
		if (distance < THUNDER_RANGE && settingsState.audio.sfxEnabled) {
			pendingThunder.push({
				atMs: performance.now() + (distance / SPEED_OF_SOUND) * 1000,
				// Inverse falloff rather than inverse-square: thunder carries far better
				// than the point-source law suggests, and squared attenuation makes
				// anything past a few hundred metres inaudible.
				volume: Math.max(0.08, 1 - distance / THUNDER_RANGE)
			});
		}
	}

	if (pendingThunder.length > 0) {
		const now = performance.now();
		for (let i = pendingThunder.length - 1; i >= 0; i--) {
			if (pendingThunder[i].atMs > now) continue;
			const { volume } = pendingThunder[i];
			pendingThunder.splice(i, 1);
			// Polyphonic: a storm can easily put a second strike in the air before the
			// first has finished rolling, and cutting one off to start the next is the
			// one thing that would make it read as a sound effect rather than weather.
			if (settingsState.audio.sfxEnabled && thunderAudio?.buffer) {
				const clone = thunderAudio.clone() as ThreeAudio;
				clone.setVolume(volume * settingsState.audio.sfxVolume);
				clone.play();
			}
		}
	}
};
