// The chassis hull — the car's collider computed from its own GLB at load,
// instead of authored boxes. ONE rounded convex hull (Rapier `roundConvexHull`)
// over every mesh in the model except the wheels:
//
//  - The WHEELS are excluded because the hull must not be a ground contact —
//    the raycast springs are (sim/suspension.ts), and a hull that reached the
//    tyre bottoms (model y 0.01) would stand the car on its body. Exclusion is
//    by the spec's `model.wheelMaterialPrefix`, the same contract fx/CarWheels
//    splits wheels by.
//  - Interior meshes (seats, engine, glass, badges …) cost nothing: their
//    vertices sit inside the hull and quickhull discards them. The MIRRORS are
//    kept (they are the real silhouette — the hull runs ±0.996 where the body
//    sheet is ±0.91), so the collider is a touch wider than the old box at
//    beltline height; a convex shape cannot have mirror-stalk concavities
//    anyway.
//  - The MARGIN is the old undertray box's `rounding` reborn: Rapier DILATES a
//    round hull by its border radius, so the collider is the car + 4 cm — body
//    half-width 0.91 + 0.04 = 0.95, exactly the old box's hx — and its edges
//    GLANCE off kerbs and barrier bases instead of face-stopping. The belly
//    lands at ~0.12 model m, within ~1.5 cm of the old box's bump-stop line.
//
// UNITS — the points leave here in WORLD units (model metres ×
// spec.model.scale) and the Collider must sit at WORLD SCALE 1 (directly under
// the RigidBody, no scaled group): Threlte's scaleColliderArgs vertex-scales
// `convexHull` args but NOT `roundConvexHull` — it falls into the positional
// [x,y,z] branch and would multiply the point array by a scalar. The same
// class of quirk as the old roundCuboid fourth-arg rule; the scaling just
// happens here instead.
//
// Decimation: the GLB is ~325 k triangles; quickhull gets at most MAX_POINTS
// samples (one global stride) plus every mesh's 8 bounding-box corners, so
// outer extremes survive an unlucky stride and a tiny outer mesh is never lost
// entirely. ~4 k points build once per load, well under a frame.

import * as THREE from 'three/webgpu';
import type { CarSpec } from './types';
import { UNITS_PER_METER } from '../units';

/** Sample budget fed to quickhull (per-mesh bbox corners included). */
const MAX_POINTS = 4096;
/** model m — the rounding margin; DILATES the hull outward (see header). */
export const HULL_MARGIN = 0.04;

export type CarHull = {
	/** World-unit vertices — Rapier computes the convex hull from these. */
	points: Float32Array;
	/** World-unit border radius for `roundConvexHull`. */
	margin: number;
	/** World-unit AABB of the point cloud (per-mesh bbox corners make the
	 *  extremes exact) — feeds the pitch/roll inertia placeholders below. */
	bounds: {
		min: [number, number, number];
		max: [number, number, number];
	};
};

export function buildCarHull(root: THREE.Object3D, spec: CarSpec): CarHull | undefined {
	root.updateMatrixWorld(true);
	// Root-relative bake — the same trick as trackColliders.ts: vertices in the
	// model's own space wherever the scene is currently mounted, so the hull
	// args match the spec's model-metre measurements.
	const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const m = new THREE.Matrix4();
	const v = new THREE.Vector3();

	const wheelPrefix = spec.model.wheelMaterialPrefix.toLowerCase();
	const meshes: THREE.Mesh[] = [];
	let totalVerts = 0;
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry) return;
		const position = mesh.geometry.getAttribute('position');
		if (!position) return;
		const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		if (!material?.name?.toLowerCase().startsWith(wheelPrefix)) {
			meshes.push(mesh);
			totalVerts += position.count;
		}
	});
	if (meshes.length === 0 || totalVerts === 0) return undefined;

	// One global stride so the sample total lands near the budget however the
	// triangles are distributed between meshes.
	const stride = Math.max(1, Math.ceil(totalVerts / (MAX_POINTS - meshes.length * 8)));

	const out: number[] = [];
	const bmin: [number, number, number] = [Infinity, Infinity, Infinity];
	const bmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	const push = (p: THREE.Vector3) => {
		const x = p.x * spec.model.scale;
		const y = p.y * spec.model.scale;
		const z = p.z * spec.model.scale;
		out.push(x, y, z);
		if (x < bmin[0]) bmin[0] = x;
		if (y < bmin[1]) bmin[1] = y;
		if (z < bmin[2]) bmin[2] = z;
		if (x > bmax[0]) bmax[0] = x;
		if (y > bmax[1]) bmax[1] = y;
		if (z > bmax[2]) bmax[2] = z;
	};

	for (const mesh of meshes) {
		m.multiplyMatrices(rootInv, mesh.matrixWorld);
		const position = mesh.geometry.getAttribute('position');
		for (let i = 0; i < position.count; i += stride) {
			v.fromBufferAttribute(position, i).applyMatrix4(m);
			push(v);
		}
		// The mesh's own extremes, stride-proof.
		if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
		const bb = mesh.geometry.boundingBox;
		if (!bb) continue;
		for (let xi = 0; xi < 2; xi++)
			for (let yi = 0; yi < 2; yi++)
				for (let zi = 0; zi < 2; zi++) {
					v.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z)
						.applyMatrix4(m);
					push(v);
				}
	}

	return { points: new Float32Array(out), margin: HULL_MARGIN * spec.model.scale, bounds: { min: bmin, max: bmax } };
}

