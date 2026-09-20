// `applyWetness(material)` — makes a scene material answer to the weather.
//
// THE SHAPE OF THE PROBLEM. Wetness cannot be a post effect: it is not a property of the
// frame, it is a property of a surface, and the two things it changes (albedo and
// roughness) feed the lighting rather than sit on top of it. A screen-space pass has
// neither the normal nor the BRDF to do it with. So this patches materials, and the
// engine's job is to make that one call rather than a research project per scene.
//
// WHAT WET ACTUALLY DOES, and why it is these two terms and not a blue tint:
//
//   - It DARKENS. A water film traps light by total internal reflection — a ray that
//     scatters out of the substrate hits the water/air boundary at a shallow angle and
//     comes back for another go. Less light escapes, so the surface reads darker and
//     slightly more saturated. This is most of the effect and it is why "wet asphalt" is
//     nearly black.
//   - It SMOOTHS. The film fills the microscopic roughness that made the surface matte,
//     so reflections sharpen. This is what puts the sky, the headlights and the
//     streetlights into the ground.
//
// Everything else people reach for — a blue tint, an emissive lift, a fresnel hack — is
// an attempt to fake the second one without paying for it. We do not have to: the engine
// already has a real environment map (`Sky.svelte` bakes it) and real shadows, so
// dropping the roughness genuinely puts the sky in the floor.
//
// THE PUDDLE MASK IS THE GEOMETRIC NORMAL, NOT THE HEIGHT FIELD, and that is deliberate.
// The height field was the obvious candidate — it already answers "which way is
// downhill" for the splash rings — but it is a camera-following 70-unit map that
// `HeightField.svelte` SKIPS ENTIRELY below `precipitation <= 0.01`, so it goes stale
// through exactly the drying period when puddles are most visible. `normalWorldGeometry`
// is always available, costs nothing, needs no map footprint, works at any world scale,
// and answers the actual question — water pools where the surface is level. It reads the
// GEOMETRIC normal rather than the shaded one so a normal map's bumps do not punch holes
// in a puddle that is genuinely flat.
//
// USAGE. Call it once, at material construction:
//
//   const road = new THREE.MeshStandardNodeMaterial({ color: 0x3a3a3a, roughness: 0.9 });
//   applyWetness(road);
//
// It composes with a material that already has its own `colorNode`/`roughnessNode`: the
// existing node is taken as the dry base and wrapped, not replaced. Call it LAST, after
// the scene has set whatever else it wants.
//
// IT ALSO WORKS ON A PLAIN (non-node) MATERIAL, e.g. one straight out of a GLB, and the
// mechanism is worth knowing because it constrains WHEN you may call it.
// `NodeLibrary.fromMaterial` builds the node material for a non-node one with
// `for (const key in material) nodeMaterial[key] = material[key]` — an own enumerable
// `colorNode` is therefore carried across like any other property. But that copy happens
// ONCE, inside `NodeBuilder` on the material's first build, onto a DIFFERENT OBJECT. So:
//
//   - call this before the material has rendered a frame (at construction, or in the
//     load handler — both of which is where you would anyway), and
//   - do not expect a later assignment to the original's `colorNode` to take.
//
// The uniforms themselves are live nodes, so the weather still drives it every frame;
// it is only the WIRING that is one-shot.

import * as THREE from 'three/webgpu';
import {
	float,
	materialColor,
	materialRoughness,
	mix,
	normalWorldGeometry,
	positionWorld,
	sin,
	smoothstep,
	vec4
} from 'three/tsl';
import { uPuddles, uRippleTime, uWetness } from './wetSurface.svelte';

