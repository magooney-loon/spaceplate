// Weather.
//
// Weather is NOT a preset of the sky: it is a modulation layer on top of the day-curve
// baseline -- the curve decides what time it is, the mixer what the weather does to it
// (see ./CLAUDE.md). Pure: no Svelte, no three.js. Two halves: `createWeatherMixer`
// (stateful-but-plain, eases the channel vector toward a target with a staggered onset,
// mutates in place) and `modulateBaseline` (pure, plus the light/visibility helpers
// `sky.svelte.ts` needs to attenuate the key light).

// `ease` is the same smoothstep the day curve samples with, so blends read the same way.
import { clamp01, ease, lerp, smooth01, wrap01 } from './math';
import type { RGB, SkyBaseline, WeatherChannels, WeatherTarget } from './types';

export type ChannelName = keyof WeatherChannels;

export const CHANNEL_NAMES: ChannelName[] = [
	'cloudCover',
	'cloudType',
	'fog',
	'precipitation',
	'precipitationType',
	'wind',
	'windDirection',
	'lightning'
];

/**
 * Channels that are an ANGLE, so [0,1) is a circle, not a line: these blend along the
 * shorter arc and wrap on write instead of clamping (clamped interpolation from 0.95
 * to 0.05 would sweep nine tenths of the way round through south).
 */
const WRAPPED_CHANNELS = new Set<ChannelName>(['windDirection']);

/**
 * Precipitation at or below which nothing is falling, so `precipitationType` is not
 * observable and may be changed for free. See the type's handling in `set`.
 */
const DRY = 1e-3;

/**
 * A named weather is a **target vector**, not a script.
 *
 * `stagger` is the fraction of the blend duration a channel waits before it starts
 * moving; every channel still finishes together. That is what makes a storm *arrive*
 * rather than appear, and it is a property of the weather, not the mixer -- a fog bank
 * rolls in a different order to a squall.
 */
export type WeatherDefinition = {
	target: Partial<WeatherChannels>;
	stagger?: Partial<Record<ChannelName, number>>;
};

/**
 * The named weather library. Kept in code, exactly as `DEFAULT_DAY_CURVE` is; it moves
 * to the authored `weather.json` when the config plumbing lands (see ../CLAUDE.md).
 * Values are the whole definition -- there is no hidden per-weather colour or light
 * data, so anything a weather does to the look is reachable from `setWeather({ ... })`
 * with raw channels too. Every channel has a renderer: `lightning` drives Lightning's
 * strike scheduler, `wind` drives CloudDeck's scroll (and Rain's slant),
 * `precipitationType` picks Rain vs Snow through `rainShare`, `windDirection` gives
 * them a bearing.
 *
 * NOTE ON `precipitationType` IN DRY WEATHERS: authored to 1 (rain) everywhere nothing
 * is falling, deliberately. A raw partial leaves unmentioned channels where they are,
 * so `setWeather({ precipitation: 0.8 })` from a dry weather inherits the type it was
 * carrying -- and "rain" is the answer a caller who did not mention snow expects.
 */
