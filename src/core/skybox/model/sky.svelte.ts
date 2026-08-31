// The sky façade (§8). The only stateful module here; everything it imports is pure.
//
// Data flows one way: clock -> model -> renderers. Renderers never write back.
//
// `descriptor` is a plain mutable object, rewritten in place each tick. It is NOT
// `$state` and must not become `$state`: it changes every frame, and making it
// reactive would invalidate the component tree 60x a second -- besides reopening the
// read/write cycle that produced every reactive loop in this repo's history.

import { createClock, type Clock, type ClockOptions } from './clock';
import { createBaseline, sampleDayCurve, DEFAULT_DAY_CURVE } from './dayCurve';
import { isDaytime, isRising, phaseFor } from './phases';
import {
	createBody,
	directionAt,
	moonAt,
	sunAt,
	DEFAULT_MAX_ELEVATION,
	type PathOptions
} from './sunPath';
import { emit } from './events';
import {
	AMBIENT_RETURN,
	bodyVisibility,
	createWeatherMixer,
	deckFactor,
	keyAttenuation,
	modulateBaseline,
	WEATHERS,
	type WeatherOptions
} from './weatherMixer';
import type {
	ClockKind,
	DayKeyframe,
	PhaseName,
	RGB,
	SkyDescriptor,
	WeatherChannels,
	WeatherTarget
} from './types';

export * from './types';
export { DEFAULT_DAY_CURVE } from './dayCurve';
export { on, off } from './events';
export { WEATHERS, CHANNEL_NAMES, DEFAULT_BLEND_MS } from './weatherMixer';
export type { WeatherDefinition, WeatherOptions, ChannelName } from './weatherMixer';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Writes into `out` -- compose() runs every frame and must not allocate. */
const lerpRGB = (a: RGB, b: RGB, k: number, out: RGB): RGB => {
	out[0] = lerp(a[0], b[0], k);
	out[1] = lerp(a[1], b[1], k);
	out[2] = lerp(a[2], b[2], k);
	return out;
};

// Key-light palette. Warm at the horizon, neutral overhead, cool by moonlight.
// SUN_INTENSITY is the PEAK output at high sun -- the value the scene was originally
// tuned around (the old hardcoded light was Math.PI / 4 flat).
const SUN_HORIZON: RGB = [1, 0.6, 0.35];
const SUN_ZENITH: RGB = [1, 0.98, 0.95];
const MOON_COLOR: RGB = [0.55, 0.68, 1];
const SUN_INTENSITY = Math.PI / 4;

// A playable night, not a physical moon -- real moonlight is ~1/400,000 of sunlight.
// This is deliberately a THIRD of the sun, well past the "~25% would erase the night"
// that an earlier draft of this file worried about. That worry was misplaced: what
// reads as night is the cool colour cast, the black sky and the low exposure, not the
// key light's absolute value. At a 32nd the scene was simply unlit.
const MOON_INTENSITY = Math.PI / 12;

/**
 * Ambient fill published to the key-light consumer. In the same units as `intensity`.
 *
 * This exists because of a hard limit in the sky model, not as a nicety. §7 says the
 * baked `scene.environment` is "the ambient half" -- and by day it is. At night it
 * cannot be: SkyMesh zeroes its sun term entirely once the sun passes 2.31 degrees
 * below the horizon (`cutoffAngle = pi / 1.95`, then `max(0, ...)`), which collapses the
 * whole dome to `0.1 * Fex * 0.04 + vec3(0, 0.0003, 0.00075)` -- a ceiling of about
 * 0.005 linear luminance. The cube bakes black, the scene gets one directional light,
 * and every surface facing away from the moon receives exactly nothing.
 *
 * So the model publishes an explicit fill and SkyLight mounts a light for it.
 *
 * DAY_AMBIENT is deliberately ZERO. The env map genuinely does carry daylight, and an
 * early version of this that faded to a small daytime value brightened noon by 10% --
 * a change to a daytime look nobody asked to change. The fill exists to fix night; by
 * day it gets out of the way entirely and the crossfade takes it there smoothly.
 *
 * TWILIGHT_AMBIENT covers the same blind spot at the other end. Twilight is *by
 * definition* scattered skylight rather than direct sun, and the same SkyMesh cutoff
 * means the dome renders black through all of it -- so the blue-hour look the day curve
 * carefully authors at -6 and -18 degrees never actually lights anything. Worse, the
 * moon sets as the sun rises (they are at opposition by default), so without this term
 * the fill collapses exactly when the key light does: measured, civil dawn came out at
 * 8.2% of a noon surface against midnight's 28.4%. Dawn was darker than the middle of
 * the night.
 */
