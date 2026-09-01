// Barrel for the sky model — import from '$core/skybox/model'.
// Modules inside model/ import each other relatively, never via this barrel.
//
// clock / sunPath / dayCurve / phases / events are pure: no Svelte, no three.js.
// sky.svelte.ts is the only stateful module. The consumer components
// (Sky / SkyLight / Skybox) live one directory up. See DOCS/weather-system.md §14.

export * from './sky.svelte';
// Shared scalar helpers. The layer components pull clamp01 / smooth01 / mulberry32 from
// here rather than each redeclaring them, which is what they used to do.
export { clamp01, ease, lerp, lerpRGB, mulberry32, smooth01, wrap01 } from './math';
export { createClock, createRealtimeClock, createExternalClock, createManualClock } from './clock';
export type { Clock, ClockOptions } from './clock';
export { elevationAt, azimuthAt, sunAt, moonAt } from './sunPath';
export type { PathOptions } from './sunPath';
export { sampleDayCurve, createBaseline } from './dayCurve';
export { phaseFor, isRising, isDaytime } from './phases';
export {
	createWeatherMixer,
	modulateBaseline,
	keyAttenuation,
	bodyVisibility,
	// The precipitation split and the wind bearing. Every layer that renders weather goes
	// through these rather than reading the raw channels -- see `rainAmount`'s note on the
	// copy-paste bug the old inline gate constants were one edit away from.
	rainShare,
	rainAmount,
	snowAmount,
	windAxisX,
	windAxisZ
} from './weatherMixer';
export type { WeatherMixer } from './weatherMixer';
