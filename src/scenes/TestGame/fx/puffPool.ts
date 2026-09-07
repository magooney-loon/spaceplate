// A pool of world-anchored, camera-facing smoke puffs — ONE mesh, ONE material,
// ONE draw call, shared by TireSmoke and CarExhaustFlames.
//
// WHY THIS EXISTS. Both pools used to be N `THREE.Mesh`es with N material
// INSTANCES (32 tyre puffs + 16 exhaust puffs), on the theory that identical
// node graphs share a compiled program. They do — three keys `ProgrammableStage`
// by generated WGSL source and the render pipeline by (vertex id, fragment id,
// backend state), so 48 identical graphs collapse to one pipeline
// (`three/src/renderers/common/Pipelines.js`, `getForRender`). What does NOT
// collapse is everything upstream of that:
//
//   • Each material builds its OWN node graph the first time it is rendered —
//     a full NodeBuilder analyze + WGSL generation on the main thread, per
//     material, paid at the first frame that material is visible. A burnout
//     spawns ~40 puffs/s, so 31 of those builds landed inside the first second
//     of the first slide. THAT is the hitch the boot-warm windows were built to
//     hide, and they only ever warmed ONE slot each.
//   • Each mesh is its own draw call, its own bind group and its own entry in
//     the transparent sort. A burnout plus a downshift was up to 48 extra
//     transparent draw calls against DOCS/best-practices.md §4's 100/frame.
//
// THE SHAPE. One `BufferGeometry` holding `count` quads (4 verts + 6 indices
// each) — the SkidMarks pattern, which already solves exactly this problem in
// this scene. Positions are WORLD space and written by `update()`; billboarding
// is CPU-side (the quad is built on the camera's right/up basis), which is the
// same arithmetic the old per-mesh `quaternion.copy(camera.quaternion)` did,
// minus 32 matrix compositions. Per-puff values ride a per-vertex `aPuff`
// attribute (birth, life, strength, seed) written ONCE at spawn — the aging is
// entirely shader-side against `uTime`, exactly as before.
//
// NO BOOT WARM. The mesh is permanently in the graph, so its pipeline compiles
// on the scene's first rendered frame — behind the entry veil, for free, with
// no visible-by-default slot, no timed warm window and no "physics steps race
// the renderer" caveat. Dead puffs are degenerate (all four verts at the same
// point), so an idle pool costs one draw call and zero fragments.
//
// Rules honored (DOCS/best-practices.md §4): one material shared across the
// pool, no allocation in `update()`, `NodeMaterial` + TSL only.

