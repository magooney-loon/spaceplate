// Scalar helpers shared by the sky model and every sky layer. Pure by construction
// -- no Svelte, no three.js -- and reached through the model barrel like everything
// else. (They were copy-pasted per file before this module existed; drifted copies
// are why it exists.)

import type { RGB } from './types';

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Smoothstep easing on an already-normalized `k`. Named `ease` rather than `smoothstep`
 * because layers also import TSL's `smoothstep`, and one shadowing the other in a
 * shader file renders instead of throwing.
 */
export const ease = (k: number) => k * k * (3 - 2 * k);

/** Smoothstep across an arbitrary edge pair. The CPU-side twin of TSL's `smoothstep`. */
export const smooth01 = (edge0: number, edge1: number, v: number) => {
	// Guarded because both GLSL and WGSL leave smoothstep UNDEFINED when edge0 >= edge1,
	// and the JS copies of this were silently dividing by zero on a degenerate range.
	if (edge1 === edge0) return v < edge0 ? 0 : 1;
	return ease(clamp01((v - edge0) / (edge1 - edge0)));
};

/**
 * Wrap into [0, 1), for the channels that are an ANGLE rather than an intensity.
 *
 * `%` alone is not this: JavaScript's remainder keeps the sign of its left operand, so
 * `-0.25 % 1` is `-0.25` and a bearing eased a hair past due north comes out negative.
 */
export const wrap01 = (v: number) => v - Math.floor(v);

/** Writes into `out` -- every caller runs per frame and must not allocate. */
export const lerpRGB = (a: RGB, b: RGB, k: number, out: RGB): RGB => {
	out[0] = lerp(a[0], b[0], k);
	out[1] = lerp(a[1], b[1], k);
	out[2] = lerp(a[2], b[2], k);
	return out;
};

/**
 * Deterministic PRNG. The same seed must give the same sky on every reload, so no layer
 * may ever reach for `Math.random()` when building its field.
 */
export const mulberry32 = (a: number) => () => {
	a |= 0;
	a = (a + 0x6d2b79f5) | 0;
	let t = Math.imul(a ^ (a >>> 15), 1 | a);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
