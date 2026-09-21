// The garage — the car registry and which car the demo currently runs. Three
// cars today (GR86, RS3, GTI-R, files named `<make>_<model>.ts` in specs/); a
// new one is one spec file there + one entry here, and the scene/sim/FX code
// does not change (see types.ts for the contract).
//
// `carGarage.picked` is the first-car gate: false until the player has taken
// delivery, so TestGame mounts NO car at all (`{#if carGarage.picked}` around
// <PlayerCar /> — the world/track is up either way) and Garage.svelte holds
// itself open — the first car is a CHOICE, not a default. The first pick (any
// card) sets it; it is session state like every other latch here, so
// re-entering the scene keeps the car and only a reload asks again.
//
// `currentId` CARRIES A DEFAULT ANYWAY, and that is not the pick: it exists so
// the module singletons that read `currentCar()` at import time (carTelemetry's
// defaults, carAudio's seeds) are boot-safe long before anyone has chosen.
// Nothing should PRESENT it as a choice — Garage.svelte's selected highlight
// and the HUD's car readouts are gated on `picked`, not on this id.
//
// `carGarage.currentId` is $state so the Garage shop (Garage.svelte, opened
// from the HUD like the paint shop) can switch it. Nothing that reads
// `currentCar()` is reactive to that write directly — every car-specific
// object (the drivetrain, the suspension instance, the loaded GLB, the FX
// components) is built once when PlayerCar.svelte mounts, so switching cars
// works by REMOUNTING THE CAR: TestGame.svelte keys its `<PlayerCar />` on
// `carGarage.currentId`, so writing a new id tears the whole car-specific
// subtree down and rebuilds it fresh against the new spec. THE TRACK IS NOT
// PART OF THAT — the key used to sit on `<TestGame />` in Scene.svelte, which
// rebuilt the map (scene graph, trimesh colliders, the ~35 ms minimap contour)
// on every car change for nothing. `currentCar()` itself is cheap (an object
// lookup) but still meant to be read once at mount/init, not per frame, which
// is also the rule for everything else the physics task touches — and never at
// MODULE load in a singleton, which freezes the booting car (carPaint's and
// carAudio's headers).

import type { CarSpec } from './types';
import { toyota_gr86, audi_rs3, nissan_gtir } from './specs';

export const CARS = {
	toyota_gr86,
	audi_rs3,
	nissan_gtir
} as const satisfies Record<string, CarSpec>;

export type CarId = keyof typeof CARS & string;

export const carGarage = $state<{ currentId: CarId; picked: boolean }>({
	currentId: 'toyota_gr86',
	picked: false
});

/** The spec of the car the demo is running. Constant today; still read once at
 *  init, never per frame. */
export function currentCar(): CarSpec {
	return CARS[carGarage.currentId];
}