export type WetnessOptions = {
	/**
	 * What a fully wet film multiplies the albedo by. 0.55 is a touch less than the
	 * physical figure for a rough mineral surface, which lands nearer 0.4 — held back
	 * because most authored albedo is already darker than the real material and stacking
	 * the two crushes a scene to mud.
	 */
	darken?: number;
	/** Roughness a fully wet film converges on. Not 0: a film is smooth, not a mirror. */
	filmRoughness?: number;
	/** Roughness inside a puddle. Standing water genuinely is nearly a mirror. */
	puddleRoughness?: number;
	/** What a puddle multiplies the albedo by, on top of the film's own darkening. */
	puddleDarken?: number;
	/**
	 * How level a surface must be before water pools on it, as a cosine against world up.
	 * 0.965 is about 15 degrees — steeper than that and it runs off.
	 */
	puddleFlatness?: number;
	/**
	 * World size of the puddle pattern, in units per cycle. Wants to be well above the
	 * scale of the geometry's own detail or puddles read as a texture rather than as
	 * water lying in the low spots.
	 */
	puddleScale?: number;
	/**
	 * How much of a surface is puddle at full pooling, 0..1. Below 1 by a lot: a road
	 * under heavy rain has standing water in patches, not a continuous sheet, and the
	 * patches are what makes it read as a real surface.
	 */
	puddleCoverage?: number;
	/**
	 * Depth of the ripple's roughness modulation. Rain landing in standing water is what
	 * breaks up a reflection, and roughness is the cheap and honest channel for it — see
	 * the note at the ripple term.
	 */
	rippleStrength?: number;
	/** World size of one ripple cycle. Small: these are raindrops, not swell. */
	rippleScale?: number;
};

const DEFAULTS: Required<WetnessOptions> = {
	darken: 0.55,
	filmRoughness: 0.18,
	puddleRoughness: 0.04,
	puddleDarken: 0.8,
	puddleFlatness: 0.965,
	puddleScale: 7,
	puddleCoverage: 0.55,
	rippleStrength: 0.13,
	rippleScale: 0.85
};

/**
 * A cheap value-noise-ish field over world XZ, built from sines rather than a hash grid.
 * Three incommensurate frequencies so it does not visibly tile, and no texture fetch —
 * this runs per fragment on potentially every surface in the scene, so the budget is a
 * handful of ALU and nothing else.
 */
const patchField = (scale: number) => {
	const p = positionWorld.xz.div(scale);
	return sin(p.x)
		.mul(0.5)
		.add(sin(p.y.mul(1.37).add(1.7)).mul(0.3))
		.add(sin(p.x.mul(0.61).add(p.y.mul(0.83)).sub(2.3)).mul(0.2));
};

/**
 * Every material already wired, so a second call is a no-op rather than a second coat.
 *
 * THIS GUARD IS NOT DEFENSIVE TIDYING, it is required, and the failure it prevents is
 * not obvious: the function takes the material's EXISTING node as the dry base, so
 * calling it twice makes the first pass's output the second pass's input and the surface
 * darkens again — permanently, and only on a re-entry. GLBs are cached across scene
 * mounts (`useGltf`), so the same material objects come back on the second visit to a
 * scene, which is exactly when a caller-side guard scoped to a component instance would
 * have been thrown away. It lives here so no caller has to know that.
 *
 * A `WeakSet`, so holding the key cannot keep a disposed material alive.
 */
const wired = new WeakSet<THREE.Material>();

/**
 * Wire the weather's wetness into a material's albedo and roughness. Mutates and returns
 * the material, so it can be used inline. Idempotent — see `wired`.
 *
 * Safe to call on a material that is never rained on — at `uWetness` 0 every term below
 * is an exact identity, and the cost is a few ALU on a surface the renderer was already
 * shading.
 */