const MOON_AMBIENT = Math.PI / 32;
const DAY_AMBIENT = 0;
const TWILIGHT_AMBIENT = Math.PI / 14;

/**
 * Floor on the elevation used to *aim* the key light, in degrees.
 *
 * The intensity crossfade band runs from -6 to +6 degrees, so between -6 and 0 the sun
 * still drives the light while sitting below the horizon. Aiming a directional light
 * from underground lights every underside of the scene and throws shadows upward.
 * Clamping the aim keeps civil twilight as raking horizontal light -- which is what it
 * looks like anyway, since at that point you are lit by the sky, not the sun.
 */
const KEY_MIN_ELEVATION = 3;

/**
 * The channel vector the sky boots on.
 *
 * Note this is the *default*, not the named `clear` weather -- that one targets
 * `cloudCover: 0` and stays a true empty sky. This is simply the look the template opens
 * with, and a partly-clouded sky is a better first frame than an empty one.
 *
 * Held below `overcast`'s 0.35, or the app would boot cloudier than its own overcast
 * weather. It was 0.37 through phase 1, when `cloudCover` fed nothing but SkyMesh's
 * coverage uniform and the ordering did not matter.
 */
const defaultWeather = (): WeatherChannels => ({
	cloudCover: 0.2,
	cloudType: 0,
	fog: 0,
	precipitation: 0,
	wind: 0.1,
	lightning: 0
});

export const descriptor: SkyDescriptor = {
	sun: createBody(),
	moon: createBody(),
	sky: createBaseline(),
	weather: defaultWeather(),
	light: {
		direction: { x: 0, y: 1, z: 0 },
		color: [...SUN_ZENITH] as RGB,
		intensity: SUN_INTENSITY,
		ambient: 1
	},
	meta: { t: 0, day: 0, phase: 'night', isDaytime: false }
};

/**
 * The weather mixer, wired straight onto `descriptor.weather`.
 *
 * It owns and mutates that exact object, so the descriptor never needs a per-frame copy
 * and consumers that cached `descriptor.weather` keep seeing live values.
 */
const mixer = createWeatherMixer(descriptor.weather);

/**
 * The reactive surface -- deliberately tiny.
 *
 * HUD overlays and the Studio panel need to re-render on phase and weather changes, so
 * these values are `$state`. They are WRITTEN by the tick and never read by it, which
 * keeps the one-way rule intact. Everything numeric and per-frame stays on `descriptor`.
 *
 * The channel mirrors are here because a blend is something a dev panel genuinely needs
 * to watch arrive. They are gated hard (`CHANNEL_EPSILON`), so a 20 s storm blend wakes
 * the reactive graph a few dozen times in total rather than 1200 times.
 *
 * All writes are gated by `publishMeta` -- see there for why.
 */
export const skyMeta = $state({
	t: 0,
	day: 0,
	phase: 'night' as PhaseName,
	isDaytime: false,
	/** Last named weather set, or `'custom'` after a raw target. */
	weather: 'default',
	blending: false,
	cloudCover: descriptor.weather.cloudCover,
	fog: descriptor.weather.fog,
	precipitation: descriptor.weather.precipitation,
	wind: descriptor.weather.wind
});

// Manual clock as the template default: the app boots on a curated sunset rather
// than the player's wall clock, so the first frame is a known good look and a demo
// never opens on 3am black. Games pick their own clock on boot (§3.2).
let clock: Clock = createClock('manual', { t: 0.75 });
let pathOptions: PathOptions = {};
let curve: DayKeyframe[] = DEFAULT_DAY_CURVE;
let frozen = false;
let lastPhase: PhaseName | null = null;
let lastDaytime: boolean | null = null;
/** Set whenever time jumps rather than flows; consumers use it to skip smoothing. */
let discontinuity = true;

/** Scratch for the sun colour, so the per-frame blend allocates nothing. */
const sunColor: RGB = [...SUN_ZENITH] as RGB;

/** One game-minute. Anything finer is below what the readouts and scrubber resolve. */
const META_EPSILON = 1 / 1440;
/** 1% of a channel. Below that no readout or slider in the panel moves a pixel. */
const CHANNEL_EPSILON = 0.01;

/**
 * Push the tiny reactive slice, but only when it actually moved.
 *
 * `skyMeta` is `$state`, so every write invalidates whatever reads it. Writing `t` raw
 * meant an invalidation on all 60 frames a second even though the panel quantizes to
 * whole game-minutes and the DOM never changed. Gate on a game-minute and the reactive
 * graph wakes a few times a second instead.
 *
 * The gate compares against plain shadow variables, never against `skyMeta` itself.
 * `skyMeta` stays write-only from this module -- that one-way rule is the entire reason
 * a `$state` object is safe to touch from the tick.
 */
