// THE MINIMAP'S TRACK SHAPE — the drivable surface, turned into one SVG path.
//
// Built ONCE, from the GLB the scene already loaded (no second asset, no bake
// step, and a track re-export moves the map for free). It is the only honest
// source for "what does this circuit look like from above": the alternative —
// a top-down orthographic camera rendered into a texture — is a second full
// scene render per frame, in a scene DOCS/testperf.md already calls fill-bound.
//
// The pipeline is three steps, all of them one-time:
//
//   1. RASTERIZE. Every `Asphalt` triangle is projected to the XZ plane and
//      stamped into a GRID² occupancy bitmap. Cell CENTRES are filled by a
//      point-in-triangle test, and each triangle's three EDGES are stamped by a
//      DDA line on top. Both halves are load-bearing: centres alone drop
//      anything thinner than a cell (a pit lane, a kerb strip, and every road on
//      a track big enough to make GRID tight), and edges alone leave a long
//      straight — two big triangles — hollow.
//   2. CONTOUR. Marching squares over the cell centres — the standard 16-case
//      table, midpoint vertices. Binary occupancy means every segment endpoint
//      lands exactly on a cell-edge midpoint, so endpoints from neighbouring
//      cells are bit-identical and the segments chain by exact key rather than
//      by distance.
//   3. SIMPLIFY. Ramer–Douglas–Peucker at sub-cell tolerance, which is what
//      collapses the staircase a grid contour is made of into the handful of
//      points a straight or a constant-radius corner actually needs. It cuts
//      the path string by ~10× and is the difference between a map that reads
//      as drawn and one that reads as pixelated.
//
// The result is closed rings — outer boundary plus holes (infield, pit island)
// — emitted as ONE path. The consumer fills it `evenodd`, so holes punch
// through without any winding bookkeeping here.

import * as THREE from 'three/webgpu';

/** WHICH meshes are "the map". The drivable surface and only that — the same
 *  material-name filter (and the same reason) as `trackColliders.ts`: exporter
 *  node names are not stable across a re-export, material names are. Barriers
 *  (`Metal`) are deliberately out: they span ~3 000 units of scenery fence and
 *  would fit the map to the world instead of to the circuit. */
const MAP_MATERIALS = new Set(['Asphalt']);

/** Occupancy grid resolution, and it is RELATIVE, not absolute: the grid is
 *  fitted to the circuit's own bounds, so what this buys is cells-per-road-
 *  width, and a bigger circuit gets a coarser map at the same number.
 *
 *  Measured on this track — the asphalt spans 557 world units, so 512 puts a
 *  cell at ~1.1 world units (~0.44 m) and a road at a dozen-odd cells, with
 *  35 ms and a 256 kB scratch bitmap spent once, behind the loading veil. That
 *  is deliberate headroom: it is the RATIO that has to survive, so a circuit
 *  several times this one's size wants this raised rather than left alone. Below
 *  ~3 cells per road width the contour stops being a road and becomes speckle. */
const GRID = 512;

/** Map-space side of the square the track is fitted into — the SVG viewBox the
 *  path is authored in. Arbitrary, but fixed, so the component can lay out
 *  against it without asking. */
const SIZE = 100;

/** Map units kept clear around the fitted track, so the outline's stroke width
 *  never clips against the viewBox edge. */
const PAD = 3;

/** RDP tolerance, in CELLS. Below ~0.5 the staircase survives; much above 1 and
 *  real corners start cutting. */
const SIMPLIFY_CELLS = 0.7;

/** Contours narrower than this many cells in BOTH axes are rasterization
 *  speckle — a stray triangle, a decal-thin sliver — not part of the circuit. */
const MIN_EXTENT_CELLS = 5;

export type TrackMap = {
	/** The outline, as SVG path data in map space (a `0 0 SIZE SIZE` viewBox).
	 *  Several closed subpaths: outer boundary + holes. Fill it `evenodd`. */
	d: string;
	/** The viewBox side the path is authored in. */
	size: number;
	/** World XZ the map is centred on. */
	centerX: number;
	centerZ: number;
	/** Map units per world unit. */
	scale: number;
};

/** World XZ → map XY. World +Z is map +Y (down the viewBox), which is what makes
 *  the map NORTH-UP and matches a top-down view of the scene with no flip. */