export const applyWetness = <T extends THREE.Material>(
	material: T,
	options: WetnessOptions = {}
): T => {
	if (wired.has(material)) return material;
	wired.add(material);

	const o = { ...DEFAULTS, ...options };

	// The DRY base. An existing node wins, so a material that already computes its own
	// albedo (a texture, a vertex colour, DemoScene's reflector emissive sibling) is
	// wrapped rather than thrown away; otherwise `materialColor`/`materialRoughness` are
	// what the material would have used anyway. This is why the call has to come last.
	//
	// BOTH OF THOSE ACCESSORS ALREADY FOLD IN THEIR MAPS — `materialColor` is the vec4
	// diffuse with `map` (and its alpha) in it, `materialRoughness` multiplies in
	// `roughnessMap.g` — so wrapping them preserves a textured material's textures. That
	// is what makes this safe to point at a GLB.
	//
	// AND `colorNode` REPLACES THE WHOLE vec4, ALPHA INCLUDED. `NodeMaterial.setup()` does
	// `diffuseColor.assign(this.colorNode ? vec4(this.colorNode) : materialColor)` and
	// then runs alphaTest against `diffuseColor.a`, so handing back a vec3 pads the alpha
	// to a constant and every alpha-CUT material silently loses its cutout — foliage,
	// decals, chain-link and grates all render as solid quads. Wrapped in `vec4` here and
	// recombined with `.a` untouched below: multiply rgb only, carry alpha through, the
	// same rule `postprocessing/effects/vignette.ts` states for the chain.
	const dryColor = vec4((material as any).colorNode ?? materialColor);
	const dryRoughness = (material as any).roughnessNode ?? materialRoughness;

	// WHERE WATER CAN SIT. The geometric normal against world up — see the header on why
	// this and not the height field. Ascending edges, as WGSL requires.
	const level = smoothstep(float(o.puddleFlatness), float(1), normalWorldGeometry.y);

	// WHERE IT HAS ACTUALLY POOLED. The patch field thresholded against the pooling
	// level, so puddles GROW from the low spots as the rain goes on rather than fading up
	// uniformly — the same "a fixed per-place number against a moving threshold" trick
	// Rain's `alive` uses, and for the same reason: it keeps the SET of puddles stable
	// while their extent changes.
	const pooled = uPuddles.mul(o.puddleCoverage);
	const threshold = pooled.mul(-2).add(1);
	const puddle = smoothstep(threshold, threshold.add(0.35), patchField(o.puddleScale))
		.mul(level)
		.mul(uPuddles);

	// THE RIPPLES, as a ROUGHNESS modulation rather than a normal perturbation. Two
	// reasons, and the second is the real one. Cheap: no `normalNode` to compose with
	// whatever normal map the material already has, and no tangent basis to get wrong.
	// Honest: what rain on standing water actually does to a reflection is scatter it,
	// and roughness IS the scattering term in the BRDF — perturbing the normal instead
	// moves the reflection around, which is what swell does, not what drizzle does.
	const rp = positionWorld.xz.div(o.rippleScale);
	const ripple = sin(rp.x.add(uRippleTime))
		.mul(sin(rp.y.mul(1.21).sub(uRippleTime.mul(0.83))))
		.mul(sin(rp.x.mul(0.74).add(rp.y.mul(1.13)).add(uRippleTime.mul(1.31))));

	// ── Albedo ───────────────────────────────────────────────────────────────────
	// The film everywhere, the puddle's extra darkening only where it pooled. Both are
	// MULTIPLIES: wetness removes light, it does not add a colour (the same reasoning
	// `weatherGrade`'s cool tint follows).
	const filmDarken = mix(float(1), float(o.darken), uWetness);
	const poolDarken = mix(float(1), float(o.puddleDarken), puddle);
	(material as any).colorNode = vec4(dryColor.rgb.mul(filmDarken).mul(poolDarken), dryColor.a);

	// ── Roughness ────────────────────────────────────────────────────────────────
	// Dry → film → puddle, in that order, so a puddle on an already-wet surface reaches
	// the mirror end rather than averaging back toward the film.
	const wetRoughness = mix(float(dryRoughness), float(o.filmRoughness), uWetness);
	const pooledRoughness = mix(wetRoughness, float(o.puddleRoughness), puddle);
	// Ripples only inside the puddles — a film on rough ground has nothing to ripple, and
	// the floor here is `puddleRoughness` so the surface can never come out negative.
	(material as any).roughnessNode = pooledRoughness
		.add(ripple.mul(o.rippleStrength).mul(puddle))
		.clamp(0.015, 1);

	return material;
};
