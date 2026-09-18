// The bridge between the sky model and the `godrays` POST-PROCESSING effect (see
// ../postprocessing/CLAUDE.md). Same contract as `fogScatter.svelte.ts` and the lens
// state: one writer (`SkyLight`'s task, which already owns the key light), any number of
// readers, and the shared values are `uniform()`s at MODULE SCOPE so their identity
// survives a pipeline rebuild — a `uniform()` made inside an effect's `build` is replaced
// on every rebuild and the driver's writes land on an orphan.
//
// UNLIKE every other driver here, this module also carries a THREE OBJECT: the effect
// raymarches the key light's shadow atlas, so it needs the `SunLight` instance itself at
// BUILD time, not a uniform it reads at draw time. That is why `godrayActivity` holds the
// light rather than a bare boolean — the effect's `structuralTag` reads it, so the
// pipeline rebuilds when a light mounts, unmounts, or first gets its shadow map.

import { uniform } from 'three/tsl';
import { Color } from 'three/webgpu';
import type { SunLight } from 'three/addons/lights/SunLight.js';

/**
 * The colour the shafts blend the frame toward — `descriptor.light.color`, WORKING
 * (linear) space, read with no colour-space argument. That is the same field and the same
 * convention `SkyLight` and `SkyFog`'s inscatter use, so the sun→moon crossover comes free:
 * moonlight shafts exactly as sunlight does, just dimmer and bluer. (`sky.fogColor` is the
 * authored-sRGB one — different field, converted differently, don't unify them.)
 */
export const uGodrayColor = uniform(new Color(1, 1, 1));

/**
 * How much shaft the sky is asking for, 0..1 — haze × the key light being up.
 *
 * Multiplied INTO the panel's `density` and `maxDensity` inside the shader, which is the
 * same split `fogScatter` uses: the panel owns the ceiling, the weather owns how much of it
 * is spent, and neither has to know about the other. A clear noon must produce none of
 * this — shafts are light scattered on its way to the camera, and with nothing in the air
 * there is nothing to scatter off.
 */
export const uGodrayWeight = uniform(0);

/**
 * The live key light, or null while no `SkyLight` is mounted — plus whether the sky is
 * asking for shafts at all.
 *
 * **Reactive on purpose, and the only reactive thing in this module.** The effect declares
 * it as its `structuralTag`, so a change rebuilds the pipeline with the effect folded in or
 * left out entirely. Both fields are structural for the same reason and neither could be a
 * uniform:
 *
 * - `light` is read by `godrays( depth, camera, light )` at build time. There is no node to
 *   swap afterwards — a different light is a different shader.
 * - `active` gates the whole pass. This is the most expensive effect in the registry by
 *   some margin (a half-res raymarch of tens of shadow-atlas taps per pixel, then a
 *   separable bilateral blur, then an eight-tap edge-aware composite), and none of it is
 *   skippable by a branch the way `afterimage`'s composite fetch is — the render targets
 *   are allocated and the passes run from `updateBefore`, OUTSIDE the shader, so a uniform
 *   gate would save nothing. Leaving the graph is the only real off switch.
 *
 * **The latch is allowed here because it watches a SLOW signal** — the haze channel and the
 * key light's elevation, which move on weather-blend and day-curve timescales and cross once
 * and stay across. That is the rule the abandoned screen-space `sunShafts` attempt broke:
 * its gate included whether the sun was ON SCREEN, so a lap of a track swung it through the
 * full range every few seconds and recompiled the post pipeline about twice a lap.
 * **Raymarched godrays have no such term** — they are integrated along the view ray through
 * the shadow volume, so they exist whether or not the sun is in frame. That is exactly why
 * this one can afford the latch the screen-space one could not. `SkyLight` applies the
 * hysteresis.
 */
export const godrayActivity = $state<{ active: boolean; light: SunLight | null }>({
	active: false,
	light: null
});

/**
 * Registers (or clears, with `null`) the key light the shafts raymarch. Called by
 * `SkyLight.svelte` alone, from the same `oncreate` that registers the shadow with
 * `keyShadow.ts` — a second caller would mean a second key light, which the engine does not
 * have.
 */
export const setGodrayLight = (light: SunLight | null): void => {
	godrayActivity.light = light;

	// Nothing schedules the driver task after an unmount, so the weight would otherwise hold
	// its last value forever and a re-mounted light would pop in at full strength. Same rule
	// every driver here follows on teardown.
	if (light === null) {
		godrayActivity.active = false;
		uGodrayWeight.value = 0;
	}
};
