// The precipitation height field: "what is the topmost surface under this point?"
//
// WHY IT EXISTS. Rain and Snow animate entirely in the vertex node -- a `fract()` sawtooth
// through a camera-anchored box, zero CPU work per particle (see Rain.svelte). That is
// what makes 9000 drops affordable, and it is also why they knew nothing about the world:
// this module is the world knowledge they were missing, in the one shape that keeps the
// vertex-node design intact -- a small texture holding the surface height at each world
// XZ, rendered from an orthographic camera looking straight down (HeightField.svelte)
// and sampled per particle in the vertex stage.
//
// THE CONTRACT, and it is deliberately fail-safe: `.r` is the surface's world Y, `.a` is
// 1 where something was drawn and 0 where nothing was. Every consumer treats `a == 0` as
// "no surface here", which is exactly the old fall-through behaviour. So if the pass never
// runs -- not raining, backend trouble, the component unmounted -- precipitation degrades
// to what it did before rather than to drops hanging in mid-air.
//
// Same sharing pattern as flashState.ts: a plain module with one writer (HeightField's
// task) and any number of readers, none of them reactive.
//
// `sampleHeightFieldSlope` reads the same map to answer a second question -- "which way
// is downhill from here?" -- for the splash decals that need to sit IN the local surface
// rather than at a fixed world height (a banked corner, not just a flat floor). Two extra
// samples on top of `sampleHeightField`'s one; see its own note for why it stays this
// cheap and this coarse.

import * as THREE from 'three/webgpu';
import { float, step, textureLevel, uniform, vec2 } from 'three/tsl';

/**
 * Default/initial resolution of the height map, before `Skybox.svelte`'s graphics
 * preset resizes it (see `setHeightMapSize`) -- 256 over a 70-unit box is ~0.27 world
 * units per texel, finer than a rain drop is wide, and the map is sampled with NEAREST
 * on purpose (see below), so more resolution buys sharper object edges and nothing
 * else: a coarse texel is where a splash 30cm from a barrier reads as landing IN the
 * barrier, or a streak stops a visible margin above the ground it is about to hit.
 */
export const HEIGHT_MAP_SIZE = 256;

/**
 * Created at module scope so the texture's IDENTITY is stable before any material is
 * built: Rain and Snow bake `texture(heightTarget.texture)` into their node graphs once,
 * at mount, and swapping a texture under a live material invalidates its cache key.
 * No GPU memory is committed here -- three allocates on first render.
 *
 * HalfFloat because the stored value is a signed world coordinate: a UNORM format
 * would clamp it to 0..1, making a ground plane at y=0 indistinguishable from one at
 * y=-50. Precision is ~0.03 world units at y=50, far below a drop's size.
 */
export const heightTarget = new THREE.RenderTarget(HEIGHT_MAP_SIZE, HEIGHT_MAP_SIZE, {
	type: THREE.HalfFloatType,
	// NEAREST, not linear: this is a height field, not an image. Filtering across the
	// edge of a wall would invent a smooth ramp between the wall top and the floor, and
	// drops would slide down an interpolated slope that does not exist.
	minFilter: THREE.NearestFilter,
	magFilter: THREE.NearestFilter,
	depthBuffer: true,
	generateMipmaps: false
});
// No colour-space conversion on the way in or out -- the red channel is a coordinate,
// not a colour, and an sRGB transfer would mangle it.
heightTarget.texture.colorSpace = THREE.NoColorSpace;
heightTarget.texture.name = 'precipitation-height';

/**
 * Resize the map in place, from `Skybox.svelte`'s graphics preset. Safe at runtime the
 * same way `SunShadowNode` resizing its atlas is (`SkyLight.svelte`'s `shadowMapSize`
 * note): `setSize` reallocates the underlying GPU texture but the texture OBJECT keeps
 * its identity, which is what Rain/Snow's `texture(heightTarget.texture)` was baked
 * against at mount -- a resize here needs no rebuild on their side. Guarded so a
 * same-size call (most frames, most preset toggles that don't touch this) is a no-op
 * rather than a redundant reallocation.
 */
export const setHeightMapSize = (size: number) => {
	if (heightTarget.width === size) return;
	heightTarget.setSize(size, size);
};

/**
 * Where the map is centred in world XZ, and its half-extent. Written by HeightField's
 * task, read by every consumer's node graph -- shared uniform NODES, so one write updates
 * Rain and Snow together. Two scalars rather than a matrix because the pass camera is
 * axis-aligned by construction: it always looks straight down.
 */
export const uHeightCenter = uniform(new THREE.Vector2());
export const uHeightExtent = uniform(1);

