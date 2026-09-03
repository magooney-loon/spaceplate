// The sky façade. The only stateful module here; everything it imports is pure.
// Data flows one way: clock -> model -> renderers, renderers never write back. The
// descriptor is a plain mutable object written in place each tick, never `$state`
// (the descriptor contract, ../CLAUDE.md).

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
import { clamp01, lerp, lerpRGB } from './math';
import {
	AMBIENT_RETURN,
	bodyVisibility,
	CHANNEL_NAMES,
	createWeatherMixer,
	deckFactor,
	keyAttenuation,
	modulateBaseline,
	WEATHERS,
	type ChannelName,
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

// Key-light palette. Warm at the horizon, neutral overhead, cool by moonlight.
const SUN_HORIZON: RGB = [1, 0.6, 0.35];
const SUN_ZENITH: RGB = [1, 0.98, 0.95];
const MOON_COLOR: RGB = [0.55, 0.68, 1];

/**
 * PEAK key output at high sun. Pairs with `Sky.svelte`'s `environmentIntensity` (0.25):
 * they are ONE change -- the env map scales the dome down and this absorbs the daylight
 * it stopped delivering, so the key carries the day instead of the sky. Move them
 * together and re-measure; never compensate with the day curve's `exposure`
 * (renderer-global). Deliberately a day-only knob: by night the env map contributes
 * almost nothing and the moon and fill constants below do the work.
 */
const SUN_INTENSITY = 4.75;

/**
 * A playable night, not a physical moon -- real moonlight is ~1/400,000 of sunlight.
 * An ABSOLUTE level, not a fraction of the sun: the env map bakes black at night (see
 * MOON_AMBIENT), so nothing about its scale ever reached the night and nothing about
 * rescaling it should. It does not track SUN_INTENSITY and must not be "restored" to
 * some ratio of it.
 */
const MOON_INTENSITY = Math.PI / 12;

/**
 * Ambient fill published to the key-light consumer, in the same units as `intensity`.
 * Exists because the env map cannot carry night: SkyMesh zeroes its sun term below
 * -2.31 degrees of sun elevation, so the cube bakes black and every surface facing away
 * from the moon receives nothing. SkyLight mounts a light for this fill.
 *
 * DAY_AMBIENT is deliberately zero -- the env map genuinely carries daylight, so the fill
 * gets out of the way by day. TWILIGHT_AMBIENT covers the same blind spot through
 * twilight: the dome is still black there, and the moon (at opposition by default) sets
 * as the sun rises, so without it dawn reads darker than midnight.
 */
const MOON_AMBIENT = Math.PI / 32;
const DAY_AMBIENT = 0;
const TWILIGHT_AMBIENT = Math.PI / 14;

/**
 * Floor on the elevation used to *aim* the key light, in degrees. Without it the sun
 * keeps aiming the light from underground through civil twilight, lighting undersides
 * and throwing shadows upward. It deliberately does NOT prop up flat ground at sunrise:
 * a 3-degree light leaves horizontal surfaces dark and gives vertical faces the light
 * -- that is what a low sun does.
 */
const KEY_MIN_ELEVATION = 3;

/** Boots on a NAMED weather so the first frame is reproducible from the panel. */
const BOOT_WEATHER = 'cloudy';

// A named target is a `Partial<WeatherChannels>`, so it is spread over a full vector
// rather than cast -- an authored weather that omits a channel still boots valid. The
// base is all-zero except `precipitationType`, a POSITION whose neutral value is rain.
const bootWeather = (): WeatherChannels => ({
	cloudCover: 0,
	cloudType: 0,
	fog: 0,
	precipitation: 0,
	precipitationType: 1,
	wind: 0,
	windDirection: 0,
	lightning: 0,
	...WEATHERS[BOOT_WEATHER].target
});

export const descriptor: SkyDescriptor = {
	sun: createBody(),
	moon: createBody(),
	sky: createBaseline(),
	weather: bootWeather(),
	light: {
		direction: { x: 0, y: 1, z: 0 },
		color: [...SUN_ZENITH] as RGB,
		intensity: SUN_INTENSITY,
		ambient: 1
	},
	meta: { t: 0, day: 0, phase: 'night', isDaytime: false }
};

/** Owns and mutates `descriptor.weather` exactly, so cached references see live values. */
const mixer = createWeatherMixer(descriptor.weather, BOOT_WEATHER);

/**
 * The reactive surface -- deliberately tiny. HUD overlays and the Studio panel need to
 * re-render on phase and weather changes; the tick WRITES these and never reads them,
 * keeping the one-way rule intact. The channel mirrors are epsilon-gated so a 20 s
 * blend wakes the graph a few dozen times rather than 1200. All writes go through
 * `publishMeta`/`publishWeather`.
 */
export const skyMeta = $state({
	t: 0,
	day: 0,
	phase: 'night' as PhaseName,
	isDaytime: false,
	/** Last named weather set, or `'custom'` after a raw target. */
	weather: BOOT_WEATHER,
	blending: false,
	cloudCover: descriptor.weather.cloudCover,
	cloudType: descriptor.weather.cloudType,
	fog: descriptor.weather.fog,
	precipitation: descriptor.weather.precipitation,
	precipitationType: descriptor.weather.precipitationType,
	wind: descriptor.weather.wind,
	windDirection: descriptor.weather.windDirection,
	lightning: descriptor.weather.lightning
});

// Manual clock default: the app boots on a curated sunrise rather than the player's
// wall clock, so a demo never opens on 3am black. 0.25 is the `sunrise` keyframe exactly
// -- boot times are keyframe times, not round numbers near them. Games pick their own.
let clock: Clock = createClock('manual', { t: 0.25 });
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
 * Gate publishes so `skyMeta` ($state) only invalidates when a value actually moved --
 * a game-minute for `t`, CHANNEL_EPSILON for channels. The gates compare plain shadow
 * variables, never `skyMeta` itself: it stays write-only from this module, which is
 * what makes a `$state` object safe to touch from the tick.
 */
let publishedT = -1;
let publishedDay = -1;
let publishedPhase: PhaseName | null = null;
let publishedDaytime: boolean | null = null;
let publishedWeather: string | null = null;
let publishedBlending: boolean | null = null;
const publishedChannels: Record<ChannelName, number> = {
	cloudCover: -1,
	cloudType: -1,
	fog: -1,
	precipitation: -1,
	precipitationType: -1,
	wind: -1,
	windDirection: -1,
	lightning: -1
};

/** Mirror every channel a dev panel watches, gated to CHANNEL_EPSILON. */
const publishWeather = (w: WeatherChannels) => {
	if (publishedWeather !== mixer.name) {
		publishedWeather = mixer.name;
		skyMeta.weather = mixer.name;
	}
	if (publishedBlending !== mixer.blending) {
		publishedBlending = mixer.blending;
		skyMeta.blending = mixer.blending;
	}
	// Driven off CHANNEL_NAMES: a channel missing from this loop would simply never
	// reach the panel -- a silent omission, not a type error.
	for (const key of CHANNEL_NAMES) {
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
 * Recompute the descriptor from a clock sample. `deltaMs` advances the weather blend;
 * it is 0 on the jump paths (setTime, setClock), so weather does not creep forward
 * because someone scrubbed the clock.
 */
const compose = (t: number, day: number, deltaMs = 0) => {
	// Written in place, not reassigned: consumers may hold a reference to
	// `descriptor.sun` across frames, and reassigning would silently strand them.
	sunAt(t, pathOptions, descriptor.sun);
	moonAt(t, pathOptions, descriptor.moon);
	sampleDayCurve(t, descriptor.sky, curve);

	// Weather goes ON TOP of the sampled baseline, never instead of it: the curve decides
	// what time it is, the mixer decides what the weather is doing to that.
	if (deltaMs > 0) mixer.tick(deltaMs);
	const weather = descriptor.weather;
	modulateBaseline(descriptor.sky, weather);

	// How much of the body reaches the ground -- the slice a cloud-aware lens flare or a
	// "can the player see the moon" gameplay query reads; costs one multiply to publish.
	const seen = bodyVisibility(weather);
	descriptor.sun.visibility = seen;
	descriptor.moon.visibility = seen;

	const elevation = descriptor.sun.elevation;
	const rising = isRising(t);
	const daytime = isDaytime(elevation);
	const phase = phaseFor(elevation, rising, pathOptions.maxElevation ?? DEFAULT_MAX_ELEVATION);

	// Sun and moon are computed INDEPENDENTLY and combined with max(), never lerped
	// across one shared weight (a shared `horizon` weight once dimmed the sun AND handed
	// over to the moon, cutting a horizon sun to an eighth of peak). `sunSet` is the sun's
	// own extinction across its last six degrees, and nothing else.
	const sunSet = clamp01((elevation + 6) / 6);
	// Altitude ramp: the sun's STRENGTH keeps growing above the horizon band -- a flat
	// lerp would put noon-level light on a 9-degree sun. Quarter-strength floor at the
	// horizon, full output only above 45 degrees.
	const sunStrength = 0.25 + 0.75 * clamp01(elevation / 45);
	const sunKey = SUN_INTENSITY * sunSet * sunStrength;
	const moonKey = MOON_INTENSITY * clamp01(descriptor.moon.elevation / 20);
	// max(), like the ambient fills below: sun and moon are alternatives, so neither is
	// dimmed by the other fading out.
	const clearSkyKey = Math.max(sunKey, moonKey);

	// ONE weight drives direction, colour AND intensity, so they cannot disagree.
	const sunShare = sunKey + moonKey > 0 ? sunKey / (sunKey + moonKey) : 0;
	lerpRGB(SUN_HORIZON, SUN_ZENITH, clamp01(elevation / 30), sunColor);

	// The direction still flips 180 degrees at the handover (~-4.5 degrees of sun
	// elevation, ~8% of peak, colour and intensity continuous across it) -- the bodies sit
	// at opposition by default and interpolating between opposed vectors is undefined.
	const key = sunShare >= 0.5 ? descriptor.sun : descriptor.moon;
	directionAt(Math.max(key.elevation, KEY_MIN_ELEVATION), key.azimuth, descriptor.light.direction);
	lerpRGB(MOON_COLOR, sunColor, sunShare, descriptor.light.color);
	// A cloud deck strips the warmth as well as the strength. Desaturating toward the
	// colour's own luminance keeps the day/night crossfade intact underneath. Gated on
	// `deck`, not raw cover, exactly like the intensity below -- see DECK_THRESHOLD.
	const deck = deckFactor(weather.cloudCover);
	const desaturate = 0.7 * deck;
	if (desaturate > 0) {
		const c = descriptor.light.color;
		const luminance = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
		c[0] = lerp(c[0], luminance, desaturate);
		c[1] = lerp(c[1], luminance, desaturate);
		c[2] = lerp(c[2], luminance, desaturate);
	}

	// Weather takes its cut here, at the very end, so every constant above still means
	// what it says under a clear sky and only one expression decides how much a deck
	// removes.
	const attenuation = keyAttenuation(weather);
	descriptor.light.intensity = clearSkyKey * attenuation;

	// Fill light -- see MOON_AMBIENT for why it is not optional once the sun is down.
	// Moonlight and twilight are alternatives, combined with max() like the key. Both
	// are scaled by the deck factor: a real deck blocks them too, and scattered cloud
	// must leave them alone or the boot default dims every night scene.
	const moonFill = MOON_AMBIENT * clamp01(descriptor.moon.elevation / 20) * (1 - 0.9 * deck);
	// A triangle peaked at -6 degrees: rises from -18, full at civil twilight, GONE by
	// the horizon. -6 is the blind spot this fill exists for -- the dome is black through
	// civil twilight; above the horizon the env map carries the ambient and a second flat
	// term would double-count it.
	const twilightFill =
		TWILIGHT_AMBIENT *
		clamp01((elevation + 18) / 12) *
		(1 - clamp01((elevation + 6) / 6)) *
		(1 - 0.5 * deck);
	// The overcast return is ADDED, not max()'d: it is the light the deck just took off
	// the key coming back diffusely (see AMBIENT_RETURN). It scales with what was
	// actually removed, so a clear sky adds exactly zero.
	const overcastReturn = clearSkyKey * (1 - attenuation) * AMBIENT_RETURN;
	descriptor.light.ambient =
		Math.max(Math.max(moonFill, twilightFill), DAY_AMBIENT * sunShare) + overcastReturn;

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
 * Point the weather mixer at a named weather or a raw channel target.
 *
 * Fire-and-forget and idempotent: no transition state machine for callers to trip
 * over, and game code, a Studio button and a server subscription all converge on the
 * same mixer -- which is what makes the multiplayer path one code path. A free
 * function rather than a method so `clearWeather` can delegate to it without a
 * circular inferred type.
 */
const setWeather = (target: WeatherTarget, options: WeatherOptions = {}) => {
	if (typeof target === 'string' && !WEATHERS[target]) {
		// Named weathers are data, so a typo is the likely cause and it has to be loud.
		throw new Error(
			`sky.setWeather: unknown weather '${target}'. Known: ${Object.keys(WEATHERS).join(', ')}`
		);
	}
	mixer.set(target, options);
	// A snap is a jump, exactly like a time scrub: re-bake the env map now, not on the
	// next interval, and carry the new values before any consumer reads this frame.
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

	/** Point the weather mixer at a target -- see the standalone `setWeather` above. */
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
