<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { attribute, clamp, uniform, vec3 } from 'three/tsl';
	import { sceneState } from '$extensions/scene';
	import { GR86, UNITS_PER_METER } from './gr86';
	import { carSim } from './carTelemetry.svelte';

	// Skid marks — the road's memory of the squeal. One world-anchored mesh whose
	// geometry is a ring buffer of quads laid at the tyre contact patches while
	// the car slides; fading is ENTIRELY in the shader (per-vertex birth time +
	// intensity, uTime uniform), so nothing is re-uploaded to age a mark.
	//
	// INTENSITY is the squeal driver's twin (carAudio.ts — the loosest source
	// wins, never a sum), minus the two sources that are not actually sliding:
	// cornering load sings but does not scrub rubber, and the launch's chirp is
	// the drop, not a locked tyre. Rears additionally get wheelspin, the
	// handbrake and the launch — an RWD car marks from the back.
	//
	// Rules honored (DOCS/best-practices.md §4): one draw call, no allocation in
	// the task body (every vector/array below is pre-allocated), autoInvalidate
	// OFF with invalidate() only while laying or inside the fade window, and the
	// material is a NodeMaterial + TSL — never ShaderMaterial (blank on WebGPU).

	let { target }: { target?: THREE.Object3D } = $props();

	// ── Layout (body space: world units, y=0 is the road at the car) ────────────
	// Track width is the one number not in gr86.ts (the GLB's wheels are measured
	// at runtime by CarWheels, not exported) — the real car's rear track, 1.55 m.
	// A couple of cm of error is invisible under a 0.54-unit-wide ribbon.
	const HALF_TRACK = 0.775 * UNITS_PER_METER;
	const FRONT_Z = -GR86.wheelbase * (1 - GR86.rearWeightBias) * UNITS_PER_METER;
	const REAR_Z = GR86.wheelbase * GR86.rearWeightBias * UNITS_PER_METER;
	// FL, FR, RL, RR — nose is -Z, +X left (CarHeadlights' sibling convention).
	const WHEELS: readonly (readonly [number, number])[] = [
		[-HALF_TRACK, FRONT_Z],
		[HALF_TRACK, FRONT_Z],
		[-HALF_TRACK, REAR_Z],
		[HALF_TRACK, REAR_Z]
	];

	// ── Tuning ──────────────────────────────────────────────────────────────────
	const HALF_WIDTH = 0.108 * UNITS_PER_METER; // 215 mm tyre
	const MARK_ON = 0.3; // source intensity before rubber is laid
	const SEG_MIN = 0.35; // world units between laid segments
	const LIFT = 0.95; // above the road plane, against z-fighting
	const FADE_IN = 0.25; // s — a mark arrives at full darkness almost at once
	const LIFETIME = 15; // s — then it is gone; keep in sync with the TSL below
	const BURNOUT_ON = 0.55; // rear intensity + near-standstill = the burnout case
	const BURNOUT_RATE = 1.5; // world units/s the lay point creeps along the nose

	// ── Geometry: a fixed ring of quads, overwritten oldest-first ───────────────
	const SEGS_PER_WHEEL = 2048;
	const TOTAL_SEGS = SEGS_PER_WHEEL * 4;
	const VERTS = TOTAL_SEGS * 6;
	const positions = new Float32Array(VERTS * 3); // all-zero = degenerate = free
	const marks = new Float32Array(VERTS * 2); // [birth, intensity] per vertex
	const geometry = new THREE.BufferGeometry();
	const posAttr = new THREE.BufferAttribute(positions, 3);
	const markAttr = new THREE.BufferAttribute(marks, 2);
	geometry.setAttribute('position', posAttr);
	geometry.setAttribute('aMark', markAttr);

	// ── Material: darkness with a shader-side age fade ──────────────────────────
	const uTime = uniform(0);
	// `any`: AttributeNode's TS generics predate the swizzle helpers — .x/.y are
	// real node ops (the same node-graph plumbing cast CarWheels makes).
	const aMark = attribute('aMark', 'vec2') as any;
	const age = uTime.sub(aMark.x);
	const material = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide
	});
	material.colorNode = vec3(0.05, 0.05, 0.055);
	material.opacityNode = aMark
		.y.mul(clamp(age.div(FADE_IN), 0, 1))
		.mul(clamp(age.div(LIFETIME).oneMinus(), 0, 1));

	// ── Per-wheel state, all pre-allocated ──────────────────────────────────────
	const last = new Float64Array(4 * 2); // last lay point, XZ
	const lastY = new Float64Array(4); // its height (slopes)
	const active = [false, false, false, false];
	let head = 0; // ring cursor, shared — overwrite order is all that matters

	// Scene clock — `delta` from the task, never performance.now() (banned in
	// task bodies, core/utils/CLAUDE.md).
	let now = 0;
	let lastLay = -1e4;

	// Pre-allocated scratch. `_v` is reused for contact points; forward comes
	// straight off the matrix (column 3 of the body's basis, negated: nose -Z).
	const _v = new THREE.Vector3();

	const lay = (
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
		intensity: number
	): void => {
		// Perpendicular to the segment in XZ, half a tyre width out.
		let px = -(bz - az);
		let pz = bx - ax;
		const len = Math.hypot(px, pz) || 1;
		px = (px / len) * HALF_WIDTH;
		pz = (pz / len) * HALF_WIDTH;

		const pOff = head * 18;
		const mOff = head * 12;
		// Two triangles: a-, b-, a+ / a-, b+, a+ — DoubleSide forgives winding.
		// Written straight into the ring buffer: no temp arrays in the task body.
		const p = positions;
		p[pOff] = ax - px;
		p[pOff + 1] = ay + LIFT;
		p[pOff + 2] = az - pz;
		p[pOff + 3] = bx - px;
		p[pOff + 4] = by + LIFT;
		p[pOff + 5] = bz - pz;
		p[pOff + 6] = ax + px;
		p[pOff + 7] = ay + LIFT;
		p[pOff + 8] = az + pz;
		p[pOff + 9] = ax - px;
		p[pOff + 10] = ay + LIFT;
		p[pOff + 11] = az - pz;
		p[pOff + 12] = bx + px;
		p[pOff + 13] = by + LIFT;
		p[pOff + 14] = bz + pz;
		p[pOff + 15] = ax + px;
		p[pOff + 16] = ay + LIFT;
		p[pOff + 17] = az + pz;
		for (let i = 0; i < 6; i++) {
			marks[mOff + i * 2] = now;
			marks[mOff + i * 2 + 1] = intensity;
		}
		posAttr.addUpdateRange(pOff, 18);
		markAttr.addUpdateRange(mOff, 12);
		head = (head + 1) % TOTAL_SEGS;
	};

	const { invalidate } = useThrelte();

	useTask(
		(delta) => {
			if (sceneState.currentScene !== 'testGame') return;
			now += delta;
			uTime.value = now;

			// The chase anchor's parent IS the rigid body's object — unscaled body
			// space (world units), which is exactly the space WHEELS lives in.
			const body = target?.parent;
			if (!body) return;

			// ── Intensities: the squeal's sources, minus the not-actually-sliding two.
			const speed = Math.abs(carSim.speedMs);
			const spin = Math.min(Math.max((carSim.slip - 0.15) / 0.35, 0), 1);
			const slide =
				Math.min(Math.max((Math.abs(carSim.drift) - 0.1396) / 0.2967, 0), 1) *
				Math.min(Math.max(speed / 4, 0), 1);
			const hand = carSim.handbrake ? 0.8 * Math.min(Math.max(speed / 10, 0), 1) : 0;
			const hard = carSim.brake * Math.min(Math.max(speed / 6, 0), 1);
			const rearI = Math.max(spin, slide, hand, carSim.launch * 0.8, hard * 0.9);
			const frontI = Math.max(slide * 0.8, hard);

			body.updateWorldMatrix(true, false);
			const e = body.matrixWorld.elements;
			const fwdX = -e[8];
			const fwdZ = -e[10]; // nose is -Z in body space

			let laid = false;
			for (let w = 0; w < 4; w++) {
				const intensity = w >= 2 ? rearI : frontI;
				_v.set(WHEELS[w][0], 0, WHEELS[w][1]);
				body.localToWorld(_v);

				if (intensity < MARK_ON) {
					active[w] = false;
					continue;
				}
				if (!active[w]) {
					active[w] = true;
					last[w * 2] = _v.x;
					last[w * 2 + 1] = _v.z;
					lastY[w] = _v.y;
					continue;
				}

				// Stationary burnout: the car does not move but the tyre keeps laying
				// rubber — creep the lay point along the nose so the patch grows and
				// the overlapping quads (depthWrite off) darken in place.
				let lx = last[w * 2];
				let lz = last[w * 2 + 1];
				let dx = _v.x - lx;
				let dz = _v.z - lz;
				if (Math.hypot(dx, dz) < SEG_MIN && w >= 2 && rearI > BURNOUT_ON && speed < 3) {
					lx += fwdX * BURNOUT_RATE * delta;
					lz += fwdZ * BURNOUT_RATE * delta;
					dx = _v.x - lx;
					dz = _v.z - lz;
				}
				if (Math.hypot(dx, dz) >= SEG_MIN) {
					lay(lx, lastY[w], lz, _v.x, _v.y, _v.z, intensity);
					laid = true;
					last[w * 2] = _v.x;
					last[w * 2 + 1] = _v.z;
					lastY[w] = _v.y;
				}
			}

			if (laid) {
				posAttr.needsUpdate = true;
				markAttr.needsUpdate = true;
				lastLay = now;
			}

			// On-demand discipline: frames only while marks are being laid or are
			// still fading — settled marks cost nothing, the loop goes back to sleep.
			if (now - lastLay < LIFETIME + 1) invalidate();
		},
		{ autoInvalidate: false }
	);

	onDestroy(() => {
		geometry.dispose();
		material.dispose();
	});
</script>

<!-- World-anchored: the mesh never moves, the vertices are laid in world space.
     frustumCulled off — the ring buffer's bounds are meaningless, and one mesh's
     culling test is cheaper than maintaining a bounding sphere over live writes. -->
<T.Mesh
	geometry={geometry}
	material={material}
	frustumCulled={false}
	renderOrder={1}
	userData={{ hideInTree: true, selectable: false }}
/>
