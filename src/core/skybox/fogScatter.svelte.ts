// The bridge between scene fog and the `fogScatter` POST-PROCESSING effect (see
// ../CLAUDE.md). One writer (`SkyFog`'s task), any number of readers; the shared values
// are `uniform()`s at MODULE SCOPE so their identity survives a pipeline rebuild — a
// `uniform()` made inside an effect's `build` is replaced on every rebuild and the
// driver's writes land on an orphan. Reads the RANGE band only, not the ground layer: a
// fullscreen pass has no world position to feed a height term without an
// inverse-projection per pixel, and fog thick enough to scatter has the band pulled in
// most of the way anyway.

import { uniform } from 'three/tsl';

/**
 * Near and far of the fog band, in WORLD UNITS — mirrors of `THREE.Fog.near`/`.far` as
 * `SkyFog` writes them each frame. Mirrored rather than `reference()`d off the Fog
 * instance because that instance is created inside the component: a module-scope
 * `reference()` would have nothing to bind to until it mounts.
 */
export const uFogNear = uniform(0);
export const uFogFar = uniform(1);

/**
 * How much scattering the weather is asking for, 0..1 — the `fog` weather channel ONLY,
 * never the day curve's own dawn/dusk haze (blurring a clear sky must never happen).
 */
export const uFogScatter = uniform(0);

/**
 * Whether there is enough fog for the effect to be worth having in the graph at all.
 * **Reactive on purpose, the only reactive thing in this module** — the effect declares
 * it as its `structuralTag`, so flipping it rebuilds the pipeline with the effect folded
 * in or left out entirely (an inactive scatter is still a full-frame target + mip chain
 * generated to blend at weight zero). `SkyFog` applies hysteresis to avoid rebuild churn.
 */
export const fogScatterActivity = $state({ active: false });
