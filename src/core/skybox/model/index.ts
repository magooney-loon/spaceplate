// Barrel for the sky model — import from '$core/skybox/model'.
// Modules inside model/ import each other relatively, never via this barrel.
//
// clock / sunPath / dayCurve / phases / events are pure: no Svelte, no three.js.
// sky.svelte.ts is the only stateful module. The consumer components
// (Sky / SkyLight / Skybox) live one directory up. See DOCS/weather-system.md §14.

export * from './sky.svelte';
export { createClock, createRealtimeClock, createExternalClock, createManualClock } from './clock';
export type { Clock, ClockOptions } from './clock';
export { elevationAt, azimuthAt, sunAt, moonAt } from './sunPath';
export type { PathOptions } from './sunPath';
export { sampleDayCurve, createBaseline } from './dayCurve';
export { phaseFor, isRising, isDaytime } from './phases';
