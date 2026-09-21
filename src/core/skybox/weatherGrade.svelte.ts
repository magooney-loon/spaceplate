// The bridge between the weather channels and the `weatherGrade` POST-PROCESSING effect
// (see ../postprocessing/CLAUDE.md). Same contract as `fogScatter.svelte.ts` next to it:
// one writer (`SkyFog`'s task), one reader (the effect's `build`), and the shared values
// are `uniform()`s at MODULE SCOPE so their identity survives a pipeline rebuild — a
// `uniform()` created inside a `build` is replaced on every rebuild and the driver's
// writes land on an orphan.
//
// WHY THERE IS NO ACTIVITY LATCH, unlike `fogScatter` and the two lenses. A latch may
// only ever watch a signal that crosses ONCE and stays across, because every flip is a
// full pipeline rebuild (`core/postprocessing/CLAUDE.md`). Precipitation does not do
// that: a weather blend walks the channel slowly across whatever threshold we picked,
// and a shower that hovers near it would recompile the graph repeatedly. So this takes
// `afterimage`'s bargain instead — always in the graph, at values that make it an exact
// identity in dry weather. The cost of that is one `saturation` and one `mix` per pixel,
// which is the right price for never hitching on a weather change.

import { uniform } from 'three/tsl';

/**
 * How much saturation the weather takes out of the frame, 0..1 (0 = untouched). Rain
 * scatters light between the camera and everything it is looking at, which is a real
 * loss of colour and not only a convention — but the convention is why the number is
 * tuned rather than derived: a storm reads as a storm partly because we expect one to
 * look like this.
 */
export const uWeatherDesaturate = uniform(0);

/**
 * How far the frame shifts toward the cool tint below, 0..1. Separate from the
 * desaturation because they are not the same signal: fog desaturates without cooling
 * (it takes the colour of whatever is lighting it), and rain does both.
 */
export const uWeatherCool = uniform(0);