/**
 * Plain mutable state, mirroring the uniforms for the CPU side of the pass.
 * One writer (HeightField.svelte), read by nothing else today.
 */
export const heightFieldState = {
	centerX: 0,
	centerZ: 0,
	extent: 0,
	/** Set once the map holds a real render. Until then consumers see alpha 0 anyway. */
	baked: false
};

/**
 * Sample the field at a world-space position, optionally offset in world XZ (the
 * two-extra-sample gradient below is the one caller that needs the offset; every other
 * caller takes the default and reads dead centre). Returns the surface's world Y and a
 * 0/1 validity flag. `valid` is 0 both where nothing was drawn and where the sample
 * falls OUTSIDE the map -- a particle that has drifted past the baked footprint has no
 * information, and inventing one would be worse than letting it fall.
 *
 * Sampled with `textureLevel(..., 0)` rather than plain `texture(...)`: this runs in the
 * VERTEX stage, which has no implicit derivatives on WebGPU, so an automatic-LOD sample
 * is invalid there. `textureLevel` compiles to an explicit-LOD fetch.
 */
export const sampleHeightField = (
	worldPosition: THREE.Node<'vec3'>,
	xzOffset: THREE.Node<'vec2'> = vec2(0, 0)
) => {
	// World XZ -> map UV. BOTH NEGATIONS ARE LOAD-BEARING, and they come from two
	// different places.
	//
	// X, from the VIEW BASIS. The pass camera looks straight down with `up = +Z`, and
	// `Matrix4.lookAt` sets x = up x z; here z (eye - target) is +Y, so x = +Z x +Y = -X.
	// The camera's X axis runs along world -X, so ndc.x = -(worldX - centerX) / extent.
	//
	// Z, from the TEXTURE CONVENTION. The camera's Y axis comes out as world +Z, so
	// ndc.y = +(worldZ - centerZ) / extent -- but ndc.y = +1 is the TOP of the target,
	// and a colour attachment is sampled with v = 0 at the top (WebGPU's origin), so
	// v = 0.5 - ndc.y / 2: one more negation, and it has nothing to do with the `up`
	// vector. Looking straight down cannot avoid a flip on one axis; sampling a render
	// target adds a second one on the other, and BOTH are undone here, in the one place
	// that owns the world <-> uv mapping.
	const rel = worldPosition.xz.add(xzOffset).sub(uHeightCenter).div(uHeightExtent.mul(2));
	const uv = vec2(rel.x.negate(), rel.y.negate()).add(0.5);

	const sample = textureLevel(heightTarget.texture, uv, float(0));

	// Inside the map on both axes, as pure arithmetic rather than boolean nodes: distance
	// from the centre on the wider axis, then `step(d, 0.5)` -- 1 while 0.5 >= d.
	const d = uv.sub(0.5).abs();
	const inside = step(d.x.max(d.y), float(0.5));

	return { height: sample.r, valid: sample.a.mul(inside) };
};

/**
 * The local surface SLOPE at a world position -- `(dHeight/dX, dHeight/dZ)` -- from two
 * extra samples offset in world XZ (a forward difference, not a centred one: three
 * samples total instead of four, plenty for a splash-scale effect when the map itself
 * is coarser than a texel-perfect derivative would need -- see `HEIGHT_MAP_SIZE`'s
 * note). Built on top of `sampleHeightField`'s own offset param rather than duplicating
 * the UV math.
 *
 * `eps` (world units) wants to be a few texels, not one: at NEAREST filtering, one
 * texel's difference against its neighbour is a step function (identical inside a
 * texel, a hard jump at its edge), which reads as the "generated" tell every other
 * NEAREST choice in this module was made to avoid. A few texels averages across that
 * quantisation into something that reads as a slope rather than a staircase.
 *
 * `valid` is ANDed across all three samples: a gradient with one leg standing on "no
 * surface" is not a slope, it is nonsense, and every caller already treats a flat
 * (zero) slope as the safe default for "couldn't tell" -- the same fail-safe
 * `sampleHeightField` itself relies on.
 */
export const sampleHeightFieldSlope = (worldPosition: THREE.Node<'vec3'>, eps = 0.6) => {
	const center = sampleHeightField(worldPosition);
	const alongX = sampleHeightField(worldPosition, vec2(eps, 0));
	const alongZ = sampleHeightField(worldPosition, vec2(0, eps));
	const valid = center.valid.mul(alongX.valid).mul(alongZ.valid);
	const slope = vec2(alongX.height.sub(center.height), alongZ.height.sub(center.height))
		.div(eps)
		.mul(valid);
	return { height: center.height, valid, slope };
};
