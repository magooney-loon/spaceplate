// Time sources. The engine never owns time -- it reads it from a clock.
//
// Pure: no Svelte, no three.js. A clock holds `t` and `day` and advances them by
// elapsed * scale. Swapping clocks is a state swap, not a rewire.

import type { ClockKind, TimeSample } from './types';

const MS_PER_DAY = 86_400_000;

export type ClockOptions = {
	/** Fixed UTC offset in minutes. Only meaningful for `realtime`. */
	utcOffsetMinutes?: number;
	/** 1 = real time, 60 = a game day per 24 min, 0 = frozen. */
	timeScale?: number;
	/** Starting time-of-day for `manual` / `external`. */
	t?: number;
	day?: number;
};

export type Clock = {
	kind: ClockKind;
	timeScale: number;
	/** Advance by wall-clock milliseconds and return the new sample. */
	advance(deltaMs: number): TimeSample;
	/** Jump without smoothing. Callers must treat this as a discontinuity. */
	set(t: number, day?: number): void;
	sample(): TimeSample;
};

/** Wrap into [0,1), carrying whole turns into `day`. */
const normalize = (t: number, day: number): TimeSample => {
	const turns = Math.floor(t);
	return { t: t - turns, day: day + turns };
};

/** Local wall-clock time-of-day as a normalized fraction. */
const wallClockT = (utcOffsetMinutes?: number): number => {
	const now = new Date();
	if (utcOffsetMinutes === undefined) {
		const ms =
			now.getHours() * 3_600_000 +
			now.getMinutes() * 60_000 +
			now.getSeconds() * 1000 +
			now.getMilliseconds();
		return ms / MS_PER_DAY;
	}
	// getTime() is UTC epoch ms; shifting by the offset gives local time at that zone.
	const shifted = now.getTime() + utcOffsetMinutes * 60_000;
	return (((shifted % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / MS_PER_DAY;
};

const createBase = (kind: ClockKind, options: ClockOptions = {}): Clock => {
	let t = options.t ?? 0;
	let day = options.day ?? 0;
	let timeScale = options.timeScale ?? 1;

	return {
		kind,
		get timeScale() {
			return timeScale;
		},
		set timeScale(value: number) {
			timeScale = value;
		},
		advance(deltaMs: number) {
			const next = normalize(t + (deltaMs * timeScale) / MS_PER_DAY, day);
			t = next.t;
			day = next.day;
			return next;
		},
		set(nextT: number, nextDay?: number) {
			const next = normalize(nextT, nextDay ?? day);
			t = next.t;
			day = next.day;
		},
		sample() {
			return { t, day };
		}
	};
};

/**
 * Follows the player's wall clock, optionally pinned to a UTC offset.
 *
 * Seeded from the real clock, then advanced by elapsed * scale so that `timeScale`
 * means the same thing on every clock. At scale 1 it re-syncs each tick, which keeps
 * it exact over long sessions; at any other scale it free-runs from the seed, because
 * re-syncing would fight the scale.
 */
export const createRealtimeClock = (options: ClockOptions = {}): Clock => {
	const base = createBase('realtime', { ...options, t: wallClockT(options.utcOffsetMinutes) });
	const advance = base.advance;

	base.advance = (deltaMs: number) => {
		if (base.timeScale === 1) {
			base.set(wallClockT(options.utcOffsetMinutes));
			return base.sample();
		}
		return advance(deltaMs);
	};

	return base;
};

/** Reads a value the game supplies each tick -- server time, replays, timelines. */
export const createExternalClock = (options: ClockOptions = {}): Clock =>
	createBase('external', options);

/** Fixed value, changed only by `set`. Studio scrubber, cutscenes, screenshots. */
export const createManualClock = (options: ClockOptions = {}): Clock =>
	createBase('manual', { ...options, timeScale: 0 });

export const createClock = (kind: ClockKind, options: ClockOptions = {}): Clock => {
	switch (kind) {
		case 'realtime':
			return createRealtimeClock(options);
		case 'external':
			return createExternalClock(options);
		case 'manual':
			return createManualClock(options);
	}
};