export function worldToMap(map: TrackMap, x: number, z: number): [number, number] {
	return [
		(x - map.centerX) * map.scale + map.size / 2,
		(z - map.centerZ) * map.scale + map.size / 2
	];
}

/**
 * Build the minimap outline from the track GLB.
 *
 * `toWorld` is the track group's own transform (scale + yaw), passed EXPLICITLY
 * rather than read off `root.matrixWorld`. The GLB's scene object is attached to
 * that group by a child component, so whether its world matrix is live at the
 * moment this runs is a mount-ordering question — and one wrong answer here
 * silently yields a map rotated 60° off the car's coordinates. Mesh transforms
 * INSIDE the GLB are read relatively (`rootInv × mesh.matrixWorld`, the same
 * order-independent trick `trackColliders.ts` bakes with), so only the group's
 * own pose has to be supplied.
 *
 * Returns `undefined` when the GLB carries none of `MAP_MATERIALS` — a map of
 * nothing is not a map, and the HUD shows its empty bezel instead.
 */
export function buildTrackMap(root: THREE.Object3D, toWorld: THREE.Matrix4): TrackMap | undefined {
	root.updateMatrixWorld(true);
	const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const m = new THREE.Matrix4();
	const v = new THREE.Vector3();

	// Flat triangle soup in world XZ: [ax, az, bx, bz, cx, cz, …].
	const tris: number[] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;

	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry) return;
		const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		if (!material || !MAP_MATERIALS.has(material.name)) return;

		const position = mesh.geometry.getAttribute('position');
		if (!position) return;

		m.multiplyMatrices(rootInv, mesh.matrixWorld); // mesh → track frame
		m.premultiply(toWorld); // track frame → world

		// Project every vertex once, then walk the index buffer — a shared vertex
		// in a road strip is referenced by six triangles on average.
		const count = position.count;
		const px = new Float64Array(count);
		const pz = new Float64Array(count);
		for (let i = 0; i < count; i++) {
			v.fromBufferAttribute(position, i).applyMatrix4(m);
			px[i] = v.x;
			pz[i] = v.z;
			if (v.x < minX) minX = v.x;
			if (v.x > maxX) maxX = v.x;
			if (v.z < minZ) minZ = v.z;
			if (v.z > maxZ) maxZ = v.z;
		}

		const index = mesh.geometry.index;
		const n = index ? index.count : count;
		for (let i = 0; i + 2 < n; i += 3) {
			const a = index ? index.getX(i) : i;
			const b = index ? index.getX(i + 1) : i + 1;
			const c = index ? index.getX(i + 2) : i + 2;
			tris.push(px[a], pz[a], px[b], pz[b], px[c], pz[c]);
		}
	});

	if (!tris.length || !Number.isFinite(minX)) return undefined;

	const centerX = (minX + maxX) / 2;
	const centerZ = (minZ + maxZ) / 2;
	const span = Math.max(maxX - minX, maxZ - minZ);
	if (span <= 0) return undefined;
	const scale = (SIZE - 2 * PAD) / span;

	// ── 1. Rasterize ────────────────────────────────────────────────────────
	// Grid coordinates are CELL-CENTRE INDEX space: cell (gx, gy)'s centre sits
	// at integer (gx, gy), which is what lets the marching-squares pass below
	// sample corners at integers and land its vertices on exact half-integers.
	const cell = SIZE / GRID;
	const half = SIZE / 2;
	const gxOf = (x: number) => ((x - centerX) * scale + half) / cell - 0.5;
	const gyOf = (z: number) => ((z - centerZ) * scale + half) / cell - 0.5;

	const grid = new Uint8Array(GRID * GRID);
	const stamp = (gx: number, gy: number) => {
		if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return;
		grid[gy * GRID + gx] = 1;
	};
	// DDA — the triangle's boundary, so a road narrower than a cell still leaves
	// a mark. `round` because the samples are cell centres at integer indices.
	const line = (ax: number, ay: number, bx: number, by: number) => {
		const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)));
		if (steps === 0) return stamp(Math.round(ax), Math.round(ay));
		for (let s = 0; s <= steps; s++) {
			const t = s / steps;
			stamp(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t));
		}
	};

	for (let i = 0; i < tris.length; i += 6) {
		const ax = gxOf(tris[i]);
		const ay = gyOf(tris[i + 1]);
		const bx = gxOf(tris[i + 2]);
		const by = gyOf(tris[i + 3]);
		const cx = gxOf(tris[i + 4]);
		const cy = gyOf(tris[i + 5]);

		line(ax, ay, bx, by);
		line(bx, by, cx, cy);
		line(cx, cy, ax, ay);

		// Interior fill: every cell centre inside the triangle. Sign-normalised
		// edge functions, so either winding works — the GLB's is not our business.
		const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		if (area === 0) continue;
		const s = area > 0 ? 1 : -1;
		const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
		const x1 = Math.min(GRID - 1, Math.floor(Math.max(ax, bx, cx)));
		const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)));
		const y1 = Math.min(GRID - 1, Math.floor(Math.max(ay, by, cy)));
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * s;
				if (w0 < 0) continue;
				const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * s;
				if (w1 < 0) continue;
				const w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) * s;
				if (w2 < 0) continue;
				grid[y * GRID + x] = 1;
			}
		}
	}

	// ── 2. Contour ──────────────────────────────────────────────────────────
	// Marching squares over cell centres. A "square" (gx, gy) has its corners at
	// the centres of cells (gx, gy), (gx+1, gy), (gx+1, gy+1), (gx, gy+1), and
	// its vertices at the midpoints of those corner-to-corner edges — so every
	// coordinate is an exact multiple of ½ and keys as an integer at ×2.
	//
	// Endpoints are stored doubled (KEY = 2x·K + 2y) so chaining is a Map lookup
	// rather than a float comparison.
	const K = 4 * GRID;
	const segA: number[] = [];
	const segB: number[] = [];
	const adj = new Map<number, number[]>();
	const key = (x2: number, y2: number) => x2 * K + y2;
	const link = (k: number, seg: number) => {
		const list = adj.get(k);
		if (list) list.push(seg);
		else adj.set(k, [seg]);
	};
	const push = (ax2: number, ay2: number, bx2: number, by2: number) => {
		const ka = key(ax2, ay2);
		const kb = key(bx2, by2);
		const i = segA.length;
		segA.push(ka);
		segB.push(kb);
		link(ka, i);
		link(kb, i);
	};

	for (let gy = 0; gy < GRID - 1; gy++) {
		for (let gx = 0; gx < GRID - 1; gx++) {
			const tl = grid[gy * GRID + gx];
			const tr = grid[gy * GRID + gx + 1];
			const br = grid[(gy + 1) * GRID + gx + 1];
			const bl = grid[(gy + 1) * GRID + gx];
			const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
			if (code === 0 || code === 15) continue;

			// Edge midpoints, doubled.
			const x2 = gx * 2;
			const y2 = gy * 2;
			const tX = x2 + 1; // top edge
			const tY = y2;
			const rX = x2 + 2; // right edge
			const rY = y2 + 1;
			const bX = x2 + 1; // bottom edge
			const bY = y2 + 2;
			const lX = x2; // left edge
			const lY = y2 + 1;

			switch (code) {
				case 1:
				case 14:
					push(lX, lY, bX, bY);
					break;
				case 2:
				case 13:
					push(bX, bY, rX, rY);
					break;
				case 3:
				case 12:
					push(lX, lY, rX, rY);
					break;
				case 4:
				case 11:
					push(tX, tY, rX, rY);
					break;
				case 6:
				case 9:
					push(tX, tY, bX, bY);
					break;
				case 7:
				case 8:
					push(lX, lY, tX, tY);
					break;
				// The two ambiguous saddles. Resolved the same way every time —
				// which choice is arbitrary, consistency is not (mixing them opens
				// contours, and an open contour cannot be filled).
				case 5:
					push(lX, lY, tX, tY);
					push(bX, bY, rX, rY);
					break;
				case 10:
					push(tX, tY, rX, rY);
					push(lX, lY, bX, bY);
					break;
			}
		}
	}

	if (!segA.length) return undefined;

	// Chain the segments into rings by walking the shared-endpoint adjacency.
	const used = new Uint8Array(segA.length);
	const parts: string[] = [];

	/** Walk from `from` along unused segments, appending endpoint keys. */
	const walk = (from: number, into: number[]) => {
		let at = from;
		for (;;) {
			const list = adj.get(at);
			if (!list) return;
			let next = -1;
			for (const seg of list) {
				if (!used[seg]) {
					next = seg;
					break;
				}
			}
			if (next < 0) return;
			used[next] = 1;
			at = segA[next] === at ? segB[next] : segA[next];
			into.push(at);
		}
	};

	for (let i = 0; i < segA.length; i++) {
		if (used[i]) continue;
		used[i] = 1;
		const forward: number[] = [segA[i], segB[i]];
		walk(segB[i], forward);
		// The other direction — a contour clipped by the grid edge is open, and
		// starting mid-run would otherwise throw half of it away. Concatenated
		// rather than unshifted: a ring runs to tens of thousands of points and
		// `unshift(...back)` spreads every one of them as a call argument.
		const back: number[] = [];
		walk(segA[i], back);
		const ring = back.length ? back.reverse().concat(forward) : forward;

		const part = emit(ring, K, cell, SIMPLIFY_CELLS, MIN_EXTENT_CELLS);
		if (part) parts.push(part);
	}

	if (!parts.length) return undefined;
	return { d: parts.join(' '), size: SIZE, centerX, centerZ, scale };
}

