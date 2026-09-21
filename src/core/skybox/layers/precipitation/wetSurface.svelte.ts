// Wet ground: the shared state behind `applyWetness()` (wetSurface.ts next door).
//
// WHY THIS EXISTS. Rain fell on a world that never got wet. The drops were good, the
// splashes were good, and the road under them kept the albedo and the roughness it had
// at noon — which is the single loudest tell that weather is an effect rather than a
// condition. Nothing in the engine modelled surface water at all: `grep wetness` reached
// only `lensState`, i.e. the camera's own glass.
//
// Same contract as `flashState.ts`, `heightField.ts` and `lensState.svelte.ts`: a plain
// module with module-scope `uniform()`s, exactly ONE writer (`WetnessDriver.svelte`'s
// task) and any number of readers, none of them reactive. Module scope is load-bearing
// for the same reason it is in `lensState`: a material bakes these nodes into its graph
// once, and a uniform created per-build would leave the driver writing to an orphan.
//
// THERE IS NO ACTIVITY LATCH AND THERE CANNOT BE ONE. A latch is a pipeline-graph
// decision, and these are MATERIAL terms — they are compiled into every wet material's
// node graph, so "leaving them out" would mean recompiling the scene's materials, which
// is the most expensive rebuild the engine has (`core/postprocessing/CLAUDE.md` on the
// context-identity trap). At rest every term below multiplies out to the dry material
// exactly, which is the right bargain here for the same reason it is for `afterimage`.

import { uniform } from 'three/tsl';

/**
 * The WATER FILM, 0..1 — a thin sheet over everything the rain can reach. Beads up
 * quickly and dries slowly, and it is the term that does most of the work: a wet surface
 * is darker and much smoother than a dry one, which is a bigger visual change than any
 * puddle.
 *
 * Applied to sloped and vertical surfaces too, unlike [[uPuddles]], because a film is
 * what rain leaves on a wall — it is pooling that needs somewhere level to pool.
 */
export const uWetness = uniform(0);

/**
 * POOLED WATER, 0..1. Slower than the film in both directions: a puddle takes minutes of
 * rain to form and long after the rain stops to go. Gated in the shader on the GEOMETRIC
 * normal pointing up, so it only ever appears where water could actually sit.
 */
export const uPuddles = uniform(0);

/**
 * Accumulated ripple phase. The self-accumulated-distance rule every animated sky term
 * follows (`layers/CLAUDE.md`): its rate rides the rain amount, and an elapsed clock
 * multiplied by a rate that moves would jump the whole pattern the moment the weather
 * blended.
 */
export const uRippleTime = uniform(0);
