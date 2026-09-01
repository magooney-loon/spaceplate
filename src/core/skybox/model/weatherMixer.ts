// Weather (§5). Phase 2.
//
// Weather is NOT a preset of the sky. It is a modulation layer applied on top of the
// day-curve baseline: a storm at noon is still noon under clouds. The sun still drives
// scattering and light; weather attenuates, adds and obscures. That composition -- day
// curve *under* weather, never *instead of* it -- is what makes this a system rather
// than the preset swap it replaced.
//
// Pure: no Svelte, no three.js. Two halves live here:
//
//   createWeatherMixer  -- the stateful-but-plain mixer. Holds the current channel
//                          vector and eases it toward a target, per channel, with a
//                          staggered onset. Mutates its channel object in place.
//   modulateBaseline    -- the pure function that applies a channel vector over a
//                          sampled SkyBaseline, plus the light/visibility helpers that
//                          sky.svelte.ts needs to attenuate the key light.

// `ease` is the same smoothstep the day curve samples with, so a weather blend and a
// time transition read the same way.
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
 * Channels that are an ANGLE, so [0,1) is a circle and not a line.
 *
 * These blend along the shorter arc and wrap on write instead of clamping. Easing a
 * bearing from 0.95 to 0.05 has to cross north in a tenth of a turn; clamped linear
 * interpolation would instead sweep nine tenths of the way round through south, and the
 * rain would visibly rotate the wrong way for the whole twenty seconds.
 */
const WRAPPED_CHANNELS = new Set<ChannelName>(['windDirection']);

/**
 * Precipitation at or below which nothing is falling, so `precipitationType` is not
 * observable and may be changed for free. See the type's handling in `set`.
 */
const DRY = 1e-3;

/**
 * A named weather is a **target vector**, not a script (§5.3).
 *
 * `stagger` is the fraction of the blend duration a channel waits before it starts
 * moving; every channel still finishes together. That is what makes a storm *arrive*
 * rather than appear: clouds thicken, then the wind gets up, then the rain starts. It
 * is a property of the weather, not of the mixer, because a fog bank rolling in has a
 * completely different order to a squall.
 */
export type WeatherDefinition = {
	target: Partial<WeatherChannels>;
	stagger?: Partial<Record<ChannelName, number>>;
};

/**
 * The named weather library.
 *
 * Kept in code, exactly as `DEFAULT_DAY_CURVE` is: these are the shipped defaults, and
 * they move to the authored `weather.json` when the config plumbing lands (§16). Values
 * are the whole definition -- there is no hidden per-weather colour or light data, so
 * anything a weather does to the look is reachable from `setWeather({ ... })` with raw
 * channels too.
 *
 * `lightning` drives `Lightning.svelte`'s strike scheduler and `wind` drives
 * `CloudDeck.svelte`'s scroll offset (plus `Rain.svelte`'s slant) -- every channel has a
 * renderer. `precipitationType` picks between `Rain.svelte` and `Snow.svelte` through
 * `precipitationSplit`, and `windDirection` gives all three of those a bearing.
 *
 * NOTE ON `precipitationType` IN DRY WEATHERS. It is authored to 1 (rain) everywhere
 * nothing is falling, and that is deliberate rather than a leftover. A raw partial leaves
 * unmentioned channels where they are, so `setWeather({ precipitation: 0.8 })` from a dry
 * weather inherits whatever type it was carrying -- and "rain" is the answer a caller who
 * did not mention snow expects. Under the old `cloudType` gate that same call from `clear`
 * produced snow.
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
		// 0.35 is an authored LOOK value, not a physical fraction of sky covered.
		// SkyMesh's cloud layer saturates early -- its mask is
		// `smoothstep(1 - coverage, 1 - coverage + 0.3, fbm)` -- so by ~0.5 nearly the whole
		// dome has passed the threshold and the sky reads as a flat sheet rather than as
		// cloud. 0.35 is where it looks like overcast.
		//
		// The consequence is deliberate and worth knowing: 0.35 is below DECK_THRESHOLD, so
		// `overcast` does NOT attenuate the key light and keeps its shadows. If you want the
		// flat, shadowless overcast the light model can produce, that lives at `rain` and
		// above now.
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
		// `cloudType` RAISED from 0.35 to 0.7 now that it no longer selects the
		// precipitation type. 0.35 was never a look decision -- it was the highest value
		// that stayed under the old rain gate at 0.45, which forced a heavy snowfall to
		// render thin, wispy cloud. A snow deck is thick, and both `Sky.svelte` and
		// `CloudDeck.svelte` read this channel for exactly that.
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
 */
