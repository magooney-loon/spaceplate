// Static trimesh colliders for the city — a hand-rolled replacement for
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
// trick CarWheels uses), so every collider lands at the city group's origin with
// an identity local pose — no per-collider position/rotation/scale plumbing, and
// the GLB's internal node transforms just work.

import * as THREE from 'three/webgpu';
import { TriMeshFlags } from '@dimforge/rapier3d-compat';

// WHICH meshes collide — the drivable surfaces and the solid ones. The GLB has
// five meshes: Ground (dirt plane), Asphalt (road), Metal (barriers/fences),
// Decals (road paint) and Leafs_Mat (foliage). The last two are EXCLUDED:
//  - Decals are 31 k triangles of paint lying a hair off the deck. A decal
//    strip is its OWN collider here, so its boundary edges are real edges to
//    Rapier — FIX_INTERNAL_EDGES only smooths edges shared WITHIN one trimesh —
//    and the chassis rolling over paint was a ghost-contact factory (the
//    "car sometimes snags on nothing" class of stutter).
//  - Leafs_Mat foliage is thin double-sided quads along the roads: edge-on at
//    speed they are invisible walls.
// Filtered by MATERIAL, not node name: Ground/Asphalt/Metal are semantic and
// survive a re-export; Object_6-style exporter names do not.
const COLLIDER_MATERIALS = new Set(['Ground', 'Asphalt', 'Metal']);

export interface CityTrimesh {
	/** Stable key for the {#each} block. */
	id: string;
	/** args for `<Collider shape="trimesh">`: vertices, indices, flags. */
	args: [Float32Array, Uint32Array, TriMeshFlags];
}

export function buildCityColliders(root: THREE.Object3D): CityTrimesh[] {
	root.updateMatrixWorld(true);
	const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const m = new THREE.Matrix4();

	const out: CityTrimesh[] = [];
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry) return;

		const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		if (!material || !COLLIDER_MATERIALS.has(material.name)) return;

		const geometry = mesh.geometry;
		const position = geometry.getAttribute('position');
		if (!position) return;

		// Clone + bake: vertices in the CITY frame, GLB units. The city group's
	// own scale/rotation (1.5, -60°) is NOT baked — Threlte's Collider picks
	// both up from the object's world transform and scales the vertex array
	// to match (scaleColliderArgs), so it must not be baked here too.
		m.multiplyMatrices(rootInv, mesh.matrixWorld);
		const baked = new Float32Array(position.array as ArrayLike<number>);
		const v = new THREE.Vector3();
		for (let i = 0; i < baked.length; i += 3) {
			v.set(baked[i], baked[i + 1], baked[i + 2]).applyMatrix4(m);
			baked[i] = v.x;
			baked[i + 1] = v.y;
			baked[i + 2] = v.z;
		}

		// Non-indexed geometry: trivial 0..n-1 indices.
		const index = geometry.index;
		const indices = index
			? new Uint32Array(index.array as ArrayLike<number>)
			: Uint32Array.from({ length: baked.length / 3 }, (_, i) => i);

		out.push({
			id: mesh.uuid,
			args: [baked, indices, TriMeshFlags.FIX_INTERNAL_EDGES]
		});
	});
	return out;
}
