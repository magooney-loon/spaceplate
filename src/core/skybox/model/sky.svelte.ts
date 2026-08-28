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
import type {
	ClockKind,
	DayKeyframe,
	PhaseName,
	RGB,
	SkyDescriptor,
	WeatherChannels
} from './types';

export * from './types';
export { DEFAULT_DAY_CURVE } from './dayCurve';
export { on, off } from './events';

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
 * Note this is the *default*, not the named `clear` weather that phase 2's mixer will
 * ship -- that one targets `cloudCover: 0` and stays a true empty sky. This is simply
 * the look the template opens with, and a partly-clouded sky is a better first frame
 * than an empty one.
 */
const defaultWeather = (): WeatherChannels => ({
	cloudCover: 0.37,
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
 * The reactive surface -- deliberately tiny.
 *
 * HUD overlays and the Studio panel need to re-render on phase changes, so these four
 * values are `$state`. They are WRITTEN by the tick and never read by it, which keeps
 * the one-way rule intact. Everything numeric and per-frame stays on `descriptor`.
 *
 * Writes are gated to a game-minute by `publishMeta` -- see there for why.
 */
export const skyMeta = $state({
	t: 0,
	day: 0,
	phase: 'night' as PhaseName,
	isDaytime: false
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

/** Recompute the descriptor from the current clock sample. */
const compose = (t: number, day: number) => {
	// Written in place, not reassigned: consumers may hold a reference to
	// `descriptor.sun` across frames, and reassigning would silently strand them.
	sunAt(t, pathOptions, descriptor.sun);
	moonAt(t, pathOptions, descriptor.moon);
	sampleDayCurve(t, descriptor.sky, curve);

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
	descriptor.light.intensity = lerp(
		MOON_INTENSITY * clamp01(descriptor.moon.elevation / 20),
		SUN_INTENSITY * sunStrength,
		horizon
	);
	// Fill light. See MOON_AMBIENT for why this is not optional once the sun is down.
	//
	// Two independent sources, combined with max() rather than added: moonlight and
	// twilight are alternatives, not contributors. Whichever is doing the lighting wins,
	// and the loser fading out never claws brightness back off the winner.
	const moonFill = MOON_AMBIENT * clamp01(descriptor.moon.elevation / 20);
	// Rises from -18 to the horizon, then hands back to the env map by +12.
	const twilightFill =
		TWILIGHT_AMBIENT * clamp01((elevation + 18) / 18) * (1 - clamp01(elevation / 12));
	descriptor.light.ambient = Math.max(Math.max(moonFill, twilightFill), DAY_AMBIENT * horizon);

	descriptor.meta.t = t;
	descriptor.meta.day = day;
	descriptor.meta.phase = phase;
	descriptor.meta.isDaytime = daytime;

	publishMeta(t, day, phase, daytime);

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

	/** Advance the model. Called once per frame by exactly one driver task. */
	tick(deltaMs: number) {
		const { t, day } = frozen ? clock.sample() : clock.advance(deltaMs);
		compose(t, day);
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
	getWeather: () => descriptor.weather
};

// Seed so the very first frame reads a composed descriptor rather than defaults.
compose(clock.sample().t, clock.sample().day);