let publishedT = -1;
let publishedDay = -1;
let publishedPhase: PhaseName | null = null;
let publishedDaytime: boolean | null = null;
let publishedWeather: string | null = null;
let publishedBlending: boolean | null = null;
const publishedChannels = { cloudCover: -1, fog: -1, precipitation: -1, wind: -1 };

/** Mirror the four channels a dev panel watches, gated to CHANNEL_EPSILON. */
const publishWeather = (w: WeatherChannels) => {
	if (publishedWeather !== mixer.name) {
		publishedWeather = mixer.name;
		skyMeta.weather = mixer.name;
	}
	if (publishedBlending !== mixer.blending) {
		publishedBlending = mixer.blending;
		skyMeta.blending = mixer.blending;
	}
	for (const key of ['cloudCover', 'fog', 'precipitation', 'wind'] as const) {
		// Also fires when a blend lands exactly on its target, since `to` is reached
		// only once and the epsilon gate would otherwise strand the final value.
		if (Math.abs(w[key] - publishedChannels[key]) >= CHANNEL_EPSILON || !mixer.blending) {
			if (publishedChannels[key] === w[key]) continue;
			publishedChannels[key] = w[key];
			skyMeta[key] = w[key];
		}
	}
};

const publishMeta = (t: number, day: number, phase: PhaseName, daytime: boolean) => {
	// Compared cyclically: 0.9999 -> 0.0001 is one minute forward, not a day backward.
	if (publishedT < 0 || Math.abs(((t - publishedT + 1.5) % 1) - 0.5) >= META_EPSILON) {
		publishedT = t;
		skyMeta.t = t;
	}
	if (publishedDay !== day) {
		publishedDay = day;
		skyMeta.day = day;
	}
	if (publishedPhase !== phase) {
		publishedPhase = phase;
		skyMeta.phase = phase;
	}
	if (publishedDaytime !== daytime) {
		publishedDaytime = daytime;
		skyMeta.isDaytime = daytime;
	}
};

/**
 * Recompute the descriptor from the current clock sample.
 *
 * `deltaMs` advances the weather blend. It is 0 on the jump paths (setTime, setClock),
 * which recompose without time passing -- weather must not creep forward because
 * someone scrubbed the clock.
 */
