<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { currentCar } from '../cars';
	import { UNITS_PER_METER } from '../units';
	import { carSim } from '../sim/carTelemetry.svelte';
	import { createPuffPool } from './puffPool';

	// The nitrous PURGE — the kit's show-off half. The controller vents the
	// line through the hood whenever the pedal is held with the spray gate
	// shut (no throttle, or N/R): sitting on the line, revving in N waiting
	// for the launch window, rolling off-throttle in gear. This component is
	// the plume — a snapping jet of cold white vapor out of the spec's
	// `purgeVents` that billows as it climbs and is gone before it lands.
	//
	// THE POOL IS ONE MESH, ONE MATERIAL, ONE DRAW CALL (fx/puffPool.ts) and
	// WORLD-ANCHORED on purpose (parented to the scene below, spawned at the
	// vent's world position): a plume hangs in the air while the car rolls
	// through it. Where the exhaust puffs are one-shot coughs, this is a
	// CONTINUOUS stream like TireSmoke — rate scaled by the smoothed purge
	// flow the controller publishes, so the column builds with the snap and
	// dies with the tail.
	//
	// LIT on purpose (MeshStandardNodeMaterial + the sphere impostor): the
	// plume catches the headlights and the pop light at night instead of
	// glowing at a fixed white after dark — the skid-marks lesson.
	//
	// The task runs `{ before: autoRenderTask }`, i.e. in the render stage
	// AFTER Rapier's synchronization: the spawn point is the pose that is
	// about to be drawn, not last frame's. Rules honored
	// (DOCS/best-practices.md §4): no allocation in the task,
	// autoInvalidate OFF with invalidate() only while puffs are alive — the
	// stream pins the render loop itself (a spawn frame always has a live
	// puff), so a parked purge animates even with the body sleeping.

	const CAR = currentCar();
	const VENT_L = new THREE.Vector3(...CAR.geometry.purgeVents[0]);
	const VENT_R = new THREE.Vector3(...CAR.geometry.purgeVents[1]);

	// ── Tuning ──────────────────────────────────────────────────────────────────
	/** Purge flow before the vent streams at all (the ~33 ms snap crosses it
	 *  in a frame or two). */
	const STREAM_ON = 0.05;
	/** Puffs/s per vent at full flow — a purge is a JET, denser than tyre
	 *  smoke's stream; two vents ≈ 32/s, and a puff lives ~0.7 s, so the pool
	 *  below is sized to hold the full column with margin. */
	const SPAWN_RATE = 16;
	/** 1/s — how fast the jet's velocity bleeds off; high, so the plume
	 *  billows where it bit instead of rocketing skyward. */
	const DRAG = 2.4;

	const { invalidate, camera, scene, autoRenderTask } = useThrelte();

	// The vent anchors — empty groups in the car's model-metre space (this
	// component mounts inside the visual group, the flames' sibling), read
	// back in WORLD space at each spawn. Pure transforms: they cost nothing
	// and keep the spec's anchors authoritative.
	const ventL = new THREE.Group();
	const ventR = new THREE.Group();
	ventL.position.copy(VENT_L);
	ventR.position.copy(VENT_R);

	// ── The pool ────────────────────────────────────────────────────────────────
	// Cold white with a blue cast — it must read N2O against the graphite
	// exhaust coughs, and it picks up the blue wash when a spray follows.
	const smokeRoot = new THREE.Group();
	smokeRoot.userData = { hideInTree: true, selectable: false };
	const pool = createPuffPool({
		count: 32,
		lit: true,
		color: [0.93, 0.96, 1.0],
		// Denser per puff than tyre smoke: a cryo jet is WET, and the stream
		// is what builds the column, not overlap alone.
		alphaPeak: 0.34,
		fadeOut: 2.0,
		roilScale: 1.8,
		roilDrift: [0.3, 0.18],
		clumpScale: 2.5,
		// The plume is watched coming apart as it climbs — erode hard, like
		// tyre smoke, not gently like the exhaust's quick coughs.
		erosion: 0.7,
		erosionSoft: 0.35,
		bulge: 0.8,
		spin: 0.9,
		onTextureLoad: () => invalidate()
	});
	smokeRoot.add(pool.mesh);

	// Scene-root parenting via effect — covers unmount AND any scene teardown.
	$effect(() => {
		scene.add(smokeRoot);
		return () => scene.remove(smokeRoot);
	});

	const _w = new THREE.Vector3();

	/** Stream one puff out of a vent — a jet up and over the nose (the vents
	 *  aim at the windshield, the classic kit's lean) plus a lagged share of
	 *  the car's own motion, so a rolling purge trails like it should. */
	function spawnVent(vent: THREE.Group, side: -1 | 1): void {
		vent.getWorldPosition(_w); // updates world matrices on the way
		const e = vent.matrixWorld.elements;
		// The matrix columns carry the visual group's uniform scale —
		// normalized to DIRECTIONS here; every magnitude below is world units.
		let ax = e[4];
		let ay = e[5];
		let az = e[6]; // local +Y — UP
		let l = Math.hypot(ax, ay, az) || 1;
		const upX = ax / l;
		const upY = ay / l;
		const upZ = az / l;
		ax = e[0] * side;
		ay = e[1] * side;
		az = e[2] * side; // local ±X — OUT to this vent's side
		l = Math.hypot(ax, ay, az) || 1;
		const outX = ax / l;
		const outY = ay / l;
		const outZ = az / l;
		ax = -e[8];
		ay = -e[9];
		az = -e[10]; // local -Z — the NOSE
		l = Math.hypot(ax, ay, az) || 1;
		const fwdX = ax / l;
		const fwdY = ay / l;
		const fwdZ = az / l;
		const jet = 3.0 + 1.4 * Math.random();
		const rise = jet * (1.5 + 0.4 * Math.random());
		// Inherit a lagged share of the car's motion (the exhaust puffs'
		// rule): at speed the plume trails, at a standstill it climbs clean.
		const v = carSim.speedMs * UNITS_PER_METER * 0.3;
		const lean = jet * 0.55 - v;
		pool.spawn(
			_w.x + (Math.random() - 0.5) * 0.15,
			_w.y,
			_w.z + (Math.random() - 0.5) * 0.15,
			upX * rise + outX * jet * 0.22 + fwdX * lean + (Math.random() - 0.5) * 0.4,
			upY * rise + outY * jet * 0.22 + fwdY * lean,
			upZ * rise + outZ * jet * 0.22 + fwdZ * lean + (Math.random() - 0.5) * 0.4,
			0.55 + 0.3 * Math.random(), // life — short: a vent, not a fire
			0.55 + 0.45 * Math.random(), // strength
			0.2 + 0.12 * Math.random(), // s0 — born small…
			1.2 + 0.9 * Math.random() // …and billows to ~1.5–2.2 world units
		);
	}

	// Per-vent spawn accumulators — the TireSmoke pattern: flow × rate × dt
	// earns fractions of the next puff, carried across frames.
	const spawnT = [0, 0];
	const vents = [ventL, ventR];
	const sides: (-1 | 1)[] = [-1, 1];

	useTask(
		(delta) => {
			const purge = carSim.nitrousPurge;
			if (purge > STREAM_ON) {
				const rate = SPAWN_RATE * purge;
				for (let i = 0; i < 2; i++) {
					spawnT[i] += delta * rate;
					if (spawnT[i] < 1) continue;
					spawnT[i] -= 1;
					spawnVent(vents[i], sides[i]);
				}
			} else {
				// Off — drop the fractions, so the first puff of the next
				// purge isn't pre-earned (a snap, not a backlog).
				spawnT[0] = 0;
				spawnT[1] = 0;
			}
			// Drift (with drag), grow, billboard, die — and own the invalidate
			// for exactly as long as something is animating.
			if (pool.update(delta, camera.current, DRAG)) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	onDestroy(() => pool.dispose());
</script>

<!-- The vent anchors — pure transforms in the car's model-metre space (nose
     -Z; this component mounts inside the visual group like the flames). -->
<T is={ventL} />
<T is={ventR} />
