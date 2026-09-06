// Barrel for the garage — import from './cars' (or '../cars'). The $state lives
// in garage.svelte.ts (Svelte modules need the .svelte.ts suffix); this plain
// barrel exists because directory imports resolve index.ts, not index.svelte.ts.

export { CARS, carGarage, currentCar } from './garage.svelte';
export type { CarId } from './garage.svelte';
export type { CarSpec, CarLayout, TorquePoint } from './types';
