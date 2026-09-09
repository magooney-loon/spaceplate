// A pool of world-anchored, velocity-STREAKED sparks — ONE mesh, ONE material,
// ONE draw call. The `fx/puffPool.ts` primitive's hot sibling, and it follows
// exactly the same rules for exactly the same reasons (read that header first):
// `count` quads in one BufferGeometry, positions written in WORLD space by
// `update()`, per-puff values on a per-vertex attribute written ONCE at spawn
// and aged shader-side against `uTime`, dead slots collapsed to a point so they
// cost a vertex transform and zero fragments. One material means one node-graph
// build, on the scene's first rendered frame, behind the entry veil — a spark
// burst is the worst possible moment to discover a NodeBuilder analyze.
//
// WHAT IS DIFFERENT FROM A PUFF, and why this is its own primitive rather than
// a puffPool config:
//
//   • A puff is BILLBOARDED — a camera-facing disc. A spark is a STREAK: the
//     quad is built on the spark's own velocity axis, rolled about that axis to
//     face the camera, and stretched along it in proportion to speed. That is
//     the motion smear a real spark leaves on a camera sensor and on the eye,
//     and it is most of what separates "sparks" from "orange dots".
//   • A puff DIMS what is behind it; a spark is white-hot metal and ADDS. So:
//     `MeshBasicNodeMaterial` + AdditiveBlending, unlit — the skid-marks "always
//     light it" lesson does not apply to something that is itself the emitter,
//     and a lit spark would be dimmed by the night exposure exactly when it
//     should read brightest.
//   • Sparks COOL. The colour ramp is driven by age AND by position along the
//     streak (the head is the particle, the tail is where it was), so a spark
//     goes white → yellow → orange → dull red on its way out instead of just
//     fading. Plus a hard SPUTTER — real sparks tumble and blink out — which is
//     a `step()` on a per-spark hash, not a fade.
//
// No noise textures: a spark is smaller than one texel of the perlin PNG at any
// sane sampling rate, so the mottle that makes smoke work would be invisible
// here. The variety comes from the per-spark seed instead.

import * as THREE from 'three/webgpu';
import {
	attribute,
	float,
	fract,
	mix,
	saturate,
	sin,
	step,
	uniform,
	uv,
	vec3,
	vec4
} from 'three/tsl';

export interface SparkPoolConfig {
	/** Ring size. Oldest slot is recycled; a spawn always succeeds. */
	count: number;
	/** Peak additive brightness at full heat. */
	brightness: number;
	/** World units/s² pulled down. The world's own gravity is 9.8 units/s². */
	gravity: number;
	/** 1/s — how fast a spark's velocity bleeds off (air, and it is tiny). */
	drag: number;
	/**
	 * SECONDS of motion smeared into the streak: half-length grows by
	 * `streak × speed × 0.5`. This is a shutter time, so it is small — 0.02 is
	 * a 20 ms exposure and already a long dash at 40 units/s.
	 */
	streak: number;
	/** Base half-width of a streak in world units, scaled per spark. */
	width: number;
	/** rad/s-ish — brightness flicker rate. */
	flicker: number;
	/** Hz-ish — rate of the hard on/off sputter. */
	sputter: number;
}

interface Spark {
	alive: boolean;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	birth: number;
	life: number;
	/** Width/length scale of this spark's quad. */
	scale: number;
}

/** An oriented box alive sparks bounce off — `fx/CarImpacts.svelte` feeds
 *  the car's hull bounds at the body's live pose so debris fired back into the
 *  chassis RICOCHETS off the skin instead of streaking through the paint.
 *  Position + rotation locate the volume in world space; the centre and half
 *  extents describe the box in the volume's own (rotated) frame. */
export interface SparkBounceVolume {
	x: number;
	y: number;
	z: number;
	qx: number;
	qy: number;
	qz: number;
	qw: number;
	cx: number;
	cy: number;
	cz: number;
	hx: number;
	hy: number;
	hz: number;
}