export const WEATHERS: Record<string, WeatherDefinition> = {
	clear: {
		target: {
			cloudCover: 0,
			cloudType: 0,
			fog: 0,
			precipitation: 0,
			precipitationType: 1,
			wind: 0.08,
			windDirection: 0.12,
			lightning: 0
		}
	},
	cloudy: {
		target: {
			cloudCover: 0.25,
			cloudType: 0.2,
			fog: 0.05,
			precipitation: 0,
			precipitationType: 1,
			wind: 0.25,
			windDirection: 0.18,
			lightning: 0
		},
		stagger: { wind: 0.2 }
	},
	overcast: {
		// 0.35 is an authored LOOK value: SkyMesh's cloud mask saturates early, so by ~0.5
		// the dome reads as a flat sheet (see ./CLAUDE.md). Consequence: 0.35 is below
		// DECK_THRESHOLD, so `overcast` keeps its shadows -- the flat shadowless deck
		// lives at `rain` and above.
		target: {
			cloudCover: 0.35,
			cloudType: 0.45,
			fog: 0.18,
			precipitation: 0,
			precipitationType: 1,
			wind: 0.3,
			windDirection: 0.22,
			lightning: 0
		},
		stagger: { fog: 0.3, wind: 0.15 }
	},
	fog: {
		// Low wind on purpose: fog that survives is fog nothing is blowing away.
		// Little cloud with it: this is ground mist under a mostly clear sky, which is why
		// it keeps its sunbeams and shadows.
		target: {
			cloudCover: 0.15,
			cloudType: 0.1,
			fog: 0.85,
			precipitation: 0,
			precipitationType: 1,
			wind: 0.03,
			windDirection: 0.05,
			lightning: 0
		},
		stagger: { fog: 0.1, cloudCover: 0 }
	},
	rain: {
		target: {
			cloudCover: 0.8,
			cloudType: 0.6,
			fog: 0.3,
			precipitation: 0.6,
			precipitationType: 1,
			wind: 0.4,
			windDirection: 0.3,
			lightning: 0
		},
		stagger: { wind: 0.2, fog: 0.3, precipitation: 0.45 }
	},
	storm: {
		target: {
			cloudCover: 1,
			cloudType: 1,
			fog: 0.35,
			precipitation: 1,
			precipitationType: 1,
			wind: 0.85,
			windDirection: 0.62,
			lightning: 0.8
		},
		stagger: { wind: 0.15, fog: 0.3, precipitation: 0.45, lightning: 0.6 }
	},
	snow: {
		// A snow deck is thick: `cloudType` 0.7, read by both `Sky.svelte` and
		// `CloudDeck.svelte` for exactly that.
		target: {
			cloudCover: 0.9,
			cloudType: 0.7,
			fog: 0.5,
			precipitation: 0.7,
			precipitationType: 0,
			wind: 0.3,
			windDirection: 0.44,
			lightning: 0
		},
		stagger: { fog: 0.25, precipitation: 0.4 }
	},
	blizzard: {
		// The snow side's extreme: sits above `snow` on every shared channel. `fog` is the
		// defining one, not `precipitation` -- a blizzard is a WHITEOUT, and the fog channel
		// is what pulls SkyFog's band toward the camera (0.8, second only to the dedicated
		// `fog` weather's 0.85). `lightning` stays 0: thundersnow is real and rare, and a
		// caller who wants it can `setWeather({ lightning: 0.5 })` on top.
		target: {
			cloudCover: 1,
			cloudType: 0.9,
			fog: 0.8,
			precipitation: 1,
			// 0 = snow, and explicit: from `rain` both ends are wet so this genuinely blends
			// across the sleet band; from anything dry it snaps.
			precipitationType: 0,
			// The highest wind in the library (`storm` is 0.85) -- snow driven sideways.
			wind: 0.95,
			windDirection: 0.5,
			lightning: 0
		},
		// It arrives as weather does: wind first, then snow, then the whiteout closes in
		// -- all landing together at the end of the blend.
		stagger: { wind: 0.05, cloudCover: 0.1, precipitation: 0.3, fog: 0.5 }
	}
};

/** Default blend, in ms. Long enough that weather reads as arriving, not switching. */
export const DEFAULT_BLEND_MS = 20_000;

export type WeatherOptions = {
	/** Blend duration in ms. `0` snaps -- callers must treat that as a discontinuity. */
	over?: number;
};

type Blend = {
	from: number;
	to: number;
	/** ms to wait before this channel starts moving. */
	delay: number;
	/** ms the channel takes once it starts. */
	duration: number;
	elapsed: number;
};

