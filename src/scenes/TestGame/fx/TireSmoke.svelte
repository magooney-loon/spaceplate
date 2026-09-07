<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { currentCar } from '../cars';
	import { wheelPatches } from '../cars/spec';
	import { UNITS_PER_METER } from '../units';
	import { clamp as numClamp } from '../sim/carMath';
	import { carSim } from '../sim/carTelemetry.svelte';
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

	let { target }: { target?: THREE.Object3D } = $props();

	// ── Layout (body space — the shared wheelPatches twin of SkidMarks) ────────
	const WHEELS = wheelPatches(currentCar());

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
	const SMOKE_LIFT = 0.2; // above the road plane — same reason as SkidMarks' LIFT
	const DRAG = 1.5; // 1/s — how fast a puff's lateral drift bleeds off

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
			const rearI = Math.max(spin, slide, hand, carSim.launch * 0.8, hard * 0.9, lat * 0.8);
			const frontI = Math.max(slide * 0.8, hard, lat * 0.9);

			// ── Spawn: rate scales with intensity; a wisp is one puff, a burnout
			// is a stream. Velocity = lazy rise + the lagged car motion (smoke
			// trails behind a moving car) + a small rearward roll off the tyre.
			if (body) {
				body.updateWorldMatrix(true, false);
				const e = body.matrixWorld.elements;
				const rX = e[8];
				const rZ = e[10]; // local +Z — REAR — in world
				const carV = carSim.speedMs * UNITS_PER_METER * 0.45;

				for (let w = 0; w < 4; w++) {
					const intensity = w >= 2 ? rearI : frontI;
					if (intensity < SMOKE_ON) {
						spawnT[w] = 0;
						continue;
					}
					spawnT[w] += delta * (SPAWN_BASE + SPAWN_GAIN * intensity);
					if (spawnT[w] < 1) continue;
					spawnT[w] -= 1;

					_v.set(WHEELS[w][0], 0.1 + SMOKE_LIFT, WHEELS[w][1]);
					body.localToWorld(_v);
					const roll = w >= 2 ? 0.8 + 0.8 * Math.random() : 0.3;
					pool.spawn(
						_v.x + (Math.random() - 0.5) * 0.4,
						_v.y,
						_v.z + (Math.random() - 0.5) * 0.4,
						-rX * carV + rX * roll + (Math.random() - 0.5) * 0.8,
						1.1 + 0.9 * Math.random() + 0.7 * intensity,
						-rZ * carV + rZ * roll + (Math.random() - 0.5) * 0.8,
						1.0 + 0.6 * Math.random(),
						intensity,
						0.3 + 0.3 * intensity,
						(1.5 + 1.3 * intensity) * (0.8 + 0.4 * Math.random())
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
