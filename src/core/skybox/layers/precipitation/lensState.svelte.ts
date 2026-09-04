// The bridge between the sky model and the two lens POST-PROCESSING effects.
//
// The lenses used to be meshes in the scene (`RainLens.svelte` / `SnowLens.svelte`),
// which was always "post-processing without a pipeline" — and it broke the day the
// pipeline grew MRT attachments. Non-`output` attachments do not blend, so one
// screen-filling quad drawn inside the scene pass OVERWRITES the whole velocity and
// normal buffer: motion blur silently degraded to an identity transform in any rain,
// and AO would have done the same. `core/postprocessing/CLAUDE.md` had already written
// down the rule ("overlays belong after post-processing, not in the base pass"); the
// lenses simply predated it. They are chain effects now.
//
// THIS MODULE IS THE SAME CONTRACT AS `flashState.ts`: a plain module with exactly ONE
// writer (`LensDriver.svelte`'s task) and any number of readers. The difference is that
// the readers here are TSL nodes rather than other tasks, so the shared values are
// `uniform()`s — created at MODULE SCOPE so their identity survives a pipeline rebuild.
// A `uniform()` created inside an effect's `build` would be replaced by every rebuild
// and the driver's writes would land on an orphan.

import { Vector2, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';

// ── Rain ─────────────────────────────────────────────────────────────────────

/** Overall strength: drives both the droplet density and the blend against the frame. */
export const uWetness = uniform(0);

/**
 * The droplet animation clock, ACCUMULATED on the CPU rather than `time * rate`: the
 * rate moves with camera speed, so an `elapsed × rate` form would teleport the whole
 * pattern every time the rate changed (see Rain's `uFallTime`) — far more visible here
 * than there.
 */
export const uDropTime = uniform(0);

// ── Snow ─────────────────────────────────────────────────────────────────────

/** How far the frost front has advanced, 0 (clear) to 1 (past the centre of the frame). */
export const uGrowth = uniform(0);

/**
 * The colour frost scatters, from the light hints — the same reasoning as Snow's flake
 * tint, and it matters more here because this covers whole regions of the frame rather
 * than specks. Ice has no colour of its own; a white frost border under a night sky is
 * the single most obvious way to make a cold scene look like a bug. A `Vector3` rather
 * than a `Color`, so nothing colour-manages a working-space shader constant.
 */
export const uIce = uniform(new Vector3(0.78, 0.87, 0.98));

/**
 * A translation into the NOISE DOMAIN, re-rolled each time the frost returns, so no two
 * freezes grow the same arrangement of lobes and dendrites. Seeded at construction as
 * well, so the very first freeze is not the one arrangement everybody sees.
 *
 * IT MUST NOT REACH THE VIGNETTE — the effect applies it inside its `Frost` function
 * rather than folding it into the pattern uv, because the vignette is distance from the
 * centre OF THE FRAME and offsetting it would slide the growth field off-centre, so the
 * frost would come in from one side of an off-screen ellipse instead of from the edges.
 */
export const uPatternOffset = uniform(new Vector2(Math.random() * 512, Math.random() * 512));

// ── Activity latches ─────────────────────────────────────────────────────────

/**
 * Whether each lens is doing anything visible. **Reactive on purpose, and the only
 * reactive thing in this module** — the effects declare it as their `structuralTag`, so
 * flipping one rebuilds the pipeline graph with that lens folded in or left out
 * entirely.
 *
 * That rebuild is what buys back the `mesh.visible = false` the mesh version got for
 * free. A dry lens is not merely a cheap blend: the droplet and crystal fields are
 * evaluated THREE times per pixel (the finite differences the refraction normal needs),
 * fullscreen, and no uniform set to zero avoids that. So the graph must not contain the
 * effect at all when it is dry.
 *
 * It is NOT a per-frame quantity — it is a latch that flips at most once per weather
 * transition, which is why `$state` is legitimate here where the descriptor contract
 * forbids it (`../../CLAUDE.md`). The hysteresis in `LensDriver.svelte` is what keeps it
 * from thrashing at the threshold and rebuilding the graph every frame.
 */
export const lensActivity = $state({ rain: false, snow: false });