export type WeatherMixer = {
	/** The live channel vector. Mutated in place -- hold the reference, never copy it. */
	readonly channels: WeatherChannels;
	/** Name of the last named weather set, or `'custom'` after a raw target. */
	readonly name: string;
	/** True while any channel is still moving. */
	readonly blending: boolean;
	/** Point the mixer at a named weather or a raw partial channel vector. */
	set(target: WeatherTarget, options?: WeatherOptions): void;
	/** Advance the blend. Mutates `channels`. Returns true if anything moved. */
	tick(deltaMs: number): boolean;
};

/**
 * @param channels the object the mixer will own and mutate. `sky.svelte.ts` passes
 * `descriptor.weather` directly, so the descriptor never needs a per-frame copy.
 * @param initialName what `channels` already holds -- the mixer cannot infer a name
 * from a vector, and `'default'` would mislabel a caller that seeded from a named
 * weather.
 */
export const createWeatherMixer = (
	channels: WeatherChannels,
	initialName = 'default'
): WeatherMixer => {
	const blends = new Map<ChannelName, Blend>();
	let name = initialName;
	let blending = false;

	const resolve = (target: WeatherTarget): Partial<WeatherChannels> => {
		if (typeof target !== 'string') {
			name = 'custom';
			return target;
		}
		const definition = WEATHERS[target];
		if (!definition) return {};
		name = target;
		return definition.target;
	};

	return {
		channels,
		get name() {
			return name;
		},
		get blending() {
			return blending;
		},

		set(target, options = {}) {
			const over = Math.max(0, options.over ?? DEFAULT_BLEND_MS);
			const stagger = typeof target === 'string' ? WEATHERS[target]?.stagger : undefined;
			const values = resolve(target);

			// IS ANYTHING FALLING AT EITHER END? `precipitationType` is a POSITION whose
			// journey is visible independently of its destination: sweeping rain -> snow
			// crosses the sleet band, which is right only while something is falling through
			// it. A raw partial that omits `precipitation` leaves it where it is, so the
			// target falls back to the current value, not zero.
			const wetNow = clamp01(channels.precipitation) > DRY;
			const wetAfter = clamp01(values.precipitation ?? channels.precipitation) > DRY;

			blends.clear();
			for (const channel of CHANNEL_NAMES) {
				const to = values[channel];
				if (to === undefined) continue;

				const wrapped = WRAPPED_CHANNELS.has(channel);
				const target = wrapped ? wrap01(to) : clamp01(to);
				if (over === 0) {
					// A snap. Land it now rather than queueing a zero-length blend, so
					// callers reading `channels` on the same tick see the final value.
					channels[channel] = target;
					continue;
				}

				// THE TYPE ONLY BLENDS WHEN BOTH ENDS ARE WET. Otherwise the change is
				// unobservable at one end, and it is applied THERE instead -- where nothing
				// can be seen crossing the sleet band (blending it regardless once made every
				// dry-to-snow transition open as rain). `rain` <-> `snow` is wet at both
				// ends and still blends: that transition genuinely passes through sleet.
				if (channel === 'precipitationType' && !(wetNow && wetAfter)) {
					if (!wetNow) {
						// Nothing falling yet: the type is free NOW, so the first flake of the
						// coming fall is already the right kind.
						channels[channel] = target;
					} else {
						// Falling now, dry by the end: the type is free THEN. A delay of the full
						// duration lands it on the frame the fade completes (and
						// `precipitation` is earlier in CHANNEL_NAMES, so it is already zero).
						blends.set(channel, {
							from: channels[channel],
							to: target,
							delay: over,
							duration: 1,
							elapsed: 0
						});
					}
					continue;
				}

				// For an angle, walk the start point around the circle so that plain
				// interpolation takes the short way. The result can leave [0,1) mid-blend,
				// which `tick` wraps back on write -- consumers never see it out of range.
				let from = channels[channel];
				if (wrapped) {
					const delta = target - from;
					if (delta > 0.5) from += 1;
					else if (delta < -0.5) from -= 1;
				}

				const delay = over * clamp01(stagger?.[channel] ?? 0);
				blends.set(channel, {
					from,
					to: target,
					delay,
					// Every channel finishes together; only the onset is staggered.
					duration: Math.max(1, over - delay),
					elapsed: 0
				});
			}

			blending = blends.size > 0;
		},

		tick(deltaMs) {
			if (blends.size === 0) return false;

			for (const [channel, blend] of blends) {
				blend.elapsed += deltaMs;
				if (blend.elapsed < blend.delay) continue;

				const k = Math.min(1, (blend.elapsed - blend.delay) / blend.duration);
				const value = lerp(blend.from, blend.to, ease(k));
				// The short-arc walk in `set` can put `from` outside [0,1); bring the
				// result back so no consumer ever reads a bearing of -0.05 or 1.05.
				channels[channel] = WRAPPED_CHANNELS.has(channel) ? wrap01(value) : value;
				if (k >= 1) blends.delete(channel);
			}

			blending = blends.size > 0;
			return true;
		}
	};
};

