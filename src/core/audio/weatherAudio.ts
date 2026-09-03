// Weather audio: the rain bed and the thunder claps, driven from the sky.
//
// THE CONTRACT: the audio consumer of the sky's plain state (core/skybox/CLAUDE.md) --
// the descriptor is a plain mutable object written by one model task, lightning
// publishes strikes to `flashState`, and nothing here may be an `$effect` (it would
// run once at mount and never again). GlobalAudio mounts the `<Audio>` objects, hands
// them over via the attach functions, and its task calls `tickWeatherAudio(delta)`.
// The triggers deliberately do NOT live in the layers: layers unmount with the
// environment mode, and a looping bed must not (audio/CLAUDE.md).

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
/**
 * Share of bolt strikes that voice thunder. The strike scheduler is paced for the EYE
 * (a bolt every couple of seconds at a full channel), and a clap at that rate stops
 * reading as weather. Uniform in distance on purpose: nearness already decides how a
 * clap sounds, not whether the storm owes you one.
 */
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
 * Make one clap not sound like the last -- a storm that replays one take
 * byte-for-byte reads as a sound effect, not weather. Both terms derive from the
 * strike's distance:
 *
 * - Playback rate. A near strike cracks sharp and short; a far one stretches into a
 *   deeper, longer rumble (tape-style rate moves pitch and duration together).
 * - Lowpass cutoff. Air scatters the high frequencies out over kilometres, so the
 *   far end keeps only the rumble. Nearness is squared so the crack is reserved for
 *   genuinely close strikes -- mid-range stays dark.
 *
 * Both are jittered, so two strikes at the same distance never match. The filter
 * node must be created per clap: `clone()` shares the template's filter array by
 * reference.
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
