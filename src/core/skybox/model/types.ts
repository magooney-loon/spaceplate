// Types for the sky/weather model. See DOCS/weather-system.md.
//
// Nothing in src/core/skybox/model/ imports three.js or Threlte. The model is pure so it can
// be unit-tested, logged and scrubbed with no renderer in the room -- and, more
// importantly, so it can never participate in a Svelte reactive cycle.

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
	| 'dusk';

export type RGB = [number, number, number];

/** One keyframe on the day curve (§4). Holds the *baseline* sky, never weather. */
export type DayKeyframe = {
	t: number;
	name: string;
	turbidity: number;
	rayleigh: number;
	mieCoefficient: number;
	mieDirectionalG: number;
	exposure: number;
	/** 0..1 -- consumed by a future star renderer (§15.4). */
	starVisibility: number;
	fogColor: RGB;
	fogDensity: number;
};

/** The sampled baseline, before weather modulates it. Same fields, no `t`/`name`. */
export type SkyBaseline = Omit<DayKeyframe, 't' | 'name'>;

export type CelestialBody = {
	/** Unit direction, world space, Y up. */
	direction: { x: number; y: number; z: number };
	elevation: number;
	azimuth: number;
	/** 0..1 -- how much of this body reaches the ground (cloud occlusion, later). */
	visibility: number;
};

/** Weather channel values (§5.2). Phase 1 leaves these at their clear-sky defaults. */
export type WeatherChannels = {
	cloudCover: number;
	cloudType: number;
	fog: number;
	precipitation: number;
	wind: number;
	lightning: number;
};

/** What a light consumer needs. Shadow config is game-specific and stays out. */
export type LightHints = {
	direction: { x: number; y: number; z: number };
	color: RGB;
	intensity: number;
	ambient: number;
};

/**
 * The single output contract of the model (§7).
 *
 * This is a PLAIN MUTABLE OBJECT, deliberately not `$state`. One task writes it in
 * place each frame; consumers read it from their own tasks. Nothing is tracked, so no
 * effect can loop on it. Per-frame numbers must never become reactive -- they change
 * 60x a second and would invalidate the component tree at that rate.
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
