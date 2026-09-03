// Types for the sky/weather model. Nothing here imports three.js or Threlte -- the
// model is pure (see model/CLAUDE.md).

export type ClockKind = 'realtime' | 'external' | 'manual';

/** Normalized time-of-day in [0,1): 0 = midnight, 0.25 = sunrise, 0.5 = noon. */
export type TimeSample = {
	t: number;
	day: number;
};

export type PhaseName =
	| 'night'
	| 'astronomicalDawn'
	| 'dawn'
	| 'sunrise'
	| 'morning'
	| 'noon'
	| 'afternoon'
	| 'goldenHour'
	| 'sunset'
	| 'dusk'
	| 'astronomicalDusk';

export type RGB = [number, number, number];

/** World-space vector, Y up. Kept structural so the model never imports three.js. */
export type Vec3 = { x: number; y: number; z: number };

/** One keyframe on the day curve. Holds the *baseline* sky, never weather. */
export type DayKeyframe = {
	t: number;
	name: string;
	turbidity: number;
	rayleigh: number;
	mieCoefficient: number;
	mieDirectionalG: number;
	exposure: number;
	/** 0..1 -- consumed by a future star renderer. */
	starVisibility: number;
	fogColor: RGB;
	fogDensity: number;
};

/** The sampled baseline, before weather modulates it. Same fields, no `t`/`name`. */
export type SkyBaseline = Omit<DayKeyframe, 't' | 'name'>;

export type CelestialBody = {
	/** Unit direction, world space, Y up. */
	direction: Vec3;
	elevation: number;
	azimuth: number;
	/** 0..1 -- how much of this body reaches the ground (cloud occlusion, later). */
	visibility: number;
};

/**
 * Weather channel values. Every channel is independent and lives in [0,1] -- fog
 * without rain, wind without clouds. A weather *state* is just a named target vector over
 * these, which is why `WeatherTarget` accepts either.
 *
 * MOST channels are intensities, where 0 means "none of this". Two are not, and they are
 * called out below: `precipitationType` and `windDirection` are POSITIONS, where 0 is a
 * perfectly valid value that means something specific rather than nothing. The mixer
 * treats `windDirection` specially for exactly that reason -- see WRAPPED_CHANNELS.
 */
export type WeatherChannels = {
	cloudCover: number;
	/** Cloud morphology: 0 wispy, 1 heavy stratus/storm tower. Nothing else. */
	cloudType: number;
	fog: number;
	/** How much is falling. What KIND is `precipitationType`, not this. */
	precipitation: number;
	/**
	 * NOT an intensity: 0 = snow, 1 = rain, the band between is sleet. Split from
	 * `cloudType` (its former gate) so morphology is never hostage to precipitation
	 * type -- and sleet is something you can ask for, not just a mid-blend artifact.
	 */
	precipitationType: number;
	/** Wind strength. Never bipolar: 0 = still, 1 = storm. */
	wind: number;
	/**
	 * NOT an intensity: the wind's compass bearing, one full turn over [0,1).
	 *
	 * Wraps, so the mixer blends it along the SHORTER arc -- easing 0.95 to 0.05 must
	 * cross north, not spin the long way round through south.
	 */
	windDirection: number;
	lightning: number;
};

/**
 * What `setWeather` takes: a name from the WEATHERS library, or a raw partial vector.
 *
 * A raw target is as valid as a named one -- `setWeather({ cloudCover: 0.9, fog: 0.4 })`
 * is a first-class call, not an escape hatch. Channels the target omits keep their
 * current values rather than snapping to a default, so a partial really is partial.
 */
export type WeatherTarget = string | Partial<WeatherChannels>;

/** What a light consumer needs. Shadow config is game-specific and stays out. */
export type LightHints = {
	/**
	 * Where the key light sits. Never points below the horizon, even while the sun is:
	 * a directional light underground lights every underside and throws its shadow
	 * upward. sky.svelte.ts clamps the elevation used to build this.
	 */
	direction: Vec3;
	color: RGB;
	intensity: number;
	/**
	 * Ambient fill, in the same units as `intensity`. Delivered by a real light, because
	 * the baked env map is black at night -- see MOON_AMBIENT in sky.svelte.ts.
	 */
	ambient: number;
};

/**
 * The single output contract of the model: a PLAIN MUTABLE OBJECT, never `$state` --
 * one task writes it in place each frame, consumers read it from their own tasks
 * (the descriptor contract, ../CLAUDE.md).
 */
export type SkyDescriptor = {
	sun: CelestialBody;
	moon: CelestialBody;
	sky: SkyBaseline;
	weather: WeatherChannels;
	light: LightHints;
	meta: {
		t: number;
		day: number;
		phase: PhaseName;
		isDaytime: boolean;
	};
};

export type SkyEvent = 'sunrise' | 'sunset' | 'phaseChange' | 'weatherChanged';