// ── Modulation ─────────────────────────────────────────────────────────────────
//
// Everything below is pure: (baseline, channels) -> modulated baseline. No state.

/**
 * Fraction of the key light a full cloud deck removes. Deliberately strong: a closed
 * deck turns a point source into a hemisphere, so near solid cover the day is
 * effectively shadowless. The light does not vanish -- see AMBIENT_RETURN. With
 * `overcast` at 0.35 the weathers that actually reach this are `rain`, `snow`, `storm`.
 */
export const KEY_ATTENUATION = 0.85;
/**
 * Fog's share of the key attenuation. Fog scatters rather than absorbs, so the light
 * comes back (via AMBIENT_RETURN) but stops arriving from a direction -- which is the
 * part that matters for shadows.
 */
export const KEY_FOG_ATTENUATION = 0.7;
/**
 * How much of the light the deck took off the key comes back as ambient fill. The
 * intercepted energy is re-emitted diffusely, so an overcast noon reads flat and bright
 * rather than dim -- without this, the constant that kills the shadows also kills the
 * daylight.
 */
export const AMBIENT_RETURN = 0.45;

/**
 * Cover below which clouds are scattered, not a deck. The key light must not scale
 * linearly with cover: the sky boots at non-zero `cloudCover` (so linear scaling would
 * change the default look before anyone calls setWeather), and intermittent sun through
 * scattered cover still reads as a sunny day. `deckFactor` below smoothsteps from here
 * to solid cover.
 */
export const DECK_THRESHOLD = 0.4;

/**
 * How much the cloud layer behaves like a deck: 0 = scattered cloud, 1 = solid overcast.
 * Everything that touches the KEY LIGHT goes through this -- attenuation, ambient
 * return, desaturation, night fills. The baseline modulation deliberately uses raw
 * cover: thin cloud adds haze and hides stars, and none of that touches shadows.
 */
export const deckFactor = (cloudCover: number): number =>
	smooth01(DECK_THRESHOLD, 1, clamp01(cloudCover));

/** How much of the key light's direct throw survives the current weather. */
export const keyAttenuation = (w: WeatherChannels): number =>
	(1 - KEY_ATTENUATION * deckFactor(w.cloudCover)) * (1 - KEY_FOG_ATTENUATION * clamp01(w.fog));

/**
 * How much of a celestial body reaches the ground -- the descriptor's `visibility`.
 * Harsher than the light attenuation on purpose: a body is either *seen* or not, and
 * thin cover that still passes usable light already hides the disc.
 */
export const bodyVisibility = (w: WeatherChannels): number =>
	clamp01((1 - 0.95 * clamp01(w.cloudCover)) * (1 - 0.6 * clamp01(w.fog)));

/**
 * Where the type channel stops being sleet and becomes wholly one thing or the other.
 * Endpoints matter more than the midpoint: outside the band exactly ONE precipitation
 * layer is live, so the common case pays for one field of particles. Inside it both
 * render, which is what sleet is.
 */
const SLEET_FROM = 0.35;
const SLEET_TO = 0.65;

