<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { attribute, clamp, positionWorld, smoothstep, texture, uniform, vec2 } from 'three/tsl';
	import { BASE_URL } from '$extensions/settings';
	import { currentCar } from '../cars';
	import { wheelPatches } from '../cars/spec';
	import { UNITS_PER_METER } from '../units';
	import { carSim } from '../sim/carTelemetry.svelte';

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
	// From the car's spec (geometry.axleZ / halfTrack) via the shared wheelPatches
	// helper — the smoke's twin layout, one source.
	const WHEELS = wheelPatches(currentCar());

	// ── Tuning ──────────────────────────────────────────────────────────────────
	const HALF_WIDTH = currentCar().geometry.tyreHalfWidth * UNITS_PER_METER;
	const MARK_ON = 0.3; // source intensity before rubber is laid
	const MARK_EXIT = 0.22; // hysteresis — chatter at the threshold lays confetti
	const SEG_MIN = 0.35; // world units between laid segments
	const TAIL_MAX = 0.25; // a tapering tail is never longer than this
	const LIFT = 0.9; // above the road plane, against z-fighting
	const FADE_IN = 0.25; // s — a mark arrives at full darkness almost at once
	const LIFETIME = 15; // s — then it is gone; keep in sync with the TSL below
	const BURNOUT_ON = 0.55; // rear intensity + near-standstill = the burnout case
	const BURNOUT_RATE = 1.5; // world units/s the lay point creeps along the nose

	// ── Geometry: a fixed ring of INDEXED quads, overwritten oldest-first ───────
	// Four verts per segment (aL, aR, bL, bR), indices pick the two triangles.
	// NOT six verts: the 6-vert version's shared diagonal was the ugly
	// triangle/diamond patterning — with both a-verts carrying the previous
	// segment's values and both b-verts the current ones, the quad is planar in
	// value space and the diagonal (wherever it falls) interpolates identically
	// to the length. No seam, no diamond.
	const SEGS_PER_WHEEL = 2048;
	const TOTAL_SEGS = SEGS_PER_WHEEL * 4;
	const VERTS = TOTAL_SEGS * 4;
	const positions = new Float32Array(VERTS * 3); // all-zero = degenerate = free
	// Normals are written ONCE: every mark lies on the ground plane, face up —
	// the lighting below needs them, the laying never changes them.
	const normals = new Float32Array(VERTS * 3);
	for (let i = 0; i < VERTS; i++) normals[i * 3 + 1] = 1;
	// [birth, intensity, edge, grain] per vertex — edge is the cross-width
	// coordinate -1..+1 (what the shader feathers into a soft rim) and grain is
	// LAY-TIME randomness. The a-end of each segment carries the PREVIOUS
	// segment's intensity/grain so both interpolate down the strip, not band.
	const marks = new Float32Array(VERTS * 4);
	const indices = new Uint32Array(TOTAL_SEGS * 6);
	for (let s = 0; s < TOTAL_SEGS; s++) {
		const b = s * 4;
		const o = s * 6;
		indices[o] = b;
		indices[o + 1] = b + 1;
		indices[o + 2] = b + 2;
		indices[o + 3] = b + 2;
		indices[o + 4] = b + 1;
		indices[o + 5] = b + 3;
	}
	const geometry = new THREE.BufferGeometry();
	const posAttr = new THREE.BufferAttribute(positions, 3);
	const markAttr = new THREE.BufferAttribute(marks, 4);
	geometry.setAttribute('position', posAttr);
	geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	geometry.setAttribute('aMark', markAttr);
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));

	// ── Material: LIT rubber, soft rim, texture-mottled ────────────────────────
	// Standard, not Basic, on purpose — unlit was a real bug: a fixed dark gray
	// lifted by the night exposure is LIGHTER than night asphalt, so marks read
	// whitish-gray after dark. As a lit surface the rubber darkens with the
	// environment (and takes fog) like the road does: darker than asphalt by
	// day, near-black at night — always a mark, never chalk.
	const uTime = uniform(0);
	// `any`: AttributeNode's TS generics predate the swizzle helpers — .x/.y/.z/.w
	// are real node ops (the same node-graph plumbing cast CarWheels makes).
	const aMark = attribute('aMark', 'vec4') as any;
	const age = uTime.sub(aMark.x);

	// The scratch/mottle: two samples of the vendored perlin PNG at different
	// WORLD scales (public/textures/noises/ — already shipped for exactly this
	// kind of thing), multiplied together. World-anchored, so it is stable — no
	// shimmer — and continuous along the strip; the product of two scales reads
	// as scratched, patchy rubber rather than one obvious pattern.
	const noiseMap = new THREE.TextureLoader().load(`${BASE_URL}textures/noises/perlin.png`, () =>
		invalidate()
	);
	noiseMap.wrapS = noiseMap.wrapT = THREE.RepeatWrapping;
	noiseMap.colorSpace = THREE.NoColorSpace;
	const n1 = texture(noiseMap, vec2(positionWorld.x.mul(0.22), positionWorld.z.mul(0.22))).r;
	const n2 = texture(
		noiseMap,
		vec2(positionWorld.x.mul(0.9).add(0.37), positionWorld.z.mul(0.9).add(0.71))
	).r;
	const noise = clamp(n1.mul(n2).mul(2.2), 0, 1);
	// Soft rim, and the noise raggers it: the feather's threshold wanders across
	// the width, so the edge is torn rather than a clean rectangle boundary.
	const edgeSoft = smoothstep(0.45, 1.0, aMark.z.abs().add(noise.sub(0.5).mul(0.5))).oneMinus();
	// 0.55..1 — the deposit's mottle on top of the lay-time grain.
	const mottle = noise.mul(0.45).add(0.55);
	const material = new THREE.MeshStandardNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		metalness: 0,
		roughness: 0.95
	});
	material.color.setRGB(0.05, 0.05, 0.055); // albedo — the lighting owns the rest
	material.opacityNode = clamp(
		aMark.y
			.mul(1.3) // the rim and mottle thin the average — pay it back at the core
			.mul(clamp(age.div(FADE_IN), 0, 1))
			.mul(clamp(age.div(LIFETIME).oneMinus(), 0, 1))
			.mul(edgeSoft)
			.mul(mottle)
			.mul(aMark.w.mul(0.4).add(0.6)),
		0,
		1
	);

	// ── Per-wheel state, all pre-allocated ──────────────────────────────────────
	const last = new Float64Array(4 * 2); // last lay point, XZ
	const lastY = new Float64Array(4); // its height (slopes)
	const active = [false, false, false, false];
	const prevI = [0, 0, 0, 0]; // previous segment's intensity — the strip's smoothing
	const prevG = [0, 0, 0, 0]; // previous segment's grain — ditto
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
		aInt: number,
		bInt: number,
		aGrain: number,
		bGrain: number
	): void => {
		// Perpendicular to the segment in XZ, half a tyre width out — jittered per
		// segment, a hair either side of true; the soft rim masks the steps.
		let px = -(bz - az);
		let pz = bx - ax;
		const len = Math.hypot(px, pz) || 1;
		const hw = HALF_WIDTH * (0.88 + 0.24 * Math.random());
		px = (px / len) * hw;
		pz = (pz / len) * hw;

		const pOff = head * 12;
		const mOff = head * 16;
		// Four verts — aL, aR, bL, bR (the index buffer does the triangles).
		// Written straight into the ring buffer: no temp arrays in the task body.
		const p = positions;
		p[pOff] = ax - px;
		p[pOff + 1] = ay + LIFT;
		p[pOff + 2] = az - pz;
		p[pOff + 3] = ax + px;
		p[pOff + 4] = ay + LIFT;
		p[pOff + 5] = az + pz;
		p[pOff + 6] = bx - px;
		p[pOff + 7] = by + LIFT;
		p[pOff + 8] = bz - pz;
		p[pOff + 9] = bx + px;
		p[pOff + 10] = by + LIFT;
		p[pOff + 11] = bz + pz;
		// aMark per vertex [birth, intensity, edge, grain]: the a-end carries the
		// LAST segment's intensity/grain so both interpolate down the strip; a
		// tail-off segment passes bInt 0 and tapers out.
		const m = marks;
		m[mOff] = now;
		m[mOff + 4] = now;
		m[mOff + 8] = now;
		m[mOff + 12] = now;
		m[mOff + 1] = aInt;
		m[mOff + 5] = aInt;
		m[mOff + 9] = bInt;
		m[mOff + 13] = bInt;
		m[mOff + 2] = -1;
		m[mOff + 6] = 1;
		m[mOff + 10] = -1;
		m[mOff + 14] = 1;
		m[mOff + 3] = aGrain;
		m[mOff + 7] = aGrain;
		m[mOff + 11] = bGrain;
		m[mOff + 15] = bGrain;
		posAttr.addUpdateRange(pOff, 12);
		markAttr.addUpdateRange(mOff, 16);
		head = (head + 1) % TOTAL_SEGS;
	};

	const { invalidate } = useThrelte();

	useTask(
		(delta) => {
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

				// Hysteresis: enter at MARK_ON, leave at MARK_EXIT — a slide
				// hovering at the threshold must not chatter starts/tails.
				if (intensity < (active[w] ? MARK_EXIT : MARK_ON)) {
					// Tail-off: one short sliver fading to nothing where the slide
					// ended — capped at TAIL_MAX, or it reads as a ghost streak.
					const tdx = _v.x - last[w * 2];
					const tdz = _v.z - last[w * 2 + 1];
					const td = Math.hypot(tdx, tdz);
					if (active[w] && td > 0.12) {
						const k = td > TAIL_MAX ? TAIL_MAX / td : 1;
						lay(
							last[w * 2],
							lastY[w],
							last[w * 2 + 1],
							last[w * 2] + tdx * k,
							_v.y,
							last[w * 2 + 1] + tdz * k,
							prevI[w],
							0,
							prevG[w],
							Math.random()
						);
						laid = true;
					}
					active[w] = false;
					continue;
				}
				if (!active[w]) {
					active[w] = true;
					last[w * 2] = _v.x;
					last[w * 2 + 1] = _v.z;
					lastY[w] = _v.y;
					prevI[w] = 0; // the first segment tapers IN from nothing
					prevG[w] = Math.random();
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
					const g = Math.random();
					lay(lx, lastY[w], lz, _v.x, _v.y, _v.z, prevI[w], intensity, prevG[w], g);
					laid = true;
					prevI[w] = intensity;
					prevG[w] = g;
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
		noiseMap.dispose();
	});
</script>

<!-- World-anchored: the mesh never moves, the vertices are laid in world space.
     frustumCulled off — the ring buffer's bounds are meaningless, and one mesh's
     culling test is cheaper than maintaining a bounding sphere over live writes. -->
<T.Mesh
	{geometry}
	{material}
	frustumCulled={false}
	renderOrder={1}
	userData={{ hideInTree: true, selectable: false }}
/>
