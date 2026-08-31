// Shared plumbing for the sky layers (Stars, Meteors, Nebula, Moon, CloudDeck, Rain,
// Snow, Lightning). Everything here was copy-pasted between four to six components
// before this module existed, and the copies had already drifted into a real bug --
// see `altitudeOf` below.
//
// Three things live here, and each one encodes an invariant the layers must not get
// wrong individually:
//
//   1. GEOMETRY. Every particle layer is billboarded quads, and every one of them used
//      to write its per-particle data FOUR TIMES, once per quad vertex. `instancedQuad`
//      replaces that with one shared four-vertex quad plus per-instance attributes.
//   2. THE VERTEX NODE. Depth pinning to the far plane is load-bearing, not an
//      optimisation (see `pinFarPlane`), and the billboard/streak constructions have
//      to avoid TSL's assignment-outside-Fn trap.
//   3. MATERIAL FLAGS. `fog = false` on every sky layer is not a style choice.
//
// See DOCS/weather-system.md §15.4 and §17.

import * as THREE from 'three/webgpu';
import {
	cameraProjectionMatrix,
	instancedBufferAttribute,
	mix,
	modelViewMatrix,
	positionLocal,
	vec2,
	vec4
} from 'three/tsl';

/** Sky layers are engine furniture: never selectable, never shown in the Studio tree. */
export const SKY_LAYER_USERDATA = { hideInTree: true, selectable: false };

// ── Geometry ───────────────────────────────────────────────────────────────────

/** Centred billboard: the quad spans -1..1 on both axes around the particle centre. */
export const CENTERED_QUAD = [-1, -1, 1, -1, 1, 1, -1, 1];
/**
 * Head-anchored billboard: y runs 0..1 from the particle centre, so the quad hangs off
 * one end rather than straddling it. Rain's streaks are built from head to tail.
 */
export const HEAD_ANCHORED_QUAD = [-1, 0, 1, 0, 1, 1, -1, 1];

/**
 * One four-vertex quad, drawn `count` times.
 *
 * THE POINT OF THIS. Every particle layer previously built `count * 4` vertices and
 * wrote each per-particle value into all four of them -- a 4x duplication of position,
 * colour, size, seed and every packed parameter, plus a `count * 6` Uint32 index buffer.
 * Measured on the shipped counts: Rain 1.52 MB, Snow 2.20 MB, Stars 0.64 MB. Instanced,
 * the same fields cost 0.25 / 0.40 / 0.12 MB and the index buffers collapse into the six
 * indices shared here.
 *
 * The corner arrives as `positionLocal.xy`, so a layer reads its quad corner exactly
 * where it used to read its `aCorner` attribute.
 *
 * NOTE this does NOT relieve WebGPU's 8-`maxVertexBuffers` cap that Meteors packs
 * around: an instanced attribute still occupies a vertex-buffer slot. Escaping that cap
 * needs storage buffers (`instancedArray`), which is a compute-shader-shaped change.
 */
export const instancedQuad = (
	count: number,
	corners: readonly number[] = CENTERED_QUAD
): THREE.InstancedBufferGeometry => {
	const geometry = new THREE.InstancedBufferGeometry();

	const position = new Float32Array(4 * 3);
	for (let v = 0; v < 4; v++) {
		position[v * 3] = corners[v * 2];
		position[v * 3 + 1] = corners[v * 2 + 1];
		position[v * 3 + 2] = 0;
	}

	geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
	geometry.setIndex([0, 1, 2, 0, 2, 3]);
	geometry.instanceCount = count;
	return geometry;
};

// Per-instance attribute constructors.
//
// The explicit type argument is required for the same reason `attribute<'vec2'>(...)`
// needs one: the generic is inferred from the argument's VALUE, so a bare 'vec3' widens
// to `string` and every downstream node method silently disappears.
//
// These nodes carry their own buffers and are bound directly by the renderer
// (RenderObject.getAttributes reads `nodeAttribute.node.attribute`), so they do NOT
// need to be registered on the geometry -- only `instanceCount` does.

export const instancedFloat = (array: Float32Array) =>
	instancedBufferAttribute<'float'>(new THREE.InstancedBufferAttribute(array, 1), 'float');

export const instancedVec2 = (array: Float32Array) =>
	instancedBufferAttribute<'vec2'>(new THREE.InstancedBufferAttribute(array, 2), 'vec2');

export const instancedVec3 = (array: Float32Array) =>
	instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(array, 3), 'vec3');

export const instancedVec4 = (array: Float32Array) =>
	instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(array, 4), 'vec4');

// ── Vertex nodes ───────────────────────────────────────────────────────────────

/**
 * Pin a clip-space position to the far plane, exactly as SkyMesh does internally.
 *
 * LOAD-BEARING, not an optimisation. The camera's far plane is 144 while the sky sits at
 * radius 1000, so an honestly-projected sky layer is clipped away in its entirety.
 * Pinning also sorts the layer behind all scene geometry for free -- which is why
 * `renderOrder` is the only thing separating the sky layers from each other.
 *
 * Every layer using this also needs `frustumCulled={false}`: its bounding volume sits
 * wholly beyond the far plane, so three would cull it before it ever drew.
 */
