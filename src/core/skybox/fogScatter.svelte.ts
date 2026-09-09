// The bridge between scene fog and the `fogScatter` POST-PROCESSING effect.
//
// Scene fog (`SkyFog.svelte`) tints a surface toward the fog colour by distance. It
// cannot SCATTER: real fog is a volume of droplets that redirects light between
// neighbouring paths, which is why a distant lamp in fog has a halo and a distant edge
// has no edge left. Tinting alone leaves every silhouette in a fog bank perfectly crisp
// and merely paler, which reads as haze on a photograph rather than as being inside
// weather. The effect blends the frame against a blurred copy of itself on the same
// distance ramp — three's own `webgpu_custom_fog_scattering` demo, which mixes toward a
// blurred pass by the fog factor.
//
// SAME CONTRACT AS `layers/precipitation/lensState.svelte.ts`: one writer (`SkyFog`'s
// task, which already computes every number here), any number of readers, and the shared
// values are `uniform()`s created at MODULE SCOPE so their identity survives a pipeline
// rebuild — a `uniform()` made inside an effect's `build` is replaced on every rebuild
// and the driver's writes land on an orphan.
//
// The effect reads the RANGE band only, not the ground layer. `SkyFog`'s height term is
// a function of world Y, and a fullscreen pass has the depth buffer but no world
// position to feed it; reconstructing one would cost an inverse-projection per pixel to
// modulate a blur that is already a broad, low-frequency effect. Fog thick enough to
// scatter has the band pulled most of the way in anyway.

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
 * How much scattering the weather is asking for, 0..1 — the `fog` weather channel, and
 * ONLY that channel.
 *
 * Deliberately not the day curve's own haze, which `SkyFog` also folds into its ground
 * layer: that haze peaks at dawn and dusk in otherwise clear weather, and blurring a
 * clear sky is the one thing this effect must never do. The sky sits past the band's far
 * edge, so it takes the maximum blur of anything on screen — correct inside a fog bank,
 * wrong on a clear evening. Gate on the weather, not on the light.
 */
export const uFogScatter = uniform(0);

/**
 * Whether there is enough fog for the effect to be worth having in the graph at all.
 * **Reactive on purpose, and the only reactive thing in this module** — the effect
 * declares it as its `structuralTag`, so flipping it rebuilds the pipeline with the
 * effect folded in or left out entirely.
 *
 * The same argument as `lensActivity`, for a different cost: an inactive scatter is not
 * merely a cheap `mix`, it is a full-frame render target plus a mipmap chain generated
 * every frame to be blended at weight zero. `SkyFog` applies hysteresis so a fog blend
 * crossing the threshold cannot rebuild the graph frame after frame.
 */
export const fogScatterActivity = $state({ active: false });
