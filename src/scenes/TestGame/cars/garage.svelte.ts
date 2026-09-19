// The garage — the car registry and which car the demo currently runs. Three
// cars today (GR86, RS3, GTI-R); a new one is one spec file + one entry here,
// and the scene/sim/FX code does not change (see types.ts for the contract).
//
// `carGarage.currentId` is $state so the Garage shop (Garage.svelte, opened
// from the HUD like the paint shop) can switch it. Nothing that reads
// `currentCar()` is reactive to that write directly — every car-specific
// object (the drivetrain, the suspension instance, the loaded GLB, the FX
// components) is built once when TestGame.svelte mounts, so switching cars
// works by REMOUNTING the scene: Scene.svelte keys its `<TestGame />` on
// `carGarage.currentId`, so writing a new id tears the whole car-specific
// subtree down and rebuilds it fresh against the new spec, the same as
// leaving and re-entering the scene. `currentCar()` itself is cheap (an
// object lookup) but still meant to be read once at mount/init, not per
// frame, which is also the rule for everything else the physics task touches.

import type { CarSpec } from './types';
import { gr86 } from './gr86';
import { rs3 } from './rs3';
import { gtir } from './gtir';

export const CARS = { gr86, rs3, gtir } as const satisfies Record<string, CarSpec>;

export type CarId = keyof typeof CARS & string;

export const carGarage = $state<{ currentId: CarId }>({ currentId: 'gr86' });

/** The spec of the car the demo is running. Constant today; still read once at
 *  init, never per frame. */
export function currentCar(): CarSpec {
	return CARS[carGarage.currentId];
}

export type { CarSpec } from './types';