export interface SparkPool {
	/** Mount this. Permanently visible — see the header on why. */
	readonly mesh: THREE.Mesh;
	/**
	 * Take the next slot. `heat` is 0..1 (brightness and how white it starts),
	 * `life` seconds, `scale` a multiplier on the streak's width.
	 */
	spawn(
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		life: number,
		heat: number,
		scale: number
	): void;
	/**
	 * Ballistics, streak-build, die. Returns true while any spark is alive — the
	 * caller owns the `invalidate()` for that reason. `bounce`, when given, is
	 * an oriented box sparks reflect off (see `SparkBounceVolume`).
	 */
	update(delta: number, camera: THREE.Camera | undefined, bounce?: SparkBounceVolume): boolean;
	dispose(): void;
}

/** Dull red — a spark at the end of its life. */
const EMBER_COOL: readonly [number, number, number] = [0.85, 0.13, 0.02];
/** Orange — the middle of the ramp. */
const EMBER_WARM: readonly [number, number, number] = [1, 0.52, 0.08];
/** White-hot with a yellow bias — freshly torn metal. */
const EMBER_HOT: readonly [number, number, number] = [1, 0.97, 0.85];

// ── Bounce tuning ──────────────────────────────────────────────────────────
/** Restitution off the bounce volume — hot grit doesn't rebound like a ball. */
const BOUNCE_REST = 0.35;
/** Tangential speed a striking spark KEEPS — a ricochet scrubs on contact. */
const BOUNCE_SCRUB = 0.75;
/** Push-out clearance past the face, so a bounced spark isn't re-penetrated by
 *  the very step that threw it out. */
const BOUNCE_SKIN = 0.02;

/** Quaternion rotation result — a hoisted out-param so the per-spark bounce
 *  path allocates nothing. Read it IMMEDIATELY after each `rotateBy`. */
const _rot = { x: 0, y: 0, z: 0 };

/** v + 2w(u×v) + 2u×(u×v) — the expanded quaternion rotation three's own
 *  `Vector3.applyQuaternion` evaluates. Written out because it runs per spark
 *  per frame and the pool's maths is otherwise all inline. */
function rotateBy(
	x: number,
	y: number,
	z: number,
	qx: number,
	qy: number,
	qz: number,
	qw: number
): void {
	const cx = 2 * (qy * z - qz * y);
	const cy = 2 * (qz * x - qx * z);
	const cz = 2 * (qx * y - qy * x);
	_rot.x = x + qw * cx + (qy * cz - qz * cy);
	_rot.y = y + qw * cy + (qz * cx - qx * cz);
	_rot.z = z + qw * cz + (qx * cy - qy * cx);
}