const compose = (t: number, day: number, deltaMs = 0) => {
	// Written in place, not reassigned: consumers may hold a reference to
	// `descriptor.sun` across frames, and reassigning would silently strand them.
	sunAt(t, pathOptions, descriptor.sun);
	moonAt(t, pathOptions, descriptor.moon);
	sampleDayCurve(t, descriptor.sky, curve);

	// Weather goes ON TOP of the sampled baseline, never instead of it (§5.1). The
	// ordering is the whole design: the curve decides what time it is, the mixer decides
	// what the weather is doing to that, and an overcast sunset still reads as evening.
	if (deltaMs > 0) mixer.tick(deltaMs);
	const weather = descriptor.weather;
	modulateBaseline(descriptor.sky, weather);

	// A body's visibility is how much of it reaches the ground. Nothing consumes this
	// yet -- it is the slice a cloud-aware lens flare or a "can the player see the moon"
	// gameplay query reads, and it costs one multiply to publish honestly.
	const seen = bodyVisibility(weather);
	descriptor.sun.visibility = seen;
	descriptor.moon.visibility = seen;

	const elevation = descriptor.sun.elevation;
	const rising = isRising(t);
	const daytime = isDaytime(elevation);
	const phase = phaseFor(elevation, rising, pathOptions.maxElevation ?? DEFAULT_MAX_ELEVATION);

	// Crossfade sun -> moon across the horizon band. The handover lands at horizon 0
	// (sun at -6), where the sun contributes nothing and the moon -- at opposition, so
	// 6 degrees up -- is at a few percent of peak. Flipping the *direction* through 180
	// degrees there is the cheapest honest option: interpolating between two opposed
	// vectors is undefined, and at that intensity the swing is invisible.
	const horizon = clamp01((elevation + 6) / 12);
	// Altitude ramp: the sun's STRENGTH keeps growing above the crossfade band. A flat
	// lerp to SUN_INTENSITY saturated at +6 degrees, which put noon-level light on a
	// 9-degree late-afternoon sun -- "too bright already at 17:30". Golden hour keeps a
	// warm quarter-strength floor; full output only above 45 degrees.
	const sunStrength = 0.25 + 0.75 * clamp01(elevation / 45);
	lerpRGB(SUN_HORIZON, SUN_ZENITH, clamp01(elevation / 30), sunColor);

	const key = horizon > 0 ? descriptor.sun : descriptor.moon;
	directionAt(Math.max(key.elevation, KEY_MIN_ELEVATION), key.azimuth, descriptor.light.direction);
	lerpRGB(MOON_COLOR, sunColor, horizon, descriptor.light.color);
	// A cloud deck is a grey diffuser: it strips the warmth out of the light as well as
	// the strength. Desaturating toward the colour's own luminance keeps the day/night
	// crossfade intact underneath -- overcast midnight stays blue-ish, just flatter.
	//
	// Gated on `deck`, not raw cover, exactly like the intensity below: scattered cloud
	// must not grey out a sunset the app boots into. See DECK_THRESHOLD.
	const deck = deckFactor(weather.cloudCover);
	const desaturate = 0.7 * deck;
	if (desaturate > 0) {
		const c = descriptor.light.color;
		const luminance = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
		c[0] = lerp(c[0], luminance, desaturate);
		c[1] = lerp(c[1], luminance, desaturate);
		c[2] = lerp(c[2], luminance, desaturate);
	}

	const clearSkyKey = lerp(
		MOON_INTENSITY * clamp01(descriptor.moon.elevation / 20),
		SUN_INTENSITY * sunStrength,
		horizon
	);
	// Weather takes its cut here, at the very end, so every constant above still means
	// what it says under a clear sky and only one expression decides how much a deck
	// removes.
	const attenuation = keyAttenuation(weather);
	descriptor.light.intensity = clearSkyKey * attenuation;

	// Fill light. See MOON_AMBIENT for why this is not optional once the sun is down.
	//
	// Two independent sources, combined with max() rather than added: moonlight and
	// twilight are alternatives, not contributors. Whichever is doing the lighting wins,
	// and the loser fading out never claws brightness back off the winner.
	//
	// Both are then scaled by the DECK factor, because a real deck blocks moonlight and
	// twilight too -- an overcast night is genuinely darker than a clear one, and skipping
	// this would leave a storm at midnight brighter than the clear sky it replaced.
	// Scattered cloud must leave them alone, or the boot default dims every night scene.
	const moonFill = MOON_AMBIENT * clamp01(descriptor.moon.elevation / 20) * (1 - 0.9 * deck);
	// A triangle peaked at -6 degrees: rises from -18, full at civil twilight, GONE by the
	// horizon.
	//
	// It used to peak at 0 and fade out by +12, which erased the shadows at sunrise and
	// sunset. The numbers: at elevation 0 the key light is 0.098 -- the sun runs at its
	// 0.25 strength floor and the sun->moon crossfade halves it again -- against a fill of
	// 0.224. Flat fill at 2.3x the key light is a scene with no shadows in it, exactly when
	// the sun is on the horizon and the shadows should be at their longest.
	//
	// -6 is the right peak because that is the blind spot this fill exists for: SkyMesh
	// zeroes its sun term below -2.31 degrees (§15.2), so the env map is black through all
	// of civil twilight and the blue hour the day curve authors lights nothing. Above the
	// horizon that is simply not true any more -- the dome renders, the env map carries the
	// ambient, and adding a second flat term on top double-counts it.
	const twilightFill =
		TWILIGHT_AMBIENT *
		clamp01((elevation + 18) / 12) *
		(1 - clamp01((elevation + 6) / 6)) *
		(1 - 0.5 * deck);
	// The overcast return is ADDED, not max()'d: it is not an alternative to the night
	// fills, it is the light the deck just took off the key coming back diffusely. That
	// is what makes strong attenuation read as "flat and bright" instead of "dark" --
	// see AMBIENT_RETURN. It scales with what was actually removed, so a clear sky adds
	// exactly zero and nothing about the daytime look changes until weather arrives.
	const overcastReturn = clearSkyKey * (1 - attenuation) * AMBIENT_RETURN;
	descriptor.light.ambient =
		Math.max(Math.max(moonFill, twilightFill), DAY_AMBIENT * horizon) + overcastReturn;

	descriptor.meta.t = t;
	descriptor.meta.day = day;
	descriptor.meta.phase = phase;
	descriptor.meta.isDaytime = daytime;

	publishMeta(t, day, phase, daytime);
	publishWeather(weather);

	if (lastPhase !== phase) {
		const previous = lastPhase;
		lastPhase = phase;
		if (previous !== null) emit('phaseChange', { phase, previous });
	}
	if (lastDaytime !== daytime) {
		const previous = lastDaytime;
		lastDaytime = daytime;
		if (previous !== null) emit(daytime ? 'sunrise' : 'sunset', { t, day });
	}
};