/** One chained ring → one simplified subpath in map units, or '' if it is
 *  speckle. Keys carry the doubled cell-centre coordinates; everything below
 *  works in cells and converts only at the end. */
function emit(
	ring: number[],
	K: number,
	cell: number,
	tolCells: number,
	minExtent: number
): string {
	if (ring.length < 3) return '';

	const xs: number[] = [];
	const ys: number[] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const k of ring) {
		const x = Math.floor(k / K) / 2;
		const y = (k % K) / 2;
		xs.push(x);
		ys.push(y);
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	if (maxX - minX < minExtent && maxY - minY < minExtent) return '';

	const closed = xs[0] === xs[xs.length - 1] && ys[0] === ys[ys.length - 1];
	const keep = rdp(xs, ys, tolCells);
	if (keep.length < 3) return '';

	// Cell-centre index space → map units: centre of cell i sits at (i + ½)·cell.
	const at = (i: number) => {
		const x = (xs[i] + 0.5) * cell;
		const y = (ys[i] + 0.5) * cell;
		return `${round2(x)} ${round2(y)}`;
	};

	let d = `M${at(keep[0])}`;
	for (let i = 1; i < keep.length; i++) d += `L${at(keep[i])}`;
	return closed ? d + 'Z' : d;
}

/** Ramer–Douglas–Peucker, iterative (a grid contour can be tens of thousands of
 *  points — recursion here is a stack overflow waiting for a bigger track).
 *  Returns the indices to keep, in order. */
