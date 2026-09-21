// SEVEN-SEGMENT GEOMETRY — the shapes CarCluster.svelte's digital readouts (the
// gear indicator and the LCD speed window) are drawn from.
//
// Why not just draw text? Because what sells a digital gauge is the segments that
// DON'T light. A real LCD shows every segment of every cell faintly all the time —
// the "8.8.8." ghost behind a "71" — and a cluster whose numerals simply appear and
// vanish reads as a web page with a big font. Drawing the cells means the ghost is
// free, blanking the panel with the ignition is free, and the glyphs keep their
// stroke weight at any size instead of depending on which font the browser found.
//
// Pure data: every export is a plain string/array, computed once at module load.
// Nothing here is reactive and nothing here knows about the car.

export type SegmentId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

/** Draw order, and the order a cell's polygons are emitted in. */
export const SEGMENT_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

/**
 * Which segments each glyph lights. Standard layout: `a` top, `b`/`c` right
 * (upper/lower), `d` bottom, `e`/`f` left (lower/upper), `g` middle.
 *
 * `n` and `r` are the LOWERCASE forms — the gear indicator's Neutral and Reverse.
 * Seven segments cannot draw a capital N or R (both need a diagonal), and every
 * real seven-segment gearbox display solves it the same way. An unknown character
 * lights nothing, which is exactly what a blank cell should do, so callers can pad
 * with spaces.
 */
export const GLYPHS: Record<string, readonly SegmentId[]> = {
	'0': ['a', 'b', 'c', 'd', 'e', 'f'],
	'1': ['b', 'c'],
	'2': ['a', 'b', 'g', 'e', 'd'],
	'3': ['a', 'b', 'g', 'c', 'd'],
	'4': ['f', 'g', 'b', 'c'],
	'5': ['a', 'f', 'g', 'c', 'd'],
	'6': ['a', 'f', 'g', 'e', 'c', 'd'],
	'7': ['a', 'b', 'c'],
	'8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
	'9': ['a', 'b', 'c', 'd', 'f', 'g'],
	n: ['c', 'e', 'g'],
	r: ['e', 'g'],
	'-': ['g']
};

/** A cell's seven polygons, keyed by segment. `points` attribute strings. */
export type SegmentCell = Record<SegmentId, string>;

/**
 * Build one cell's geometry, in local coordinates with the origin at the cell's
 * TOP-LEFT — translate the group to place it.
 *
 * Each segment is the classic mitred hexagon: a bar of thickness `t` whose ends
 * come to a point, so neighbouring segments meet at a 45° joint instead of
 * overlapping into a blob. `inset` pulls each segment back from the cell's corners,
 * which is the visible gap between them.
 *
 * @param w  cell width (the horizontal segments' span)
 * @param h  cell height (top of `a` to bottom of `d`)
 * @param t  segment thickness
 * @param inset gap at each segment end
 */
export function segmentCell(w: number, h: number, t: number, inset: number): SegmentCell {
	const half = t / 2;
	const mid = h / 2;
	const n = (v: number) => v.toFixed(2);

	// A horizontal bar centred on y, spanning x0…x1.
	const bar = (y: number, x0: number, x1: number) =>
		`${n(x0)},${n(y)} ${n(x0 + half)},${n(y - half)} ${n(x1 - half)},${n(y - half)} ` +
		`${n(x1)},${n(y)} ${n(x1 - half)},${n(y + half)} ${n(x0 + half)},${n(y + half)}`;

	// A vertical bar centred on x, spanning y0…y1.
	const post = (x: number, y0: number, y1: number) =>
		`${n(x)},${n(y0)} ${n(x + half)},${n(y0 + half)} ${n(x + half)},${n(y1 - half)} ` +
		`${n(x)},${n(y1)} ${n(x - half)},${n(y1 - half)} ${n(x - half)},${n(y0 + half)}`;

	return {
		a: bar(0, inset, w - inset),
		g: bar(mid, inset, w - inset),
		d: bar(h, inset, w - inset),
		f: post(0, inset, mid - inset),
		b: post(w, inset, mid - inset),
		e: post(0, mid + inset, h - inset),
		c: post(w, mid + inset, h - inset)
	};
}

/**
 * A number as fixed-width glyphs, right-aligned, blank-padded — the readout's own
 * digits. Padding with spaces rather than zeros is what makes a two-digit speed
 * show "·71" with the leading cell ghosted, like an instrument, instead of "071".
 * Values that overflow the width peg at all-nines rather than silently truncating
 * to a smaller-looking number.
 */
export function glyphs(value: number, width: number): string[] {
	const max = 10 ** width - 1;
	const clamped = Math.min(Math.max(Math.round(value), 0), max);
	return String(clamped).padStart(width, ' ').split('');
}
