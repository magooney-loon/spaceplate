// The garage — the car registry and which car the demo currently runs. One
// car today (the GR86); a second car is one spec file + one entry here, and
// the scene/sim/FX code does not change (see types.ts for the contract).
//
// `carGarage.currentId` is $state so a future car-picker UI (or a Studio dev
// panel) can switch reactively; until then it is written exactly once at boot.
// Everything reads it through `currentCar()`, which is cheap (an object lookup)
// but NOT reactive — read it once at mount/init, not per frame, which is also
// the rule for everything else the physics task touches.

import type { CarSpec } from './types';
import { gr86 } from './gr86';

export const CARS = { gr86 } as const satisfies Record<string, CarSpec>;

export type CarId = keyof typeof CARS & string;

export const carGarage = $state<{ currentId: CarId }>({ currentId: 'gr86' });

/** The spec of the car the demo is running. Constant today; still read once at
 *  init, never per frame. */
export function currentCar(): CarSpec {
	return CARS[carGarage.currentId];
}

export type { CarSpec } from './types';
