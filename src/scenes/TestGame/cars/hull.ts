// The chassis hull — the car's collider computed from its own GLB at load,
// instead of authored boxes. ONE rounded convex hull (Rapier `roundConvexHull`)
// over every mesh except the wheels (by `model.wheelMaterialPrefix`). See
// CLAUDE.md's colliders section for the full story (why the margin dilates
// outward and the belly is clamped, the decimation/no-phantom-points rule,
// and the world-scale-1 / `roundConvexHull` vertex-scaling gotcha).

import * as THREE from 'three/webgpu';
import type { CarSpec } from './types';
import { centerOfMass } from './spec';
import { UNITS_PER_METER } from '../units';

/** Sample budget fed to quickhull (≈ sum of per-mesh quotas; the floors can
 *  push it a few % over — harmless). */
const MAX_POINTS = 8192;
/** Per-mesh floor on samples — real surface points, so a small outer mesh
 *  (badges, mirrors) keeps its voice in the hull. */
const MIN_PER_MESH = 24;
/** model m — the rounding margin; DILATES the hull outward (see header).
 *  Small on purpose now that the envelope is the real surface: it is only
 *  the edge FILLET, not a compensation for phantom box corners. */
export const HULL_MARGIN = 0.05;
/** model m — the collider belly's outer line: the old box's bump-stop height,
 *  ~13 cm above the rest line. The point cloud is clamped so that the
 *  dilated margin lands back on it (see header). */
const BELLY_LINE = 0.134;

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

	const out: number[] = [];
	const bmin: [number, number, number] = [Infinity, Infinity, Infinity];
	const bmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	const clampY = BELLY_LINE + HULL_MARGIN; // +: dilation pushes the bottom DOWN by the margin
	const push = (p: THREE.Vector3) => {
		// Clamp BEFORE scaling — BELLY_LINE is model metres. Clamped points keep
		// their x/z, so nothing protrudes past the real envelope; the hull's
		// bottom simply becomes the flat undertray it always was.
		const y = Math.max(p.y, clampY);
		const x = p.x * spec.model.scale;
		const yy = y * spec.model.scale;
		const z = p.z * spec.model.scale;
		out.push(x, yy, z);
		if (x < bmin[0]) bmin[0] = x;
		if (yy < bmin[1]) bmin[1] = yy;
		if (z < bmin[2]) bmin[2] = z;
		if (x > bmax[0]) bmax[0] = x;
		if (yy > bmax[1]) bmax[1] = yy;
		if (z > bmax[2]) bmax[2] = z;
	};
	// Per-mesh proportional quotas (with a floor), each sampled on its own
	// stride — see the header for why the quota is REAL points only.
	const quotas = meshes.map((mesh) =>
		Math.max(
			MIN_PER_MESH,
			Math.floor((MAX_POINTS * mesh.geometry.getAttribute('position').count) / totalVerts)
		)
	);

	for (let mi = 0; mi < meshes.length; mi++) {
		const mesh = meshes[mi];
		m.multiplyMatrices(rootInv, mesh.matrixWorld);
		const position = mesh.geometry.getAttribute('position');
		const stride = Math.max(1, Math.ceil(position.count / quotas[mi]));
		for (let i = 0; i < position.count; i += stride) {
			v.fromBufferAttribute(position, i).applyMatrix4(m);
			push(v);
		}
	}

	return {
		points: new Float32Array(out),
		margin: HULL_MARGIN * spec.model.scale,
		bounds: { min: bmin, max: bmax }
	};
}

/** The collider's explicit mass properties — `mass` + `centerOfMass` +
 *  `principalAngularInertia` + `angularInertiaLocalFrame` must ALL be present
 *  or Threlte's Collider silently falls back to geometry-derived `setMass`
 *  (see CLAUDE.md's colliders section). Pitch/roll inertia are box-equivalent
 *  placeholders (those axes are locked); yaw is the spec's real `yawInertia`.
 *  UNITS: world units with kg mass, so inertia is SI kg·m² × UNITS_PER_METER². */
export type ChassisMassProperties = {
	centerOfMass: [number, number, number];
	principalAngularInertia: [number, number, number];
	/** Euler radians — [0,0,0] keeps the principal axes on the body's own. */
	angularInertiaLocalFrame: [number, number, number];
};

export function chassisMassProperties(spec: CarSpec, hull: CarHull): ChassisMassProperties {
	const { mass } = spec.hardware;
	const UPM = UNITS_PER_METER;

	const hx = (hull.bounds.max[0] - hull.bounds.min[0]) / 2;
	const hy = (hull.bounds.max[1] - hull.bounds.min[1]) / 2;
	const hz = (hull.bounds.max[2] - hull.bounds.min[2]) / 2;
	// Solid-box equivalents about each axis (full-extent squares — m/12·(a² + b²)).
	const ixx = (mass / 12) * ((2 * hy) ** 2 + (2 * hz) ** 2); // pitch
	const izz = (mass / 12) * ((2 * hx) ** 2 + (2 * hy) ** 2); // roll
	const iyy = spec.hardware.yawInertia * UPM * UPM; // yaw — the spec's own fact

	const com = centerOfMass(spec);

	return {
		centerOfMass: [com[0], com[1], com[2]],
		principalAngularInertia: [ixx, iyy, izz],
		angularInertiaLocalFrame: [0, 0, 0]
	};
}