/**
 * Point the weather mixer at a named weather or a raw channel target (§5.3).
 *
 * Fire-and-forget and idempotent: calling it twice blends to the same place. There is
 * no transition state machine for callers to trip over -- the mixer has internal state,
 * this API does not expose it. Whether the call came from game code, a Studio button or
 * a server subscription, it converges on the same mixer, which is what makes the
 * multiplayer path in §6 one code path rather than two.
 *
 * A free function rather than a method so `clearWeather` can delegate to it: a method
 * referencing `skyActions` from inside its own initializer makes the object's inferred
 * type circular.
 */
const setWeather = (target: WeatherTarget, options: WeatherOptions = {}) => {
	if (typeof target === 'string' && !WEATHERS[target]) {
		// Silently blending to nothing would look like a dropped call. Named weathers are
		// data, so a typo is the likely cause and it has to be loud.
		throw new Error(
			`sky.setWeather: unknown weather '${target}'. Known: ${Object.keys(WEATHERS).join(', ')}`
		);
	}
	mixer.set(target, options);
	// A snap is a jump, exactly like a time scrub: the env map has to re-bake now rather
	// than on the next interval, and the descriptor has to carry the new values before
	// any consumer reads it this frame.
	if (options.over === 0) {
		discontinuity = true;
		const sample = clock.sample();
		compose(sample.t, sample.day);
	}
	emit('weatherChanged', { weather: mixer.name, channels: descriptor.weather });
};

export const skyActions = {
	/** Swap the time source. Always a discontinuity. */
	setClock(kind: ClockKind, options: ClockOptions = {}) {
		clock = createClock(kind, { timeScale: clock.timeScale, ...options });
		discontinuity = true;
		const { t, day } = clock.sample();
		compose(t, day);
	},

	/** Feed the external clock -- server time, replays, scripted timelines. */
	setExternalTime(t: number, day?: number) {
		clock.set(t, day);
	},

	setTimeScale(scale: number) {
		clock.timeScale = scale;
	},

	/** Manual scrub. A jump, so consumers must not smooth across it. */
	setTime(t: number, day?: number) {
		clock.set(t, day);
		discontinuity = true;
		const sample = clock.sample();
		compose(sample.t, sample.day);
	},

	freeze() {
		frozen = true;
	},

	unfreeze() {
		frozen = false;
	},

	/** Replace the authored day curve (weather.json, Studio edits). */
	setDayCurve(next: DayKeyframe[]) {
		curve = next.length ? next : DEFAULT_DAY_CURVE;
		discontinuity = true;
	},

	setPathOptions(next: PathOptions) {
		pathOptions = next;
		discontinuity = true;
	},

	/**
	 * Point the weather mixer at a named weather or a raw channel target (§5.3).
	 *
	 * Fire-and-forget and idempotent: calling it twice blends to the same place. There
	 * is no transition state machine for callers to trip over -- the mixer has internal
	 * state, this API does not expose it. Whether the call came from game code, a Studio
	 * button or a server subscription, it lands on the same mixer.
	 */
	setWeather,

	/** Blend back to `clear`. Same call as any other target, no special path. */
	clearWeather(options: WeatherOptions = {}) {
		setWeather('clear', options);
	},

	/** Advance the model. Called once per frame by exactly one driver task. */
	tick(deltaMs: number) {
		const { t, day } = frozen ? clock.sample() : clock.advance(deltaMs);
		// The weather blend runs on wall-clock ms, deliberately NOT on scaled game time:
		// `setWeather('storm', { over: 30_000 })` must mean thirty seconds the player
		// experiences, whatever the day is doing around it.
		compose(t, day, deltaMs);
	},

	/** True once after a jump; reading it clears the flag. */
	consumeDiscontinuity(): boolean {
		const was = discontinuity;
		discontinuity = false;
		return was;
	}
};

// Synchronous reads of derived state -- gameplay in a frame loop must not await these.
export const skyQueries = {
	getSunElevation: () => descriptor.sun.elevation,
	getMoonElevation: () => descriptor.moon.elevation,
	getPhase: () => descriptor.meta.phase,
	isDaytime: () => descriptor.meta.isDaytime,
	getTime: () => ({ t: descriptor.meta.t, day: descriptor.meta.day }),
	/** The live channel vector. Mutated in place each tick -- read it, never cache it. */
	getWeather: () => descriptor.weather,
	getWeatherName: () => mixer.name,
	isWeatherBlending: () => mixer.blending
};

// Seed so the very first frame reads a composed descriptor rather than defaults.
compose(clock.sample().t, clock.sample().day);
