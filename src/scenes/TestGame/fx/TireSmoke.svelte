<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { currentCar } from '../cars';
	import { wheelPatches } from '../cars/spec';
	import { UNITS_PER_METER } from '../units';
	import { clamp as numClamp } from '../sim/carMath';
	import { carSim } from '../sim/carTelemetry.svelte';
	import type { Suspension } from '../sim/suspension';
	import { createPuffPool } from './puffPool';

	// Tyre smoke — the squeal made visible. Where the exhaust puffs (in
	// CarExhaustFlames) are one-shot coughs, this is a CONTINUOUS stream: while
	// a wheel slides, puffs spawn at its contact patch at a rate scaled by the
	// slide's intensity, so a burnout builds a proper cloud and a brief squeak
	// is a wisp. The intensity is the squeal/marks driver's TWIN (carAudio.ts /
	// SkidMarks.svelte — loosest source wins, never a sum), here with ALL SIX
	// sources including cornering load (max banking sings hot enough to smoke a
	// little): rears get wheelspin/slide/handbrake/launch/brake/cornering,
	// fronts slide/brake/cornering — an RWD car smokes from the back.
	//
	// LIT, not unlit (the skid-marks lesson): near-white albedo on a
	// MeshStandardNodeMaterial, so the smoke is bright gray against day asphalt
	// and dims with the environment at night instead of glowing.
	//
	// THE POOL IS ONE MESH, ONE MATERIAL, ONE DRAW CALL — see fx/puffPool.ts for
	// why (it replaced 32 meshes with 32 material instances, which cost 32
	// separate first-render shader builds and up to 32 transparent draw calls,
	// and needed a boot-warm hack that only ever warmed one of them). Nothing
	// here has to warm anything any more: the pool's mesh is permanently in the
	// graph, so its one pipeline compiles on the scene's first rendered frame.
	//
	// The task runs `{ before: autoRenderTask }`, i.e. in the render stage AFTER
	// Rapier's synchronization: the spawn point is the pose that is about to be
	// drawn, not last frame's. Rules honored (DOCS/best-practices.md §4): no
	// allocation in the task body, autoInvalidate OFF with invalidate() only
	// while puffs are alive.

	let { target, suspension }: { target?: THREE.Object3D; suspension: Suspension } = $props();

	// ── Layout (body space — the shared wheelPatches twin of SkidMarks) ──────
	const WHEELS = wheelPatches(currentCar());
	// How far outboard of the wheel's own centreline a puff is born: half the
	// tyre's width (the same measured number SkidMarks' ribbon uses) plus a
	// little for the fender lip. A puff spawned ON the centreline starts inside
	// the tyre/fender's own depth, so the bodywork's opaque geometry clipped the
	// growing quad in a hard flat line instead of a soft cloud edge — this plus
	// the matching outward kick on spawn velocity (below) is what gets it clear
	// of the car at birth instead of relying on drift to escape it.
	const SMOKE_OUTBOARD = currentCar().geometry.tyreHalfWidth * UNITS_PER_METER + 0.15;

	// ── Tuning ──────────────────────────────────────────────────────────────────
	const SMOKE_ON = 0.45; // slide intensity before a wheel smokes at all
	const SPAWN_BASE = 2; // puffs/s per wheel at the threshold
	const SPAWN_GAIN = 8; // extra puffs/s at full intensity (burnout ≈ 10/s/wheel)
	// THE POOL WAS STARVING THE CLOUD. At full intensity the spawn rate is 10/s
	// per wheel and a puff lives ~1.3 s, so a two-wheel burnout wants ~26 alive
	// and a four-wheel slide (rears spinning, fronts braking) wants ~52 — against
	// a pool of 32, which recycled live puffs early and capped the cloud at a
	// permanent thinness no shader change could fix. 32 was a sensible number
	// when each puff was its own draw call; it is not one now that the whole pool
	// is a single draw (fx/puffPool.ts). The remaining cost of raising it is FILL
	// RATE — overlapping alpha-blended quads — which is why it is 64 and not 200,
	// and why `alphaPeak` came down as the overlap went up.
	const POOL = 64;
	// Above the road plane — same reason as SkidMarks' LAY_Y. Like it, this is the
	// height on flat ground at rest; each wheel adds its ray's ground offset.
	const SMOKE_LIFT = 0.2;
	const DRAG = 1.5; // 1/s — how fast a puff's lateral drift bleeds off
	// HEAT — a burnout's cloud should keep GROWING the longer it holds, not just
	// stream at a constant size the moment it crosses SMOKE_ON. Per wheel, 0..1:
	// climbs while that wheel is actively smoking, falls back once it stops, and
	// scales the SIZE of newly spawned puffs (below) — never the spawn rate or
	// lifetime, both of which are already tuned close to the pool's ceiling (see
	// the POOL comment above); a bigger puff costs fill rate, not ring slots, so
	// it cannot cause the early-recycle popping raising either of those would.
	const HEAT_UP = 1 / 4; // 1/s — ~4s of holding a slide to fully build up
	const HEAT_DOWN = 1 / 1.5; // 1/s — cools back down faster than it built

	const { invalidate, camera, autoRenderTask } = useThrelte();

	const pool = createPuffPool({
		count: POOL,
		lit: true,
		color: [0.78, 0.78, 0.8], // rubber smoke is white-gray
		alphaPeak: 0.24, // per puff — overlaps build the cloud's density
		fadeOut: 1.4,
		roilScale: 1.5,
		roilDrift: [0.2, 0.12],
		clumpScale: 2.2,
		// Tyre smoke lives long enough to be watched coming apart, so it erodes
		// hard; the exhaust's quick coughs erode gently.
		erosion: 0.85,
		erosionSoft: 0.3,
		// The sphere impostor — what turns a flat gray disc into something with a
		// lit side and a shadow side, and what makes the smoke catch the
		// headlights and the exhaust pop light instead of only the sky. Under 1
		// on purpose: a full hemisphere reads as a ball.
		bulge: 0.8,
		spin: 0.5, // rad/s — a lazy roll, not a pinwheel
		onTextureLoad: () => invalidate()
	});

	// Per-wheel spawn accumulators — how much of the next puff each wheel has earned.
	const spawnT = [0, 0, 0, 0];
	// Per-wheel HEAT — see HEAT_UP/HEAT_DOWN above.
	const heat = [0, 0, 0, 0];
	const _v = new THREE.Vector3();

	useTask(
		(delta) => {
			const body = target?.parent;

			// ── Intensity: the squeal/marks twin, cornering load included ────────
			const speed = Math.abs(carSim.speedMs);
			const spin = numClamp((carSim.slip - 0.15) / 0.35, 0, 1);
			const slide =
				numClamp((Math.abs(carSim.drift) - 0.1396) / 0.2967, 0, 1) * numClamp(speed / 4, 0, 1);
			const hand = carSim.handbrake ? 0.8 * numClamp(speed / 10, 0, 1) : 0;
			const hard = carSim.brake * numClamp(speed / 6, 0, 1);
			const lat = numClamp(carSim.latLoad, 0, 1);
			// × ground contact — a tyre in the air has nothing to smoke against.
			const rearI =
				Math.max(spin, slide, hand, carSim.launch * 0.8, hard * 0.9, lat * 0.8) *
				carSim.contactRear;
			const frontI = Math.max(slide * 0.8, hard, lat * 0.9) * carSim.contactFront;

			// ── Spawn: rate scales with intensity; a wisp is one puff, a burnout
			// is a stream. Velocity = lazy rise + the lagged car motion (smoke
			// trails behind a moving car) + a small rearward roll off the tyre +
			// an outward kick that (with SMOKE_OUTBOARD above) carries the puff
			// clear of the fender instead of into it.
			if (body) {
				body.updateWorldMatrix(true, false);
				const e = body.matrixWorld.elements;
				const rX = e[8];
				const rZ = e[10]; // local +Z — REAR — in world
				const oX = e[0];
				const oZ = e[2]; // local +X — LEFT — in world (spec.ts: "+X left")
				const carV = carSim.speedMs * UNITS_PER_METER * 0.45;

				for (let w = 0; w < 4; w++) {
					// Per wheel: a tyre whose ray found nothing smokes nothing.
					const intensity = suspension.grounded[w] ? (w >= 2 ? rearI : frontI) : 0;
					if (intensity < SMOKE_ON) {
						spawnT[w] = 0;
						heat[w] = Math.max(0, heat[w] - delta * HEAT_DOWN);
						continue;
					}
					heat[w] = Math.min(1, heat[w] + delta * HEAT_UP);
					spawnT[w] += delta * (SPAWN_BASE + SPAWN_GAIN * intensity);
					if (spawnT[w] < 1) continue;
					spawnT[w] -= 1;

					const ground = suspension.groundY(w) - suspension.restGroundY;
					// +1 on the left wheels (WHEELS[w][0] > 0), -1 on the right — which
					// way is outboard, clear of the fender.
					const side = WHEELS[w][0] > 0 ? 1 : -1;
					_v.set(WHEELS[w][0] + side * SMOKE_OUTBOARD, 0.1 + SMOKE_LIFT + ground, WHEELS[w][1]);
					body.localToWorld(_v);
					const roll = w >= 2 ? 0.8 + 0.8 * Math.random() : 0.3;
					// The same idea as `roll` — a spinning tyre flings smoke off its own
					// rotation — but OUTWARD rather than rearward: a rolling tyre throws
					// smoke off its whole radius, not just backward off its tread. This is
					// what actually carries a puff clear of the fender rather than just
					// starting there and drifting back into it.
					const kick = (w >= 2 ? 0.7 : 0.4) * (0.7 + 0.6 * Math.random());
					const heatK = heat[w];
					pool.spawn(
						_v.x + (Math.random() - 0.5) * 0.4,
						_v.y,
						_v.z + (Math.random() - 0.5) * 0.4,
						-rX * carV + rX * roll + side * oX * kick + (Math.random() - 0.5) * 0.8,
						1.1 + 0.9 * Math.random() + 0.7 * intensity,
						-rZ * carV + rZ * roll + side * oZ * kick + (Math.random() - 0.5) * 0.8,
						1.0 + 0.6 * Math.random(),
						intensity,
						// SIZE builds with heat — a burnout's cloud thickens the longer it
						// holds instead of streaming at one constant puff size.
						0.3 + 0.3 * intensity + 0.35 * heatK,
						(1.5 + 1.3 * intensity) * (0.8 + 0.4 * Math.random()) * (1 + 0.6 * heatK)
					);
				}
			}

			// Drift (with drag), grow, billboard, die — and own the invalidate for
			// exactly as long as something is animating.
			if (pool.update(delta, camera.current, DRAG)) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	onDestroy(() => pool.dispose());
</script>

<!-- World-anchored (mounted at TestGame root, NOT in the car): smoke hangs in
     the air while the car drives away. One mesh, one draw call — the pool owns
     its own geometry, and dead puffs are degenerate rather than hidden. -->
<T is={pool.mesh} />