export const pinFarPlane = (clip: THREE.Node<'vec4'>) => vec4(clip.xy, clip.w, clip.w);

/** The whole vertex node for a layer whose geometry is already at the dome's radius. */
export const domeVertexNode = () =>
	pinFarPlane(cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1))));

/**
 * Camera-facing billboard: offset the corner AFTER the model-view transform, so the quad
 * faces the camera with no per-particle rotation.
 *
 * Built as ONE PURE EXPRESSION, with no `.toVar()` and no assignment. That is not a style
 * preference. TSL's assignment operators need an `Fn()` stack to record into, and outside
 * one they fail with "No stack defined for assign operation" -- a console warning, not a
 * throw. An early version of Stars used `mv.xy.addAssign(...)`, the call was dropped,
 * every quad's four vertices stayed on the same point, and thousands of zero-area
 * triangles rendered precisely nothing.
 */
export const billboardClip = (center: THREE.Node<'vec3'>, offset: THREE.Node<'vec2'>) => {
	const mv = modelViewMatrix.mul(vec4(center, 1));
	return cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.z, mv.w));
};

/**
 * Motion-aligned billboard: a quad stretched from `head` to `tail`, widened
 * perpendicular to its own screen-space direction. Rain's drops and Meteors' streaks are
 * the same construction with different endpoints.
 *
 * `along` walks the spine (0 = head, 1 = tail) and `across` is the cross-axis corner.
 * The epsilon guards the degenerate head-over-tail case -- motion straight at the camera,
 * where `normalize()` of a zero vector is NaN.
 */
export const streakClip = (
	head: THREE.Node<'vec3'>,
	tail: THREE.Node<'vec3'>,
	along: THREE.Node<'float'>,
	across: THREE.Node<'float'>,
	width: THREE.Node<'float'>
) => {
	const headVS = modelViewMatrix.mul(vec4(head, 1));
	const tailVS = modelViewMatrix.mul(vec4(tail, 1));
	const motion = tailVS.xy.sub(headVS.xy).add(vec2(1e-5, 1e-5)).normalize();
	const perpendicular = vec2(motion.y.negate(), motion.x);
	const spine = mix(headVS, tailVS, along);
	const offset = perpendicular.mul(across.mul(width));
	return cameraProjectionMatrix.mul(vec4(spine.xy.add(offset), spine.z, spine.w));
};

/**
 * Sine of a dome-layer point's altitude, from its world position and the dome radius.
 *
 * THIS EXISTS BECAUSE THE COPIES OF IT DISAGREED. Stars stores radius-scaled positions,
 * so `positionWorld.y / radius` recovered the altitude correctly. Meteors stores UNIT
 * directions and scales in the shader, so the same copied line divided an already-unit
 * value by 1000 and every meteor was multiplied by a constant ~0.06 -- a 16x dimming,
 * with the horizon fade it was written for doing nothing at all.
 *
 * Instancing removes the trap at the root: with the centre in an instanced attribute,
 * `positionWorld` is the +/-1 quad corner for every layer, so nobody may read it for
 * altitude any more. Pass the centre explicitly and state its scale.
 */
export const altitudeOf = (center: THREE.Node<'vec3'>, radius: number) => center.y.div(radius);

// ── Materials ──────────────────────────────────────────────────────────────────

export type SkyLayerMaterialOptions = {
	blending?: THREE.Blending;
	side?: THREE.Side;
	/**
	 * Layers that must composite in the SkyMesh dome's exposure space (the cloud deck,
	 * the moon) set this true. Emissive layers -- stars, meteors, the nebula, lightning
	 * -- do not: tone mapping them at night's 0.62 exposure would dim the one thing in a
	 * dark frame that is supposed to be bright.
	 */
	toneMapped?: boolean;
};

/**
 * A transparent sky-layer material with the flags every layer shares.
 *
 * `fog = false` is the one that is not negotiable. Sky layers sit at radius ~1000 while
 * scene fog is tuned for a 144-unit far plane, so ANY density at all resolves the whole
 * sky to a flat fog colour -- and fogging an additive layer mixes it toward the fog
 * colour rather than dimming it. The sky is what the fog is a haze TOWARD, never
 * something the fog is applied to. That is exactly why the day curve authors a
 * per-keyframe `fogColor` in the first place. See SkyFog.svelte.
 */
export const skyLayerMaterial = ({
	blending = THREE.NormalBlending,
	side = THREE.FrontSide,
	toneMapped = false
}: SkyLayerMaterialOptions = {}): THREE.MeshBasicNodeMaterial => {
	const material = new THREE.MeshBasicNodeMaterial();
	material.transparent = true;
	material.depthWrite = false;
	material.blending = blending;
	material.side = side;
	material.toneMapped = toneMapped;
	material.fog = false;
	return material;
};