import * as THREE from 'three/webgpu';
import { attribute, saturate, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { perlinNoise, voronoiNoise } from './noiseTextures';

export interface PuffPoolConfig {
	/** Ring size. Oldest slot is recycled; a spawn always succeeds. */
	count: number;
	/**
	 * LIT (`MeshStandardNodeMaterial`) or unlit (`MeshBasicNodeMaterial`).
	 * Tyre smoke is lit — the skid-marks lesson: a fixed bright gray lifted by
	 * the night exposure GLOWS after dark. Exhaust puffs are unlit graphite,
	 * small and short-lived enough that the environment never reads wrong.
	 */
	lit: boolean;
	/** Linear albedo. */
	color: readonly [number, number, number];
	/** Peak alpha per puff — overlaps are what build a cloud's density. */
	alphaPeak: number;
	/** 1/s-ish shape constant on the tail: bigger = the puff clears sooner. */
	fadeOut: number;
	/** uv multiplier for the perlin roil. */
	roilScale: number;
	/** Roil crawl speed, [u, v]. */
	roilDrift: readonly [number, number];
	/** uv multiplier for the cellular clumps. */
	clumpScale: number;
	/**
	 * How far the erosion cut climbs across a puff's life, in mottle units
	 * (0..1). 0 disables it; ~0.85 leaves only the densest wisps at death.
	 * This is what makes a puff DISSOLVE instead of dimming as a disc — a
	 * uniform fade is the single biggest "that's a sticker" tell.
	 */
	erosion: number;
	/** Softness of that cut. Wider = wispier edges, narrower = crisper holes. */
	erosionSoft: number;
	/**
	 * Sphere-impostor strength for the LIT variant, 0..1. 0 leaves the quad
	 * flat-shaded (what it was); 1 shades it as a full hemisphere. See the
	 * `normalNode` block for why this matters more than anything else here.
	 * Ignored when `lit` is false.
	 */
	bulge: number;
	/** Max |spin| in rad/s. Each puff rolls at its own rate about the view axis. */
	spin: number;
	/** Called when a noise PNG lands, so the first frame after it is drawn. */
	onTextureLoad?: () => void;
}

interface Puff {
	alive: boolean;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	birth: number;
	life: number;
	/** Quad size at birth. */
	s0: number;
	/** Size added across the puff's life. */
	grow: number;
	/** Roll about the view axis at birth, rad. */
	roll: number;
	/** Roll rate, rad/s. */
	spin: number;
}

export interface PuffPool {
	/** Mount this. Permanently visible — see the header on why. */
	readonly mesh: THREE.Mesh;
	/** Pool clock, in seconds of task time. Advanced by `update()`. */
	readonly now: number;
	/**
	 * Take the next slot. `strength` is the puff's opacity scale (0..1); `life`
	 * its lifetime in seconds; `s0`/`grow` its size at birth and its growth.
	 */
	spawn(
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		life: number,
		strength: number,
		s0: number,
		grow: number
	): void;
	/**
	 * Drift (with drag), grow, billboard, die. Returns true while any puff is
	 * alive — the caller owns the `invalidate()` for that reason.
	 */
	update(delta: number, camera: THREE.Camera | undefined, drag: number): boolean;
	dispose(): void;
}

export function createPuffPool(cfg: PuffPoolConfig): PuffPool {
	const { count } = cfg;
	const verts = count * 4;

	// ── Geometry: `count` independent quads, positions in WORLD space ─────────
	const positions = new Float32Array(verts * 3); // all-zero = degenerate = free
	const uvs = new Float32Array(verts * 2);
	// [birth, life, strength, seed] per vertex — written once per spawn, then
	// the shader ages the puff against uTime with no attribute traffic at all.
	const puffData = new Float32Array(verts * 4);
	// The camera's forward axis, per vertex — the old per-mesh billboard
	// quaternion aimed the plane's +Z at the camera, which is the same thing.
	// Written for the unlit pool too: it costs 12 floats a puff and it keeps the
	// geometry's attribute set identical to the `PlaneGeometry` it replaces, so
	// nothing downstream can trip over a missing `normal`.
	const normals = new Float32Array(verts * 3);
	const indices = new Uint16Array(count * 6);
	for (let i = 0; i < count; i++) {
		const v = i * 4;
		const u = v * 2;
		uvs[u] = 0;
		uvs[u + 1] = 0;
		uvs[u + 2] = 1;
		uvs[u + 3] = 0;
		uvs[u + 4] = 0;
		uvs[u + 5] = 1;
		uvs[u + 6] = 1;
		uvs[u + 7] = 1;
		const o = i * 6;
		indices[o] = v;
		indices[o + 1] = v + 1;
		indices[o + 2] = v + 2;
		indices[o + 3] = v + 2;
		indices[o + 4] = v + 1;
		indices[o + 5] = v + 3;
	}

	const geometry = new THREE.BufferGeometry();
	const posAttr = new THREE.BufferAttribute(positions, 3);
	const puffAttr = new THREE.BufferAttribute(puffData, 4);
	geometry.setAttribute('position', posAttr);
	geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
	geometry.setAttribute('aPuff', puffAttr);
	const normalAttr = new THREE.BufferAttribute(normals, 3);
	geometry.setAttribute('normal', normalAttr);
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));

	// ── Material: one node graph for the whole pool ───────────────────────────
	const uTime = uniform(0);
	const perlinTex = perlinNoise(cfg.onTextureLoad);
	const cellularTex = voronoiNoise(cfg.onTextureLoad);
	// `any`: AttributeNode's TS generics predate the swizzle helpers, the same
	// node-graph plumbing cast SkidMarks and CarWheels make.
	const aPuff = attribute('aPuff', 'vec4') as any;

	const material = cfg.lit
		? new THREE.MeshStandardNodeMaterial({
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				metalness: 0,
				roughness: 1
			})
		: new THREE.MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide
			});
	material.color.setRGB(cfg.color[0], cfg.color[1], cfg.color[2]);

	// Age: born fast, gone before the ring recycles the quad.
	const t = uTime.sub(aPuff.x).div(aPuff.y);
	const fadeIn = saturate(t.mul(5));
	const fadeOut = saturate(t.oneMinus().mul(cfg.fadeOut));
	// Soft blob: radial falloff to nothing before the quad's corner.
	const c = uv().sub(0.5);
	const rad = c.x.mul(c.x).add(c.y.mul(c.y)).sqrt();
	const rim = smoothstep(0.18, 0.5, rad).oneMinus();
	// Roil (the puff evolves, not just fades) + cellular clumps.
	const seed = aPuff.w;
	const roilUv = uv()
		.mul(cfg.roilScale)
		.add(
			vec2(seed.add(uTime.mul(cfg.roilDrift[0])), seed.mul(2.3).sub(uTime.mul(cfg.roilDrift[1])))
		);
	const roil = texture(perlinTex, roilUv).r;
	const clumpUv = uv()
		.mul(cfg.clumpScale)
		.add(vec2(seed.mul(1.7), seed));
	const clump = texture(cellularTex, clumpUv).r;

	// The MOTTLE, 0..1 — the puff is never a clean disc. Both noises in one
	// field, because the erosion below needs a single density to cut against.
	const mottle = saturate(roil.mul(1.45)).mul(clump.mul(0.55).add(0.45));

	// EROSION — the thing that stops a puff reading as a fading sticker. The cut
	// level climbs from BELOW zero (nothing eaten at birth, so a new puff is a
	// clean soft blob) to `erosion` (only the densest mottle survives), so the
	// puff breaks into wisps and holes on its way out instead of dimming
	// uniformly. Smoke dissipates by coming apart; it does not get more
	// transparent all over at the same rate.
	//
	// `smoothstep(low, high, x)` with low < high always — reversed arguments are
	// UNDEFINED on WebGPU, not flipped (DOCS/webgpu-notes.md §1.2), and
	// `erosionSoft` is positive so the ordering holds by construction.
	const cut = t.mul(cfg.erosion + cfg.erosionSoft).sub(cfg.erosionSoft);
	const wisps = smoothstep(cut, cut.add(cfg.erosionSoft), mottle);

	material.opacityNode = aPuff.z
		.mul(cfg.alphaPeak)
		.mul(fadeIn)
		.mul(fadeOut)
		.mul(rim)
		.mul(mottle.mul(0.55).add(0.45))
		.mul(wisps);

	// THE SPHERE IMPOSTOR — the single biggest look win available here, and it is
	// nearly free. The quad was flat-shaded: one normal, constant across the
	// puff, so every puff was a uniformly-lit gray disc no matter where the sun
	// was. Faking a hemisphere's normal across the billboard gives each puff a
	// real light-to-dark gradient, which is what the eye reads as VOLUME — and it
	// means the smoke now catches the headlights and the exhaust pop light, not
	// just the sky.
	//
	// It costs a dot, a sqrt and a normalize. `normalNode` is expected in VIEW
	// space (`NodeMaterial.setupNormal()` falls back to `normalView`, and
	// `NormalMapNode` outputs view space), and the quad is CPU-billboarded to
	// face the camera — so its plane IS the view-space XY plane and the impostor
	// normal is just the uv, no basis transform needed. `bulge` flattens it:
	// a full hemisphere reads as a shiny ball, ~0.8 reads as smoke.
	if (cfg.lit && cfg.bulge > 0) {
		const d = c.mul(2); // -1..1 across the visible disc (rim dies at rad 0.5)
		const z = d.x.mul(d.x).add(d.y.mul(d.y)).oneMinus().saturate().sqrt();
		material.normalNode = vec3(d.x.mul(cfg.bulge), d.y.mul(cfg.bulge), z).normalize();
	}

	const mesh = new THREE.Mesh(geometry, material);
	// World-space verts: the bounding sphere is meaningless and the mesh never
	// moves. One culling test saved, and nothing can wrongly cull a live puff.
	mesh.frustumCulled = false;
	mesh.userData = { hideInTree: true, selectable: false };

	// ── Pool state — pre-allocated, the task body never allocates ────────────
	const puffs: Puff[] = [];
	for (let i = 0; i < count; i++) {
		puffs.push({
			alive: false,
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			birth: 0,
			life: 1,
			s0: 0.3,
			grow: 1,
			roll: 0,
			spin: 0
		});
	}
	let head = 0;
	let clock = 0;

	const collapse = (i: number): void => {
		// Four verts on one point: the two triangles have zero area, so the quad
		// costs a transform and no fragments at all.
		positions.fill(0, i * 12, i * 12 + 12);
	};

	return {
		mesh,
		get now() {
			return clock;
		},
		spawn(x, y, z, vx, vy, vz, life, strength, s0, grow) {
			const p = puffs[head];
			const base = head * 16;
			head = (head + 1) % count;
			p.alive = true;
			p.x = x;
			p.y = y;
			p.z = z;
			p.vx = vx;
			p.vy = vy;
			p.vz = vz;
			p.birth = clock;
			p.life = life;
			p.s0 = s0;
			p.grow = grow;
			// Per-puff roll about the view axis, plus a slow spin. Without this every
			// puff is billboarded with the same up vector, so all of them share one
			// noise ORIENTATION and the repetition is obvious in a cloud — the eye
			// picks out the identical grain long before it picks out the shape.
			p.roll = Math.random() * Math.PI * 2;
			p.spin = (Math.random() - 0.5) * 2 * cfg.spin;
			const seedValue = Math.random();
			for (let v = 0; v < 4; v++) {
				const o = base + v * 4;
				puffData[o] = clock;
				puffData[o + 1] = life;
				puffData[o + 2] = strength;
				puffData[o + 3] = seedValue;
			}
			puffAttr.needsUpdate = true;
		},
		update(delta, camera, drag) {
			clock += delta;
			uTime.value = clock;
			if (!camera) return false;

			// The camera's world basis — the billboard frame, read once for the
			// whole pool instead of once per puff. `updateWorldMatrix` first: the
			// rig writes position/quaternion in the MAIN stage, and `matrixWorld`
			// is only recomposed during the render itself, so reading it raw here
			// would billboard every puff against LAST frame's camera.
			camera.updateWorldMatrix(true, false);
			const e = camera.matrixWorld.elements;
			const rx = e[0];
			const ry = e[1];
			const rz = e[2];
			const ux = e[4];
			const uy = e[5];
			const uz = e[6];

			const decay = Math.exp(-drag * delta);
			let alive = false;
			let dirty = false;
			for (let i = 0; i < count; i++) {
				const p = puffs[i];
				if (!p.alive) continue;
				dirty = true;
				const age = (clock - p.birth) / p.life;
				if (age >= 1) {
					p.alive = false;
					collapse(i);
					continue;
				}
				alive = true;
				p.vx *= decay;
				p.vz *= decay;
				p.x += p.vx * delta;
				p.y += p.vy * delta;
				p.z += p.vz * delta;

				// Growth EASES OUT: a puff billows fast out of the contact patch and
				// then loafs. Linear growth reads mechanical, because real smoke does
				// most of its expanding in the first fraction of its life.
				const eased = age * (2 - age);
				// Half-extent along the camera's right/up axes, ROLLED by this puff's
				// own angle. The old pool scaled a PlaneGeometry(1, 1) by
				// (s0 + grow·age), so the half-extent is half it.
				const h = (p.s0 + p.grow * eased) * 0.5;
				const ang = p.roll + p.spin * (clock - p.birth);
				const ca = Math.cos(ang) * h;
				const sa = Math.sin(ang) * h;
				const ax = rx * ca + ux * sa;
				const ay = ry * ca + uy * sa;
				const az = rz * ca + uz * sa;
				const bx = ux * ca - rx * sa;
				const by = uy * ca - ry * sa;
				const bz = uz * ca - rz * sa;
				const o = i * 12;
				positions[o] = p.x - ax - bx;
				positions[o + 1] = p.y - ay - by;
				positions[o + 2] = p.z - az - bz;
				positions[o + 3] = p.x + ax - bx;
				positions[o + 4] = p.y + ay - by;
				positions[o + 5] = p.z + az - bz;
				positions[o + 6] = p.x - ax + bx;
				positions[o + 7] = p.y - ay + by;
				positions[o + 8] = p.z - az + bz;
				positions[o + 9] = p.x + ax + bx;
				positions[o + 10] = p.y + ay + by;
				positions[o + 11] = p.z + az + bz;
				// Camera +Z, i.e. straight back at the viewer.
				for (let v = 0; v < 4; v++) {
					normals[o + v * 3] = e[8];
					normals[o + v * 3 + 1] = e[9];
					normals[o + v * 3 + 2] = e[10];
				}
			}
			if (dirty) {
				posAttr.needsUpdate = true;
				normalAttr.needsUpdate = true;
			}
			return alive;
		},
		dispose() {
			geometry.dispose();
			material.dispose();
			// The noise textures are SHARED and deliberately not disposed here —
			// see noiseTextures.ts.
		}
	};
}