export const createWeatherMixer = (channels: WeatherChannels): WeatherMixer => {
	const blends = new Map<ChannelName, Blend>();
	let name = 'default';
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

			// IS ANYTHING FALLING AT EITHER END? `precipitationType` is a POSITION, and the
			// only one of the eight whose journey is visible independently of its
			// destination: sweeping it from rain to snow crosses the sleet band, and sleet
			// is the right thing to see only while something is actually falling through it.
			// A raw partial that omits `precipitation` leaves it where it is, so the target
			// reading falls back to the current value rather than to zero.
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
				// unobservable at one end of the blend, and it is applied THERE instead --
				// where nothing is falling and nothing can be seen crossing the sleet band.
				//
				// Blending it regardless is what made every dry-to-snow transition rain
				// first. `clear` authors the type at 1 and `snow` at 0 (both deliberately --
				// see the note on WEATHERS), and `snow` staggers its `precipitation` to 0.4,
				// so over a 20 s blend the type began sweeping at t=0 while the first flake
				// did not fall until t=8 s -- by which point the type had reached only ~0.65,
				// the very top of the sleet band. The snowfall opened as 99% RAIN, sleeted
				// for a few seconds, and became snow with a third of the blend left. In
				// reverse, departing snow turned to rain as it thinned out.
				//
				// `rain` <-> `snow` is wet at both ends and still blends normally: that
				// transition genuinely passes through sleet, which is the whole point of
				// having a band.
				if (channel === 'precipitationType' && !(wetNow && wetAfter)) {
					if (!wetNow) {
						// Nothing is falling yet, so the type is free right now. Setting it
						// here means the first flake of the coming fall is already the right
						// kind, instead of arriving as rain and converting in view.
						channels[channel] = target;
					} else {
						// Something is falling now and nothing will be by the end, so the
						// type is free THEN. A delay of the full duration against the
						// one-millisecond floor below lands it on the frame the fade
						// completes -- and `precipitation` is earlier in CHANNEL_NAMES, so
						// it has already reached zero when this fires.
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
 * Fraction of the key light a full cloud deck removes.
 *
 * Deliberately strong: near solid cover the day is effectively shadowless, which is what
 * a closed deck does -- it turns a point source into a hemisphere. The light does not
 * simply vanish, though; see AMBIENT_RETURN.
 *
 * Note that with `overcast` authored at 0.35 (a SkyMesh look value, see WEATHERS) the
 * weathers that actually reach this are `rain`, `snow` and `storm`.
 */
export const KEY_ATTENUATION = 0.85;
/**
 * Fog's share. Slightly gentler than a deck, but not by much.
 *
 * The first pass had this at 0.35, which measured out at 52% of the key surviving the
 * `fog` weather -- hard directional shadows through a 76%-opaque white-out. Fog scatters
 * rather than absorbs, so the light does come back (again via AMBIENT_RETURN), but it
 * stops arriving from a direction, which is the part that matters for shadows.
 */
export const KEY_FOG_ATTENUATION = 0.7;
/**
 * How much of the light the deck took off the key comes back as ambient fill.
 *
 * This is the half that keeps "strong attenuation" from meaning "dark". The energy the
 * cloud layer intercepts is not destroyed, it is re-emitted diffusely, so an overcast
 * noon must read flat and bright rather than dim. Without this the same constant that
 * kills the shadows also kills the daylight, and overcast looks like dusk.
 */
export const AMBIENT_RETURN = 0.45;

/**
 * Cover below which clouds are scattered, not a deck.
 *
 * THE LIGHT MUST NOT SCALE LINEARLY WITH COVER. The first pass did, and it was wrong in
 * a way that had nothing to do with weather: the sky boots at a non-zero `cloudCover`, so
 * every scene silently lost 31% of its key light and gained 0.111 of hemisphere fill
 * before anyone called setWeather. The default look changed, and washed-out shadows were
 * the visible symptom.
 *
 * It is also wrong physically. A directional light models the sun as always-visible; 37%
 * cover means the sun is *intermittently* occluded, which a single directional light
 * cannot represent and which, at ground level, looks like a sunny day with clouds in the
 * sky. Only once the cover closes into a layer does it start behaving like a diffuser.
 *
 * So the light reads a smoothstepped "deck factor" instead of raw cover: exactly zero
 * below 0.4 (the boot default is therefore byte-for-byte the phase-1 look), and ramping
 * to full only as cover approaches solid.
 */
export const DECK_THRESHOLD = 0.4;

/**
 * How much the cloud layer behaves like a deck: 0 = scattered cloud, 1 = solid overcast.
 *
 * Everything that touches the KEY LIGHT goes through this -- attenuation, the ambient
 * return, the colour desaturation, and the night fills in `sky.svelte.ts`. The baseline
 * sky modulation below deliberately does not: thin cloud genuinely adds haze and hides
 * stars, and none of that touches the shadows.
 */
export const deckFactor = (cloudCover: number): number =>
	smooth01(DECK_THRESHOLD, 1, clamp01(cloudCover));

/** How much of the key light's direct throw survives the current weather. */
export const keyAttenuation = (w: WeatherChannels): number =>
	(1 - KEY_ATTENUATION * deckFactor(w.cloudCover)) * (1 - KEY_FOG_ATTENUATION * clamp01(w.fog));

/**
 * How much of a celestial body reaches the ground -- the descriptor's `visibility`.
 *
 * Slightly harsher than the light attenuation on purpose: a body is either *seen* or it
 * is not, and thin cover that still passes usable light already hides the disc.
 */
export const bodyVisibility = (w: WeatherChannels): number =>
	clamp01((1 - 0.95 * clamp01(w.cloudCover)) * (1 - 0.6 * clamp01(w.fog)));

/**
 * Where the type channel stops being sleet and becomes wholly one thing or the other.
 *
 * Endpoints matter more than the midpoint here: outside this band exactly ONE
 * precipitation layer is live, so the common case pays for one field of particles and not
 * two. Inside it both render, which is what sleet is.
 */
const SLEET_FROM = 0.35;
const SLEET_TO = 0.65;

/**
 * How the single `precipitation` amount divides between the rain and snow renderers.
 *
 * ONE definition, three consumers (`Rain`, `Snow`, `RainLens`). The gate constants used to
 * be copy-pasted into each of them -- the precise arrangement `skyLayer.ts` documents as
 * having already produced a real bug once, where the copies drifted and nobody noticed
 * because both versions still rendered something.
 *
 * The two shares always sum to the amount, so intensity is conserved across the sleet band
 * rather than doubling in the middle.
 */
export const rainShare = (w: WeatherChannels): number =>
	smooth01(SLEET_FROM, SLEET_TO, clamp01(w.precipitationType));

export const rainAmount = (w: WeatherChannels): number =>
	clamp01(w.precipitation) * rainShare(w);

export const snowAmount = (w: WeatherChannels): number =>
	clamp01(w.precipitation) * (1 - rainShare(w));

/**
 * The wind's horizontal axis, as two scalars rather than a vector.
 *
 * Split in two on purpose: every caller reads these once per frame from a task, and
 * returning an object would allocate 60 times a second per consumer for two numbers. The
 * §14.1 rule about per-frame values applies to garbage as much as to reactivity.
 *
 * `windDirection` is one full turn over [0,1). Bearing 0 points along +Z, which is the
 * axis `CloudDeck` and `Rain` were both hardcoded to before this channel existed, so a
 * scene that never sets a direction keeps the look it had.
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

	// Fog colour, derived entirely from the two channels rather than authored per
	// weather: desaturate toward the baseline's own luminance under cover, darken under
	// a deck, and lift toward white as the fog itself thickens. Storm therefore comes
	// out dark grey and fog comes out a bright white-out, from the same expression --
	// and a raw `setWeather({ fog: 0.9 })` gets the identical treatment, which is the
	// point of having no per-weather colour table.
	const [r, g, b] = out.fogColor;
	const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
	const desaturate = clamp01(cloud * 0.75 + fog * 0.6);
	const darken = 1 - 0.35 * cloud;
	// The lift is gated on how much light there is to scatter, not on the fog channel
	// alone. Ungated, a midnight storm came out at 0.11 grey against the clear night's
	// 0.02 -- fog glowing brighter than the sky it hangs under. Luminance doubles as the
	// daylight proxy here because the curve's own fog colours already track the day.
	const lift = 0.28 * fog * Math.min(1, luminance * 2);
	for (let i = 0; i < 3; i++) {
		const channel = lerp((out.fogColor as RGB)[i], luminance, desaturate) * darken;
		(out.fogColor as RGB)[i] = channel + (1 - channel) * lift;
	}

	// The fog channel is what actually thickens the air; a cloud deck only makes the
	// existing haze read somewhat heavier. Both terms are deliberately restrained
	// because the day curve's authored densities are already high at the ends of the
	// day (0.038 at sunset) and multiply straight through -- SkyFog's `densityScale` is
	// the world-scale knob, and these are the shape of the curve, not its magnitude.
	out.fogDensity = out.fogDensity * (1 + 0.6 * cloud) + fog * 0.12;

	return out;
};
