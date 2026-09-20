// The Garage shop's open state — the change-car counterpart to the paint
// shop (carPaint.svelte.ts's `paintShop`). Garage.svelte writes
// `carGarage.currentId` directly (cars/garage.svelte.ts owns that state) when
// a car is picked; Scene.svelte keys the TestGame mount on that id, so a pick
// remounts the scene fresh against the new car's spec — see garage.svelte.ts's
// header for why a remount is what "switching cars" means here.
//
// NOTE the shop ALSO shows while `!carGarage.picked` regardless of `open`
// (Garage.svelte's gate) — the first car is a choice, not a default; `open`
// alone is the post-first-pick toggle.
//
// Same module rules as carPaint/carSwitches: read from UI/effects (reactive
// through $state), never from the physics task.

export const garageShop = $state({ open: false });

export function toggleGarageShop(): void {
	garageShop.open = !garageShop.open;
}
