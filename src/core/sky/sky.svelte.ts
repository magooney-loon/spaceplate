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
import { moonAt, sunAt, type PathOptions } from './sunPath';
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
const lerpRGB = (a: RGB, b: RGB, k: number): RGB => [
	lerp(a[0], b[0], k),
	lerp(a[1], b[1], k),
	lerp(a[2], b[2], k)
];

// Key-light palette. Warm at the horizon, neutral overhead, cool by moonlight.
const SUN_HORIZON: RGB = [1, 0.6, 0.35];
const SUN_ZENITH: RGB = [1, 0.98, 0.95];
const MOON_COLOR: RGB = [0.55, 0.68, 1];
const SUN_INTENSITY = Math.PI / 2;
const MOON_INTENSITY = Math.PI / 16;

const clearWeather = (): WeatherChannels => ({
	cloudCover: 0,
	cloudType: 0,
	fog: 0,
	precipitation: 0,
	wind: 0.1,
	lightning: 0
});

const emptyBody = () => ({
	direction: { x: 0, y: 1, z: 0 },
	elevation: 0,
	azimuth: 0,
	visibility: 0
});

export const descriptor: SkyDescriptor = {
	sun: emptyBody(),
	moon: emptyBody(),
	sky: createBaseline(),
	weather: clearWeather(),
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
 */
export const skyMeta = $state({
	t: 0,
	day: 0,
	phase: 'night' as PhaseName,
	isDaytime: false
});

let clock: Clock = createClock('realtime');
let pathOptions: PathOptions = {};
let curve: DayKeyframe[] = DEFAULT_DAY_CURVE;
let frozen = false;
let lastPhase: PhaseName | null = null;
let lastDaytime: boolean | null = null;
/** Set whenever time jumps rather than flows; consumers use it to skip smoothing. */
let discontinuity = true;

/** Recompute the descriptor from the current clock sample. */
const compose = (t: number, day: number) => {
	descriptor.sun = sunAt(t, pathOptions);
	descriptor.moon = moonAt(t, pathOptions);
	sampleDayCurve(t, descriptor.sky, curve);

	const elevation = descriptor.sun.elevation;
	const rising = isRising(t);
	const daytime = isDaytime(elevation);
	const phase = phaseFor(elevation, rising);

	// Crossfade sun -> moon across the horizon band. At sunFactor 0 the sun sits 6
	// degrees down and contributes nothing, so switching the *direction* there is
	// invisible -- which avoids interpolating between two opposed vectors.
	const sunFactor = clamp01((elevation + 6) / 12);
	const sunColor = lerpRGB(SUN_HORIZON, SUN_ZENITH, clamp01(elevation / 15));

	descriptor.light.direction = sunFactor > 0 ? descriptor.sun.direction : descriptor.moon.direction;
	descriptor.light.color = lerpRGB(MOON_COLOR, sunColor, sunFactor);
	descriptor.light.intensity = lerp(
		MOON_INTENSITY * clamp01(descriptor.moon.elevation / 20),
		SUN_INTENSITY,
		sunFactor
	);
	descriptor.light.ambient = descriptor.sky.exposure;

	descriptor.meta.t = t;
	descriptor.meta.day = day;
	descriptor.meta.phase = phase;
	descriptor.meta.isDaytime = daytime;

	skyMeta.t = t;
	skyMeta.day = day;
	skyMeta.phase = phase;
	skyMeta.isDaytime = daytime;

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