/**
 * How the single `precipitation` amount divides between the rain and snow renderers.
 * ONE definition, three consumers (`Rain`, `Snow`, `RainLens`) -- never re-derive the
 * split in a layer; drifted copies have produced a real bug before. The two shares
 * always sum to the amount, so intensity is conserved across the sleet band.
 */
export const rainShare = (w: WeatherChannels): number =>
	smooth01(SLEET_FROM, SLEET_TO, clamp01(w.precipitationType));

export const rainAmount = (w: WeatherChannels): number => clamp01(w.precipitation) * rainShare(w);

export const snowAmount = (w: WeatherChannels): number =>
	clamp01(w.precipitation) * (1 - rainShare(w));

/**
 * The wind's horizontal axis, as two scalars rather than a vector: callers read these
 * once per frame from a task, and an object would allocate 60x a second for two numbers.
 * `windDirection` is one full turn over [0,1); bearing 0 points along +Z, the axis the
 * renderers were hardcoded to before this channel existed.
 */
const TAU = Math.PI * 2;

export const windAxisX = (w: WeatherChannels): number => Math.sin(wrap01(w.windDirection) * TAU);
export const windAxisZ = (w: WeatherChannels): number => Math.cos(wrap01(w.windDirection) * TAU);

/**
 * Apply the weather channels over a sampled day-curve baseline, in place.
 *
 * Called every frame, so it allocates nothing and writes through `out`.
 */
export const modulateBaseline = (out: SkyBaseline, w: WeatherChannels): SkyBaseline => {
	const cloud = clamp01(w.cloudCover);
	const fog = clamp01(w.fog);

	// Thicker air: more turbidity and more mie, LESS rayleigh. An overcast sky is not a
	// bluer sky, it is a greyer one, so the blue-scattering term has to come down while
	// the large-particle terms go up. Raising all three together is the classic mistake
	// and produces a vivid, saturated storm.
	out.turbidity = Math.min(20, out.turbidity + cloud * 3.5 + fog * 2.5);
	out.mieCoefficient = Math.min(0.05, out.mieCoefficient + cloud * 0.004 + fog * 0.005);
	out.rayleigh = Math.max(0.15, out.rayleigh * (1 - 0.45 * cloud - 0.3 * fog));

	// Only a slight stop-down. Most of an overcast day's darkening is the key light
	// losing 85% of its throw (keyAttenuation), not the camera closing up. Doing both at
	// full strength double-counts and crushes an overcast noon into dusk.
	out.exposure *= 1 - 0.08 * cloud - 0.05 * fog;

	// A deck hides stars outright; fog only veils them.
	out.starVisibility *= (1 - cloud) * (1 - 0.7 * fog);

	// Fog colour, derived from the two channels rather than authored per weather:
	// desaturate toward the baseline's luminance under cover, darken under a deck, lift
	// toward white as the fog thickens -- so storm reads dark grey and fog a white-out
	// from the same expression, and a raw partial gets the identical treatment.
	const [r, g, b] = out.fogColor;
	const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
	const desaturate = clamp01(cloud * 0.75 + fog * 0.6);
	const darken = 1 - 0.35 * cloud;
	// The lift is gated on how much light there is to scatter: ungated, a midnight
	// storm's fog glowed brighter than the sky it hangs under. Luminance doubles as the
	// daylight proxy because the curve's fog colours already track the day.
	const lift = 0.28 * fog * Math.min(1, luminance * 2);
	for (let i = 0; i < 3; i++) {
		const channel = lerp((out.fogColor as RGB)[i], luminance, desaturate) * darken;
		(out.fogColor as RGB)[i] = channel + (1 - channel) * lift;
	}

	// The fog channel thickens the air; a deck only makes the existing haze read
	// somewhat heavier. Both terms are restrained because the curve's authored densities
	// are already high at the ends of the day and multiply straight through -- SkyFog's
	// `densityScale` is the world-scale knob; these are the shape of the curve.
	out.fogDensity = out.fogDensity * (1 + 0.6 * cloud) + fog * 0.12;

	return out;
};
