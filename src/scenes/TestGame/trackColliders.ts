// Static colliders for the race track — a hand-rolled replacement for
// `<AutoColliders shape="trimesh">`, which cannot pass trimesh FLAGS.
//
// WHY FLAGS: Rapier trimeshes default to treating every triangle edge as a real
// feature. A flat road tessellated into triangles is full of INTERNAL edges, and
// a collider sliding across them catches "ghost" contacts — the car reads bumps,
// snags and small kicks at triangle seams on perfectly flat asphalt.
// `TriMeshFlags.FIX_INTERNAL_EDGES` makes Rapier account for adjacent triangle
// normals (pseudo-normals) when building contacts, which removes exactly those.
// This is the standard flag for static level geometry. NOTE: with this flag set,
// trimesh contacts become effectively ONE-SIDED — the triangles must face where
// the bodies come from (up, for roads). A track GLB with flipped winding would
// let the car fall through where the unflagged trimesh caught it from both sides.
//
// Each mesh's root-relative transform is BAKED into the vertex array (the same
// trick CarWheels uses), so colliders land at the track group's origin with an
// identity local pose — no per-collider position/rotation/scale plumbing, and
// the GLB's internal node transforms just work.

import * as THREE from 'three/webgpu';
import { TriMeshFlags } from '@dimforge/rapier3d-compat';

// WHICH meshes collide — the drivable surfaces and the solid ones. The GLB has
// five meshes: Ground (dirt plane), Asphalt (road), Metal (barriers/fences),
// Decals (road paint) and Leafs_Mat (foliage). Decals and Leafs_Mat are
// EXCLUDED:
//  - Decals are 31 k triangles of paint lying a hair off the deck. A decal
//    strip is its OWN collider here, so its boundary edges are real edges to
//    Rapier — FIX_INTERNAL_EDGES only smooths edges shared WITHIN one trimesh —
//    and the chassis rolling over paint was a ghost-contact factory (the
//    "car sometimes snags on nothing" class of stutter).
//  - Leafs_Mat foliage is thin double-sided quads along the roads: edge-on at
//    speed they are invisible walls.
// Filtered by MATERIAL, not node name: Ground/Asphalt/Metal are semantic and
// survive a re-export; Object_6-style exporter names do not.
const TRIMESH_MATERIALS = new Set(['Asphalt', 'Metal']);
/** The dirt plane's material — becomes the FLOOR instead of a trimesh. */
const FLOOR_MATERIAL = 'Ground';

export type TrackCollider =
	| { kind: 'trimesh'; id: string; args: [Float32Array, Uint32Array, TriMeshFlags] }
	| {
			kind: 'floor';
			id: string;
			/** Floor centre in the TRACK frame (GLB units). */
			center: [number, number, number];
			/** Half-extents in the TRACK frame (GLB units). */
			half: [number, number, number];
	  };

// The dirt plane in the GLB is a unit quad scaled ×230 — TWO triangles spanning
// 460 m each. Driving on it stuttered at every physics rate tried (200 Hz and
// 60 Hz alike, i.e. RATE-INDEPENDENT — not a stepping or interpolation
// artifact): convex-vs-trimesh contact manifolds degrade when the triangles are
// ~100× the dynamic collider, which reads as continuous micro-jitter while the
// car is on the dirt (the foliage areas ride on the same plane — there was
// never a foliage contact, the dirt UNDER the trees was the jitter). The dirt
// is perfectly FLAT, so it does not need triangles at all: it becomes an
// analytical cuboid floor — ideal contacts, no BVH, no winding, no edges. The
// top face sits exactly at the plane's height, so the known 1.1 cm lip at
// asphalt edges (Asphalt sits that much higher than Ground) is unchanged.
const FLOOR_HALF_Y = 25; // GLB units of thickness downward — past caring

export function buildTrackColliders(root: THREE.Object3D): TrackCollider[] {
	root.updateMatrixWorld(true);
	const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const m = new THREE.Matrix4();

	const out: TrackCollider[] = [];
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry) return;

		const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		const isFloor = material?.name === FLOOR_MATERIAL;
		if (!material || (!isFloor && !TRIMESH_MATERIALS.has(material.name))) return;

		const geometry = mesh.geometry;
		const position = geometry.getAttribute('position');
		if (!position) return;

		// Clone + bake: vertices in the TRACK frame, GLB units. The track group's
		// own scale/rotation (1.5, -60°) is NOT baked — Threlte's Collider picks
		// both up from the object's world transform and scales the args to match
		// (scaleColliderArgs), so it must not be baked here too.
		m.multiplyMatrices(rootInv, mesh.matrixWorld);
		const baked = new Float32Array(position.array as ArrayLike<number>);
		const v = new THREE.Vector3();
		for (let i = 0; i < baked.length; i += 3) {
			v.set(baked[i], baked[i + 1], baked[i + 2]).applyMatrix4(m);
			baked[i] = v.x;
			baked[i + 1] = v.y;
			baked[i + 2] = v.z;
		}

		if (isFloor) {
			// Bounds of the baked verts → an analytical floor box, top face at the
			// plane's own height.
			let minX = Infinity;
			let minY = Infinity;
			let minZ = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			let maxZ = -Infinity;
			for (let i = 0; i < baked.length; i += 3) {
				minX = Math.min(minX, baked[i]);
				maxX = Math.max(maxX, baked[i]);
				minY = Math.min(minY, baked[i + 1]);
				maxY = Math.max(maxY, baked[i + 1]);
				minZ = Math.min(minZ, baked[i + 2]);
				maxZ = Math.max(maxZ, baked[i + 2]);
			}
			out.push({
				kind: 'floor',
				id: mesh.uuid,
				center: [(minX + maxX) / 2, maxY - FLOOR_HALF_Y, (minZ + maxZ) / 2],
				half: [(maxX - minX) / 2, FLOOR_HALF_Y, (maxZ - minZ) / 2]
			});
			return;
		}

		// Non-indexed geometry: trivial 0..n-1 indices.
		const index = geometry.index;
		const indices = index
			? new Uint32Array(index.array as ArrayLike<number>)
			: Uint32Array.from({ length: baked.length / 3 }, (_, i) => i);

		out.push({
			kind: 'trimesh',
			id: mesh.uuid,
			args: [baked, indices, TriMeshFlags.FIX_INTERNAL_EDGES]
		});
	});
	return out;
}
