// The paint the car is wearing — a latched choice like every other switch in
// carSwitches (survives scene exit and Restart; persistence lands with the
// engine's, which is still an active plan — session state until then). The
// ORDER SHEET itself is car data (spec.model.paints); this file holds only
// the selection: WHICH entry, and WHICH finish it wears. Picking a paint
// resets the finish to that code's factory one; the finish chips then
// override it without touching the colour.
//
// Same module rules as carSwitches: read the id/finish from UI/effects
// (reactive through $state), never from the physics task — nothing there cares.
//
// PAINTS is read fresh from `currentCar()` on every call, NOT snapshotted at
// module load: this module is a singleton (imported once for the process),
// but the Garage shop (sim/garageShop.svelte.ts) can switch cars mid-
// session, and each car has its own order sheet. A stale snapshot from
// whichever car booted first would silently fail every `selectPaint` call
// for every other car (the id would never be found in the wrong list).

import { currentCar } from '../cars';
import type { PaintFinish, PaintOption } from '../cars/types';

function currentPaints(): readonly PaintOption[] {
	return currentCar().model.paints;
}

/** The selected paint's id + the finish it wears (the paint's factory finish
 *  until the shop's chips say otherwise). Reset to the new car's default on
 *  a car switch by PlayerCar.svelte's mount (see garage.svelte.ts). */
export const carPaint = $state<{ id: string; finish: PaintFinish }>({
	id: currentPaints()[0]?.id ?? '',
	finish: currentPaints()[0]?.finish ?? 'solid'
});

/** The selected paint option — the current car's first paint as the fallback,
 *  so a stale id (an edited order sheet, or a fresh car whose list doesn't
 *  contain it) can never leave the car unpainted. NOT reactive — reads
 *  carPaint.id; call from an effect that already tracks it. */
export function currentPaintOption(): PaintOption {
	const paints = currentPaints();
	return paints.find((paint) => paint.id === carPaint.id) ?? paints[0];
}

export function selectPaint(id: string): void {
	const paint = currentPaints().find((entry) => entry.id === id);
	if (!paint) return;
	carPaint.id = paint.id;
	// A fresh code ships as its own finish — the chips are the override.
	carPaint.finish = paint.finish;
}

export function selectFinish(finish: PaintFinish): void {
	carPaint.finish = finish;
}

// --- The shop ----------------------------------------------------------------
//
// Opened and closed by the HUD's Paint Shop button (no key: it is pointer UI,
// and every pad button the input map could spare is taken). A top bar, not a
// modal: no backdrop, the world and the drivetrain keep running — and stay
// clickable — around it.

export const paintShop = $state({ open: false });

export function togglePaintShop(): void {
	paintShop.open = !paintShop.open;
}
