<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { usePhysicsTask } from '@threlte/rapier';
	import { carSim } from '../sim/carTelemetry.svelte';
	import { HULL_HIT_FULL_DV } from '../sim/hullContacts';
	import { UNITS_PER_METER } from '../units';
	import { clamp } from '../sim/carMath';
	import { createSparkPool } from './sparkPool';
	import { createPuffPool } from './puffPool';

	// Impact FX — what the chassis hull hitting the world looks like. Two effects
	// off one signal:
	//
	//   SCRATCH — the car is pressed against something and SLIDING along it, so
	//             the contact patch grinds: a continuous stream of hot streaks
	//             trailing off the scrape point, rate scaled by how fast it's
	//             sliding. Barrier scrapes, kerbing, bellying out over a lip.
	//   HIT     — the car ARRIVED at something: an impulse spike, which throws a
	//             wide burst of sparks off the contact plus a short cough of dust.
	//
	// ── THIS READS THE ALREADY-DETECTED SIGNAL, NOT RAPIER DIRECTLY ────────────
	//
	// This component used to poll `world.contactPairsWith`/`contactPair` itself,
	// which is also where it inherited a real bug: it read `numSolverContacts()`
	// / `solverContactPoint(i)` / `contactImpulse(i)`, and those are NEVER
	// populated for the chassis's `roundConvexHull` against the track's
	// `trimesh` colliders (verified against the installed rapier3d-compat) — so
	// it only ever fired on the FLOOR (an analytic `cuboid`, a shape pair Rapier
	// does support) and never on a fence or wall. `sim/hullContacts.ts` now owns
	// the one correct reading of the narrow phase (its header has the full
	// story and the fix: `numContacts()`/`contactDist(i)`/`localContactPoint1/2`
	// instead, with "how hard" derived from the car's own tracked velocity
	// rather than the solver's absent impulse) and publishes it once per
	// physics step onto `carSim.hullContact*`. This component is now purely a
	// CONSUMER of that signal — no Rapier imports, no manifold walking — so the
	// fix lives in exactly one place and the debug rig and this effect can
	// never again disagree about what counts as a hit.
	//
	// `carSim.hullHitSeq` is what a HIT is keyed off: it increments once per
	// real rising-edge arrival in `hullContacts.ts`, which is the one-shot
	// signal this needs — `hullHitFlash` alone can't tell "still decaying from
	// the last hit" from "a fresh one just landed". SCRATCH just reads
	// `hullContact` + `hullSlideMs` continuously, no edge detection needed.
	//
	// SPLIT LIKE THE EXHAUST: this still polls from a `usePhysicsTask`, not a
	// render task — `hullHitSeq` can tick and `hullContact` can come and go
	// entirely inside one physics step, and a render-stage poll would coalesce
	// several steps into one read and miss one. It runs after
	// `sim/hullContacts.ts` publishes for the same step because TestGame.svelte
	// mounts (and so registers its own physics task) before this component
	// does — tasks sharing a constraint fall back to mount order (src/CLAUDE.md).
	// Ballistics + streak-building stay a `{ before: autoRenderTask }` task
	// (fx/puffPool.ts's camera-basis rule). Pooled, hoisted callbacks,
	// `autoInvalidate: false` — DOCS/best-practices.md §4 throughout.
	//
	// **`sparkPool.ts` is its primitive**, puffPool's hot sibling: one ADDITIVE
	// `MeshBasicNodeMaterial` mesh — a spark is white-hot metal and ADDS light
	// rather than dimming, the opposite job to smoke, and it must not be dimmed
	// by the night exposure exactly when it should read brightest. A spark is a
	// STREAK, not a billboard: the quad is built on the spark's own velocity
	// axis (a CYLINDRICAL billboard — the axis is physical and never turned by
	// the camera, only rolled about it to face the viewer) and stretched by a
	// shutter time's worth of motion (`streak × speed`), which is the smear
	// that separates sparks from orange dots. COOLING is age- AND
	// position-driven (the head is the particle, the tail is where it was:
	// white → yellow → orange → dull red), plus a hard SPUTTER — a `step()` on
	// a per-spark hash, because a tumbling spark genuinely blinks out; a field
	// that only fades reads as embers. No noise textures: a spark is smaller
	// than one texel of the perlin PNG, so the variety comes from the
	// per-spark seed. The dust is a small LIT puffPool (road grit,
	// normal-blended — what stops a hard hit reading as fireworks in a
	// vacuum). World-anchored at TestGame root (sparks are shed, not carried).

	const { invalidate, camera, autoRenderTask } = useThrelte();

	// ── Tuning ──────────────────────────────────────────────────────────────────
	// Velocity thresholds are in METRES per second at the boundary (`carSim`'s
	// own unit — reads as real car speeds), WORLD units per second inside the
	// pools (units.ts — the same split the driving model makes).

	/** m/s of sliding at the contact before anything grinds. Below this the car
	 *  is leaning on something, not scraping it. */
	const SCRAPE_MIN_SPEED = 1.4;
	/** m/s at which the scrape is at full rate — roughly 80 km/h down a wall. */
	const SCRAPE_FULL_SPEED = 22;
	/** sparks/s at the threshold, and the extra at full sliding speed. */
	const SCRAPE_BASE = 14;
	const SCRAPE_GAIN = 95;

	// ── Pools ───────────────────────────────────────────────────────────────────
	// 96 sparks: a full-rate scrape spawns ~110/s and a spark lives ~0.45 s, so
	// the steady state wants ~50 alive and a big hit adds a burst of up to 40 on
	// top. Sized for the two overlapping, because they do — you scrape the wall
	// on the way out of hitting it. The FILL cost of raising it further is the
	// same argument as TireSmoke's POOL, except a spark quad is a fraction of a
	// puff's screen area, which is why this number can be three times as big.
	const sparks = createSparkPool({
		count: 96,
		brightness: 2.4, // over 1 on purpose — additive, and bloom is downstream
		gravity: 12, // world units/s²; a shade heavier than the world's 9.8
		drag: 1.2,
		streak: 0.028, // seconds of motion smeared into the streak
		width: 0.035,
		flicker: 58,
		sputter: 9
	});

	// A hit also coughs DUST — grit off the barrier, paint, road grime. Normal
	// blended (it dims what is behind it) against the sparks' additive, and it is
	// what stops a hard hit reading as fireworks in a vacuum. Small pool: this is
	// punctuation on impacts only, never a continuous source like TireSmoke.
	const DUST_DRAG = 2.2;
	const dust = createPuffPool({
		count: 20,
		lit: true, // the skid-marks lesson — grey dust must dim at night
		color: [0.62, 0.6, 0.57], // road grit, not tyre smoke
		alphaPeak: 0.3,
		fadeOut: 1.8,
		roilScale: 1.7,
		roilDrift: [0.24, 0.14],
		clumpScale: 2.3,
		erosion: 0.7,
		erosionSoft: 0.3,
		bulge: 0.75,
		spin: 0.8,
		onTextureLoad: () => invalidate()
	});

	// ── Emission ────────────────────────────────────────────────────────────────

	/**
	 * One spark off the contact. It keeps a SHARE of the surface's own slide
	 * velocity — which is what makes the stream trail behind the car instead of
	 * hanging in a puddle — plus a kick along the normal and a random cone.
	 *
	 * @param slide world units/s along the surface
	 * @param out world units/s away from it
	 * @param spread world units/s of jitter on every axis
	 */
	function spark(slide: number, out: number, spread: number, heat: number, life: number): void {
		const keep = 0.15 + 0.5 * Math.random();
		const kick = out * (0.35 + 0.65 * Math.random());
		const { hullContactX: x, hullContactY: y, hullContactZ: z } = carSim;
		const { hullNormalX: nx, hullNormalY: ny, hullNormalZ: nz } = carSim;
		const { hullSlideDirX: tx, hullSlideDirY: ty, hullSlideDirZ: tz } = carSim;
		sparks.spawn(
			x + nx * 0.05,
			y + ny * 0.05,
			z + nz * 0.05,
			tx * slide * keep + nx * kick + (Math.random() - 0.5) * spread,
			ty * slide * keep + ny * kick + (Math.random() - 0.5) * spread,
			tz * slide * keep + nz * kick + (Math.random() - 0.5) * spread,
			life,
			heat,
			0.7 + 0.6 * Math.random()
		);
	}

	/** The arrival: a wide burst plus a cough of dust, both sized by severity
	 *  (0..1, `carSim.hullHitDv` normalised against `HULL_HIT_FULL_DV`). */
	function burst(severity: number): void {
		const slide = carSim.hullSlideMs * UNITS_PER_METER;
		const count = 7 + Math.round(30 * severity);
		for (let i = 0; i < count; i++) {
			spark(
				slide,
				5 + 24 * severity,
				6 + 10 * severity,
				0.7 + 0.3 * Math.random(),
				0.28 + (0.45 + 0.35 * severity) * Math.random()
			);
		}
		const { hullContactX: x, hullContactY: y, hullContactZ: z } = carSim;
		const { hullNormalX: nx, hullNormalZ: nz } = carSim;
		const { hullSlideDirX: tx, hullSlideDirZ: tz } = carSim;
		const puffs = 2 + Math.round(4 * severity);
		for (let i = 0; i < puffs; i++) {
			dust.spawn(
				x + (Math.random() - 0.5) * 0.5,
				y + (Math.random() - 0.5) * 0.5,
				z + (Math.random() - 0.5) * 0.5,
				tx * slide * 0.25 + nx * (1 + 2 * Math.random()) + (Math.random() - 0.5) * 1.2,
				0.6 + 0.9 * Math.random(),
				tz * slide * 0.25 + nz * (1 + 2 * Math.random()) + (Math.random() - 0.5) * 1.2,
				0.8 + 0.6 * Math.random(),
				0.4 + 0.6 * severity,
				0.3 + 0.35 * severity,
				(1.2 + 1.4 * severity) * (0.8 + 0.4 * Math.random())
			);
		}
	}

	// ── The sweep, at the physics rate ──────────────────────────────────────────

	/** Fractional spark owed to the scrape — the TireSmoke accumulator pattern, so
	 *  the rate is in sparks per SECOND and survives any physics framerate. */
	let scrapeT = 0;
	/** The last hit this component has already reacted to — `hullHitSeq` only
	 *  ever increases, so a mismatch means a fresh arrival landed this step. */
	let lastHitSeq = carSim.hullHitSeq;

	usePhysicsTask((delta) => {
		if (carSim.hullHitSeq !== lastHitSeq) {
			lastHitSeq = carSim.hullHitSeq;
			burst(clamp(carSim.hullHitDv / HULL_HIT_FULL_DV, 0, 1));
			invalidate();
		}

		if (!carSim.hullContact || carSim.hullSlideMs < SCRAPE_MIN_SPEED) {
			scrapeT = 0;
			return;
		}
		const grind = clamp(
			(carSim.hullSlideMs - SCRAPE_MIN_SPEED) / (SCRAPE_FULL_SPEED - SCRAPE_MIN_SPEED),
			0,
			1
		);
		scrapeT += delta * (SCRAPE_BASE + SCRAPE_GAIN * grind);
		while (scrapeT >= 1) {
			scrapeT -= 1;
			spark(
				carSim.hullSlideMs * UNITS_PER_METER,
				2 + 5 * grind,
				3 + 4 * grind,
				0.45 + 0.5 * grind,
				0.2 + 0.4 * Math.random()
			);
		}
	});

	// ── The visual half ─────────────────────────────────────────────────────────
	// Render stage: the streaks are built on the camera basis that is about to be
	// drawn, and the ballistics run on the frame's own delta rather than on a
	// substep count that is never constant (`ceil(accumulator / rate)`).
	useTask(
		(delta) => {
			let live = sparks.update(delta, camera.current);
			if (dust.update(delta, camera.current, DUST_DRAG)) live = true;
			if (live) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	onDestroy(() => {
		sparks.dispose();
		dust.dispose();
	});
</script>

<!-- World-anchored (mounted at TestGame root, NOT in the car): the sparks and the
     dust are shed, so they stay where the car scraped while it drives away. Two
     meshes, two draw calls, degenerate when nothing is alive. -->
<T is={sparks.mesh} />
<T is={dust.mesh} />