export function createSparkPool(cfg: SparkPoolConfig): SparkPool {
	const { count } = cfg;
	const verts = count * 4;

	// ── Geometry: `count` independent quads, positions in WORLD space ─────────
	const positions = new Float32Array(verts * 3); // all-zero = degenerate = free
	const uvs = new Float32Array(verts * 2);
	// [birth, life, heat, seed] per vertex — written once per spawn.
	const sparkData = new Float32Array(verts * 4);
	const indices = new Uint16Array(count * 6);
	for (let i = 0; i < count; i++) {
		const v = i * 4;
		const u = v * 2;
		// v = 0 is the TAIL edge, v = 1 the HEAD — the colour ramp reads uv.y.
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
	const sparkAttr = new THREE.BufferAttribute(sparkData, 4);
	geometry.setAttribute('position', posAttr);
	geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
	geometry.setAttribute('aSpark', sparkAttr);
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));

	// ── Material: one node graph for the whole pool ───────────────────────────
	const uTime = uniform(0);
	// `any`: AttributeNode's TS generics predate the swizzle helpers — the same
	// node-graph plumbing cast puffPool, SkidMarks and CarWheels all make.
	const aSpark = attribute('aSpark', 'vec4') as any;

	const material = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	});

	const t = uTime.sub(aSpark.x).div(aSpark.y);
	// `float()` is not decoration: aSpark is `any`, and `mul(any)` resolves to the
	// FIRST mul overload on a float node — the colour special case,
	// `(Node<"color">) => Node<"vec3">` — which would turn the whole opacity
	// chain vec3 and fail the vec4(vec3, Scalar) overload below. puffPool never
	// trips this because its `any` is only ever the RECEIVER of the chain.
	const heat = float(aSpark.z);
	const seed = aSpark.w;
	// 0 at the tail (where the spark was) → 1 at the head (where it is).
	const along = uv().y;
	// 0 down the streak's spine → 1 at its edge.
	const across = uv().x.sub(0.5).abs().mul(2);

	// Cross-section: a soft round core rather than a hard-edged ribbon.
	const spine = across.oneMinus().pow(1.6);
	// The tail is thin and dim — it is a smear of the past, not more particle.
	const trail = mix(float(0.1), float(1), along.pow(1.8));

	// COOLING. Age dims it and the head runs hotter than the tail, which is what
	// gives a streak its direction without any extra geometry.
	const hot = saturate(heat.mul(t.oneMinus().pow(0.7)).mul(mix(float(0.4), float(1.15), along)));
	const color = mix(
		mix(vec3(...EMBER_COOL), vec3(...EMBER_WARM), saturate(hot.mul(2))),
		vec3(...EMBER_HOT),
		saturate(hot.sub(0.55).mul(2.2))
	);

	// SPUTTER + flicker. The flicker is a smooth brightness wobble; the sputter is
	// a HARD cut, because a tumbling spark genuinely disappears and comes back —
	// a spark field that only fades reads as embers, not as grinding metal. Both
	// are per-spark (the seed), so the pool never pulses as one.
	const flicker = mix(
		float(0.55),
		float(1),
		sin(uTime.mul(cfg.flicker).add(seed.mul(41)))
			.mul(0.5)
			.add(0.5)
	);
	const sputter = step(0.16, fract(seed.mul(17.3).add(uTime.mul(cfg.sputter))));

	// Instant on, quick out. `t` past 1 drives this to 0 on its own, so a slot
	// that update() has not collapsed yet still draws nothing.
	const envelope = saturate(t.mul(60)).mul(saturate(t.oneMinus().mul(3)));

	material.colorNode = vec4(
		color,
		spine.mul(trail).mul(envelope).mul(flicker).mul(sputter).mul(heat).mul(cfg.brightness)
	);

	const mesh = new THREE.Mesh(geometry, material);
	// World-space verts: the bounding sphere is meaningless and the mesh never
	// moves. One culling test saved, and nothing can wrongly cull a live spark.
	mesh.frustumCulled = false;
	mesh.userData = { hideInTree: true, selectable: false };
	// Sparks are the hottest thing in the scene and they are tiny — draw them
	// after the smoke pools so a puff spawned in the same burst cannot sort in
	// front of the flash that made it.
	mesh.renderOrder = 2;

	// ── Pool state — pre-allocated, the task body never allocates ────────────
	const sparks: Spark[] = [];
	for (let i = 0; i < count; i++) {
		sparks.push({
			alive: false,
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			birth: 0,
			life: 1,
			scale: 1
		});
	}
	let head = 0;
	let clock = 0;

	const collapse = (i: number): void => {
		positions.fill(0, i * 12, i * 12 + 12);
	};

	return {
		mesh,
		spawn(x, y, z, vx, vy, vz, life, heat, scale) {
			const s = sparks[head];
			const base = head * 16;
			head = (head + 1) % count;
			s.alive = true;
			s.x = x;
			s.y = y;
			s.z = z;
			s.vx = vx;
			s.vy = vy;
			s.vz = vz;
			s.birth = clock;
			s.life = life;
			s.scale = scale;
			const seedValue = Math.random();
			for (let v = 0; v < 4; v++) {
				const o = base + v * 4;
				sparkData[o] = clock;
				sparkData[o + 1] = life;
				sparkData[o + 2] = heat;
				sparkData[o + 3] = seedValue;
			}
			sparkAttr.needsUpdate = true;
		},
		update(delta, camera, bounce) {
			clock += delta;
			uTime.value = clock;
			if (!camera) return false;

			// `updateWorldMatrix` first, for puffPool's reason: the chase rig writes
			// the camera's position in the MAIN stage and `matrixWorld` is only
			// recomposed during the render itself, so reading it raw here would
			// build every streak against LAST frame's camera.
			camera.updateWorldMatrix(true, false);
			const e = camera.matrixWorld.elements;
			// The camera's own right vector — the fallback roll axis for a spark
			// flying straight at (or away from) the viewer, where "roll the quad
			// about the velocity to face the camera" has no answer.
			const camRx = e[0];
			const camRy = e[1];
			const camRz = e[2];
			const camX = e[12];
			const camY = e[13];
			const camZ = e[14];

			const decay = Math.exp(-cfg.drag * delta);
			// The bounce volume's frame, resolved once per call rather than per
			// spark: the frame's pose, plus the INVERSE rotation (a unit
			// quaternion's conjugate) for world→local. Local→world reuses the pose.
			let boxX = 0;
			let boxY = 0;
			let boxZ = 0;
			let cqx = 0;
			let cqy = 0;
			let cqz = 0;
			let cqw = 1;
			let fqx = 0;
			let fqy = 0;
			let fqz = 0;
			let fqw = 1;
			let bcx = 0;
			let bcy = 0;
			let bcz = 0;
			let bhx = 0;
			let bhy = 0;
			let bhz = 0;
			if (bounce) {
				boxX = bounce.x;
				boxY = bounce.y;
				boxZ = bounce.z;
				cqx = -bounce.qx;
				cqy = -bounce.qy;
				cqz = -bounce.qz;
				cqw = bounce.qw;
				fqx = bounce.qx;
				fqy = bounce.qy;
				fqz = bounce.qz;
				fqw = bounce.qw;
				bcx = bounce.cx;
				bcy = bounce.cy;
				bcz = bounce.cz;
				bhx = bounce.hx;
				bhy = bounce.hy;
				bhz = bounce.hz;
			}
			let alive = false;
			let dirty = false;
			for (let i = 0; i < count; i++) {
				const s = sparks[i];
				if (!s.alive) continue;
				dirty = true;
				if (clock - s.birth >= s.life) {
					s.alive = false;
					collapse(i);
					continue;
				}
				alive = true;
				s.vx *= decay;
				s.vy *= decay;
				s.vz *= decay;
				s.vy -= cfg.gravity * delta;
				s.x += s.vx * delta;
				s.y += s.vy * delta;
				s.z += s.vz * delta;

				// ── The car (or whatever volume) ────────────────────────────────
				// A spark that ends up INSIDE the box is pushed out through the
				// nearest face and, when its velocity still drives inward there,
				// reflected (restitution on the axis, scrub on the rest) — a
				// ricochet, not a pass-through. One that is already leaving is
				// only repositioned, so it is never double-flipped.
				if (bounce) {
					rotateBy(s.x - boxX, s.y - boxY, s.z - boxZ, cqx, cqy, cqz, cqw);
					let lx = _rot.x;
					let ly = _rot.y;
					let lz = _rot.z;
					const ox = lx - bcx;
					const oy = ly - bcy;
					const oz = lz - bcz;
					// Penetration per axis — all three positive means inside the box.
					const px = bhx - Math.abs(ox);
					const py = bhy - Math.abs(oy);
					const pz = bhz - Math.abs(oz);
					if (px > 0 && py > 0 && pz > 0) {
						// Out through the NEAREST face — the shallowest axis.
						const axis: 0 | 1 | 2 = px <= py && px <= pz ? 0 : py <= pz ? 1 : 2;
						const sign =
							axis === 0 ? (ox < 0 ? -1 : 1) : axis === 1 ? (oy < 0 ? -1 : 1) : oz < 0 ? -1 : 1;
						rotateBy(s.vx, s.vy, s.vz, cqx, cqy, cqz, cqw);
						const wx = _rot.x;
						const wy = _rot.y;
						const wz = _rot.z;
						const along = axis === 0 ? wx : axis === 1 ? wy : wz;
						const outSpeed = along * sign < 0 ? -along * BOUNCE_REST : along;
						let bvx: number;
						let bvy: number;
						let bvz: number;
						if (axis === 0) {
							lx = bcx + sign * (bhx + BOUNCE_SKIN);
							bvx = outSpeed;
							bvy = wy * BOUNCE_SCRUB;
							bvz = wz * BOUNCE_SCRUB;
						} else if (axis === 1) {
							ly = bcy + sign * (bhy + BOUNCE_SKIN);
							bvx = wx * BOUNCE_SCRUB;
							bvy = outSpeed;
							bvz = wz * BOUNCE_SCRUB;
						} else {
							lz = bcz + sign * (bhz + BOUNCE_SKIN);
							bvx = wx * BOUNCE_SCRUB;
							bvy = wy * BOUNCE_SCRUB;
							bvz = outSpeed;
						}
						rotateBy(bvx, bvy, bvz, fqx, fqy, fqz, fqw);
						s.vx = _rot.x;
						s.vy = _rot.y;
						s.vz = _rot.z;
						rotateBy(lx, ly, lz, fqx, fqy, fqz, fqw);
						s.x = boxX + _rot.x;
						s.y = boxY + _rot.y;
						s.z = boxZ + _rot.z;
					}
				}

				// ── The streak frame ────────────────────────────────────────────
				// dir  = the spark's own velocity (the streak's axis)
				// side = dir × toCamera, i.e. the quad rolled about its axis until
				//        it faces the viewer. This is a CYLINDRICAL billboard, not
				//        the puff's spherical one: the axis is physical and must
				//        not be turned by the camera, only rolled about.
				const speed = Math.hypot(s.vx, s.vy, s.vz);
				let dx: number;
				let dy: number;
				let dz: number;
				if (speed > 1e-4) {
					dx = s.vx / speed;
					dy = s.vy / speed;
					dz = s.vz / speed;
				} else {
					dx = camRx;
					dy = camRy;
					dz = camRz;
				}
				const tx = camX - s.x;
				const ty = camY - s.y;
				const tz = camZ - s.z;
				let sx = dy * tz - dz * ty;
				let sy = dz * tx - dx * tz;
				let sz = dx * ty - dy * tx;
				const sl = Math.hypot(sx, sy, sz);
				if (sl > 1e-4) {
					sx /= sl;
					sy /= sl;
					sz /= sl;
				} else {
					// Dead-on: any perpendicular will do, and the camera's right is
					// the one that keeps the streak stable as the view swings past.
					sx = camRx;
					sy = camRy;
					sz = camRz;
				}

				const halfW = cfg.width * s.scale;
				// Motion smear: a shutter time's worth of travel, with the width as
				// a floor so a nearly-stopped spark is still a dot and not nothing.
				const halfL = halfW + cfg.streak * speed * 0.5;
				const ax = dx * halfL;
				const ay = dy * halfL;
				const az = dz * halfL;
				const bx = sx * halfW;
				const by = sy * halfW;
				const bz = sz * halfW;
				const o = i * 12;
				// Tail edge (uv.y = 0) behind the particle, head edge at it.
				positions[o] = s.x - ax - bx;
				positions[o + 1] = s.y - ay - by;
				positions[o + 2] = s.z - az - bz;
				positions[o + 3] = s.x - ax + bx;
				positions[o + 4] = s.y - ay + by;
				positions[o + 5] = s.z - az + bz;
				positions[o + 6] = s.x + ax - bx;
				positions[o + 7] = s.y + ay - by;
				positions[o + 8] = s.z + az - bz;
				positions[o + 9] = s.x + ax + bx;
				positions[o + 10] = s.y + ay + by;
				positions[o + 11] = s.z + az + bz;
			}
			if (dirty) posAttr.needsUpdate = true;
			return alive;
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}
