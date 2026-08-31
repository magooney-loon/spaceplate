// Named phases (§3.5). Derived thresholds on *sun* elevation, not separate presets --
// moonlight illuminates the night, it does not redefine it.
//
// Phases exist for gameplay queries and events (torches, enemy spawns, vampires), and
// as anchors for the day-curve keyframes.

import { DEFAULT_MAX_ELEVATION } from './sunPath';
import type { PhaseName } from './types';

/**
 * Sun elevation in degrees plus a rising/falling flag -> phase name.
 *
 * The rising flag is what separates the symmetric pairs: the same elevation means
 * `dawn` on the way up and `dusk` on the way down.
 *
 * `noon` is deliberately relative to the arc's peak rather than an absolute angle.
 * With a fixed threshold, "above 20 degrees" swallows most of the daylight hours and
 * `noon` stops meaning anything -- a scene at 3pm would report `noon`. Keyed to the
 * peak it stays a narrow band around the sun's highest point.
 *
 * `maxElevation` must be the arc's actual peak. Callers used to let it default while
 * the arc itself was configurable, so lowering the arc to, say, 40 degrees meant the
 * peak never reached 0.95 * 75 and `noon` could never fire.
 */
export const phaseFor = (
	sunElevation: number,
	rising: boolean,
	maxElevation = DEFAULT_MAX_ELEVATION
): PhaseName => {
	if (sunElevation >= maxElevation * 0.95) return 'noon';
	if (sunElevation < -18) return 'night';
	// The evening side used to answer 'dusk' for BOTH of the next two bands while the
	// morning side distinguished 'astronomicalDawn' from 'dawn' -- so the day curve had an
	// `astronomicalDusk` keyframe that no phase name corresponded to, and `phaseChange`
	// fired a different number of times going down than coming up.
	if (sunElevation < -6) return rising ? 'astronomicalDawn' : 'astronomicalDusk';
	if (sunElevation < 0) return rising ? 'dawn' : 'dusk';
	if (sunElevation < 6) return rising ? 'sunrise' : 'sunset';
	if (sunElevation < 20) return rising ? 'morning' : 'goldenHour';
	return rising ? 'morning' : 'afternoon';
};

/** The sun is climbing on the first half of its arc, between midnight and noon. */
export const isRising = (t: number): boolean => t < 0.5;

/** Daytime is simply "the sun is above the horizon". */
export const isDaytime = (sunElevation: number): boolean => sunElevation > 0;
