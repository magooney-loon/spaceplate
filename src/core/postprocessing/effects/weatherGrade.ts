// What the weather does to the frame's COLOUR — the half of rain that no amount of
// drops can draw.
//
// A storm changes the light in a scene, and until this existed ours did not: the sky
// went grey, the fog came in and the rain fell, while every lit surface under it kept
// exactly the saturation it had at noon. That is the tell that reads as "weather effect
// switched on" rather than as weather — a sunny scene with rain pasted over it.
//
// Two terms, both driven by `SkyFog`'s task through `$core/skybox/weatherGrade.svelte`
// (the shared-uniform driver contract in ../CLAUDE.md), not by these sliders. The
// sliders are the CEILING each term reaches at full weather.
//
// Order 48: after bloom (40) and anamorphic (41), so the grade does not change which
// highlights earn a bloom or a streak — those thresholds are tuned against the scene's
// own radiance and would move under a desaturating pass. Before vignette (50), so the
// lens falloff still darkens a graded frame rather than being graded itself. Still
// pre-tonemap, like everything in the chain.
//
// DEFAULT-ENABLED WITH NO STRUCTURAL LATCH, which is `afterimage`'s bargain rather than
// `fogScatter`'s: see the long version in the state module. At rest both uniforms are 0,
// `saturation(rgb, 1)` is an identity and the `mix` weight is 0, so a clear-weather frame
// is returned unchanged for the price of one saturation and one mix.

import { Fn, float, mix, saturation, vec3, vec4 } from 'three/tsl';
import { uWeatherCool, uWeatherDesaturate } from '$core/skybox/weatherGrade.svelte';
import type { EffectDef } from '../types';

export type WeatherGradeParams = {
	/** Saturation removed at full precipitation. 1 would be a black-and-white storm. */
	desaturate: number;
	/** How far the frame is pulled toward the cool tint at full precipitation. */
	cool: number;
};

/**
 * The cool end. A blue-grey rather than a blue: a saturated blue tint is the "night
 * filter" look, and what wet overcast daylight actually does is pull the whole frame
 * toward the colour of a white sky seen through water.
 */
const COOL_TINT = vec3(0.78, 0.87, 1.0);

const weatherGradeFn = Fn(([color, desaturate, cool]: any[], _builder: any) => {
	// `saturation(rgb, 1)` is the identity, so the driver's 0 has to arrive as a 1 here.
	const graded = saturation(color.rgb, float(1).sub(desaturate));

	// MULTIPLIED by the tint, not mixed toward it. A mix would pull the frame toward a
	// fixed colour and therefore LIFT the blacks — a washed-out storm rather than a cold
	// one — while a multiply is what a filter in front of a lens actually does: it takes
	// light away from the channels it does not pass, and leaves black black.
	const tinted = graded.mul(mix(vec3(1, 1, 1), COOL_TINT, cool));

	// rgb only; alpha carried through untouched, as `vignette` does.
	return vec4(tinted, color.a);
});

export const weatherGradeEffect: EffectDef<WeatherGradeParams> = {
	id: 'weatherGrade',
	label: 'Weather Grade',
	role: 'chain',
	order: 48,
	requires: [],
	params: () => ({ desaturate: 0.35, cool: 0.5 }),
	defaultEnabled: true,
	ranges: {
		desaturate: { min: 0, max: 1, step: 0.01 },
		cool: { min: 0, max: 1, step: 0.01 }
	},
	note: 'Driven by the weather, not by these sliders — they are the ceiling each term reaches at full precipitation, and in clear weather the effect is an exact identity. The colour half of rain: a storm that leaves every surface as saturated as it was at noon reads as an effect switched on rather than as weather.',
	build: (ctx, u) =>
		weatherGradeFn(ctx.color, uWeatherDesaturate.mul(u.desaturate), uWeatherCool.mul(u.cool))
};