function rdp(xs: number[], ys: number[], tol: number): number[] {
	const n = xs.length;
	if (n < 3) return xs.map((_, i) => i);

	const keep = new Uint8Array(n);
	keep[0] = 1;
	keep[n - 1] = 1;

	const stack: number[] = [0, n - 1];
	const tol2 = tol * tol;
	while (stack.length) {
		const last = stack.pop() as number;
		const first = stack.pop() as number;
		if (last - first < 2) continue;

		const ax = xs[first];
		const ay = ys[first];
		const dx = xs[last] - ax;
		const dy = ys[last] - ay;
		const len2 = dx * dx + dy * dy;

		let worst = -1;
		let worstD = tol2;
		for (let i = first + 1; i < last; i++) {
			const px = xs[i] - ax;
			const py = ys[i] - ay;
			// Perpendicular distance², degenerating to point distance² when the
			// span's endpoints coincide (which a closed ring's do).
			let d2: number;
			if (len2 === 0) {
				d2 = px * px + py * py;
			} else {
				const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
				const ex = px - t * dx;
				const ey = py - t * dy;
				d2 = ex * ex + ey * ey;
			}
			if (d2 > worstD) {
				worstD = d2;
				worst = i;
			}
		}

		if (worst < 0) continue;
		keep[worst] = 1;
		stack.push(first, worst, worst, last);
	}

	const out: number[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
	return out;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
