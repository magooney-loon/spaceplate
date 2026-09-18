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

import { currentCar } from '../cars';
import type { PaintFinish, PaintOption } from '../cars/types';

const PAINTS = currentCar().model.paints;

/** The selected paint's id + the finish it wears (the paint's factory finish
 *  until the shop's chips say otherwise). */
export const carPaint = $state<{ id: string; finish: PaintFinish }>({
	id: PAINTS[0]?.id ?? '',
	finish: PAINTS[0]?.finish ?? 'solid'
});

/** The selected paint option — PAINTS[0] as the fallback, so a stale id (an
 *  edited order sheet) can never leave the car unpainted. NOT reactive —
 *  reads carPaint.id; call from an effect that already tracks it. */
export function currentPaintOption(): PaintOption {
	return PAINTS.find((paint) => paint.id === carPaint.id) ?? PAINTS[0];
}

export function selectPaint(id: string): void {
	const paint = PAINTS.find((entry) => entry.id === id);
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
