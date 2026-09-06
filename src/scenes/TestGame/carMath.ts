// Shared scalar helpers for the driving model — used by both `drivetrain.ts` and
// `TestGame.svelte`'s physics task. Kept local to TestGame rather than promoted to
// `core/utils`: this is car-tuning math, not engine architecture.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Fraction of a `rate`-per-second exponential decay consumed in `dt`. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