/** The collider's explicit mass properties — the `mass` + `centerOfMass` +
 *  `principalAngularInertia` + `angularInertiaLocalFrame` set Threlte's
 *  Collider switches to (all three extras or it silently falls back to
 *  `setMass`, geometry-derived). The body's mass properties become the SPEC'S
 *  facts instead of a side effect of collider geometry:
 *
 *  - COM: x 0 (symmetric car), y `cogHeight`, z from the weight-bias lever rule
 *    (`frontAxleZ + wheelbase·rearWeightBias` — the GR86's 53/47 puts it
 *    15.5 cm ahead of the origin, where no hull centroid would land).
 *  - Yaw inertia: the spec's `yawInertia` — the one component that is dynamic
 *    here, and even then only for contact-driven rotation (steering is DIRECT
 *    yaw-rate control via `setAngvel`, which inertia does not shape).
 *  - Pitch/roll: `enabledRotations` locks both axes, so those components never
 *    integrate — they are box-equivalent placeholders computed from the hull's
 *    bounds, honest in scale, inert in effect.
 *
 *  UNITS: the collider lives in world units with kg mass, so inertia must be
 *  kg·(world-unit)² — SI kg·m² × UNITS_PER_METER² — and the COM in world
 *  units (units.ts's documented boundary, applied here because these values
 *  feed Rapier directly). */
export type ChassisMassProperties = {
	centerOfMass: [number, number, number];
	principalAngularInertia: [number, number, number];
	/** Euler radians — [0,0,0] keeps the principal axes on the body's own. */
	angularInertiaLocalFrame: [number, number, number];
};

export function chassisMassProperties(spec: CarSpec, hull: CarHull): ChassisMassProperties {
	const { mass, cogHeight, rearWeightBias } = spec.hardware;
	const { frontAxleZ, rearAxleZ } = spec.geometry;
	const UPM = UNITS_PER_METER;

	const hx = (hull.bounds.max[0] - hull.bounds.min[0]) / 2;
	const hy = (hull.bounds.max[1] - hull.bounds.min[1]) / 2;
	const hz = (hull.bounds.max[2] - hull.bounds.min[2]) / 2;
	// Solid-box equivalents about each axis (full-extent squares — m/12·(a² + b²)).
	const ixx = (mass / 12) * ((2 * hy) ** 2 + (2 * hz) ** 2); // pitch
	const izz = (mass / 12) * ((2 * hx) ** 2 + (2 * hy) ** 2); // roll
	const iyy = spec.hardware.yawInertia * UPM * UPM; // yaw — the spec's own fact

	return {
		centerOfMass: [
			0,
			cogHeight * UPM,
			// Lever rule off the ACTUAL axle positions (their span IS the wheelbase):
			// the rear axle carries `rearWeightBias` of the weight, so the COM sits
			// that fraction of the span behind the front axle.
			(frontAxleZ + (rearAxleZ - frontAxleZ) * rearWeightBias) * UPM
		],
		principalAngularInertia: [ixx, iyy, izz],
		angularInertiaLocalFrame: [0, 0, 0]
	};
}
