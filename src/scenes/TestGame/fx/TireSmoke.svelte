<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { saturate, smoothstep, texture, uniform, uv, vec2 } from 'three/tsl';
	import { BASE_URL } from '$extensions/settings';
	import { currentCar } from '../cars';
	import { wheelPatches } from '../cars/spec';
	import { UNITS_PER_METER } from '../units';
	import { clamp as numClamp } from '../sim/carMath';
	import { carSim } from '../sim/carTelemetry.svelte';

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
	// LIT, not unlit (the skid-marks lesson): MeshStandardNodeMaterial with a
	// near-white albedo, so the smoke is bright gray against day asphalt and
	// dims with the environment at night instead of glowing. The billboard
	// quaternion (copied off the app camera every update) orients the plane's
	// +Z normal at the camera for free — no normalNode needed.
	//
	// Rules honored (DOCS/best-practices.md §4): one material node graph across
	// the pool (per-puff dyn uniforms — the flames' own trick, one compiled
	// program), no allocation in the task body, autoInvalidate OFF with
	// invalidate() only while puffs are alive.

	let { target }: { target?: THREE.Object3D } = $props();

	// ── Layout (body space — the shared wheelPatches twin of SkidMarks) ────────
	const WHEELS = wheelPatches(currentCar());

	// ── Tuning ──────────────────────────────────────────────────────────────────
	const SMOKE_ON = 0.45; // slide intensity before a wheel smokes at all
	const SPAWN_BASE = 2; // puffs/s per wheel at the threshold
	const SPAWN_GAIN = 8; // extra puffs/s at full intensity (burnout ≈ 10/s/wheel)
	const ALPHA_PEAK = 0.3; // per puff — overlaps build the cloud's density
	const POOL = 32;
	const SMOKE_LIFT = 0.2; // above the road plane — same reason as SkidMarks' LIFT

	// ── Textures (same vendored pair the flames/marks use) ─────────────────────
	const { invalidate, camera } = useThrelte();
	const perlinTex = new THREE.TextureLoader().load(`${BASE_URL}textures/noises/perlin.png`, () =>
		invalidate()
	);
	const cellularTex = new THREE.TextureLoader().load(`${BASE_URL}textures/noises/voronoi.png`, () =>
		invalidate()
	);
	for (const t of [perlinTex, cellularTex]) {
		t.wrapS = THREE.RepeatWrapping;
		t.wrapT = THREE.RepeatWrapping;
	}

	// ── Pool ────────────────────────────────────────────────────────────────────
	const uTime = uniform(0);

	type Dyn = {
		birth: ReturnType<typeof numUniform>;
		life: ReturnType<typeof numUniform>;
		strength: ReturnType<typeof numUniform>;
		seed: ReturnType<typeof numUniform>;
	};
	// Pinned via a helper — `ReturnType<typeof uniform>` grabs the LAST overload
	// (a vec3 one); see the same note in CarExhaustFlames.
	const numUniform = () => uniform(0);

	function makePuffMaterial(dyn: Dyn) {
		const material = new THREE.MeshStandardNodeMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			metalness: 0,
			roughness: 1
		});
		material.color.setRGB(0.78, 0.78, 0.8); // rubber smoke is white-gray
		// Age: born fast, gone before the ring recycles the quad.
		const t = uTime.sub(dyn.birth).div(dyn.life);
		const fadeIn = saturate(t.mul(5));
		const fadeOut = saturate(t.oneMinus().mul(1.4));
		// Soft blob: radial falloff to nothing before the quad's corner.
		const c = uv().sub(0.5);
		const rad = c.x.mul(c.x).add(c.y.mul(c.y)).sqrt();
		const rim = smoothstep(0.18, 0.5, rad).oneMinus();
		// Roil (the puff evolves, not just fades) + cellular clumps.
		const roilUv = uv()
			.mul(1.5)
			.add(vec2(dyn.seed.add(uTime.mul(0.2)), dyn.seed.mul(2.3).sub(uTime.mul(0.12))));
		const roil = texture(perlinTex, roilUv).r;
		const clumpUv = uv()
			.mul(2.2)
			.add(vec2(dyn.seed.mul(1.7), dyn.seed));
		const clump = texture(cellularTex, clumpUv).r;
		material.opacityNode = dyn.strength
			.mul(ALPHA_PEAK)
			.mul(fadeIn)
			.mul(fadeOut)
			.mul(rim)
			.mul(saturate(roil.mul(1.45)))
			.mul(clump.mul(0.55).add(0.45));
		return material;
	}

	type Puff = {
		mesh: THREE.Mesh;
		dyn: Dyn;
		alive: boolean;
		x: number;
		y: number;
		z: number;
		vx: number;
		vy: number;
		vz: number;
		birth: number;
		life: number;
		s0: number;
		grow: number;
	};

	const smokeRoot = new THREE.Group();
	const puffGeometry = new THREE.PlaneGeometry(1, 1);
	const puffs: Puff[] = [];
	let head = 0;
	for (let i = 0; i < POOL; i++) {
		const dyn: Dyn = {
			birth: numUniform(),
			life: numUniform(),
			strength: numUniform(),
			seed: numUniform()
		};
		dyn.birth.value = -99;
		dyn.life.value = 1;
		const mesh = new THREE.Mesh(puffGeometry, makePuffMaterial(dyn));
		// The LAST slot starts VISIBLE — the boot warm window below renders it at
		// defaults (strength 0 → fully transparent) so the puff pipeline compiles at
		// scene entry, behind the transition veil, instead of hitching the FIRST
		// burnout. `head` starts at 0 and only a spawn advances it, so a real puff
		// cannot reach this slot for POOL spawns — and if one somehow does, it just
		// overwrites the dyns (a spawn sets everything it reads).
		mesh.visible = i === POOL - 1;
		mesh.frustumCulled = false; // task-driven scale — never cull
		smokeRoot.add(mesh);
		puffs.push({
			mesh,
			dyn,
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
			grow: 1
		});
	}

	// Per-wheel spawn accumulators — how much of the next puff each wheel has earned.
	const spawnT = [0, 0, 0, 0];
	// Scene clock — `delta` from the task, never performance.now() (banned).
	let clock = 0;
	const _v = new THREE.Vector3();

	// Boot warm window, in seconds of task time: while it lasts, keep invalidating
	// so the visible-by-default warm slot above actually RENDERS (on-demand: no
	// invalidate, no draw, no pipeline compile) — physics steps can run several per
	// frame, so counting ticks would race the renderer; a time window cannot. The
	// window lands inside the scene-entry veil, where the (zero-alpha) draw is free.
	let warm = 0.3;

	useTask(
		(delta) => {
			clock += delta;
			uTime.value = clock;

			// Boot warm window (see `warm` above): keep frames flowing while it lasts,
			// then park the warm slot back to invisible. Zero-alpha by construction.
			if (warm > 0) {
				warm -= delta;
				if (warm <= 0) puffs[POOL - 1].mesh.visible = false;
				invalidate();
			}

			const body = target?.parent;
			if (!body) return;

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

			body.updateWorldMatrix(true, false);
			const e = body.matrixWorld.elements;
			const rX = e[8];
			const rZ = e[10]; // local +Z — REAR — in world
			// The car's motion, lagged: smoke trails behind a moving car instead
			// of teleporting along with it.
			const carV = carSim.speedMs * UNITS_PER_METER * 0.45;

			// ── Spawn: rate scales with intensity; a wisp is one puff, a burnout
			// is a stream. Velocity = lazy rise + the lagged car motion + a small
			// rearward roll off the spinning tyre.
			let spawned = false;
			for (let w = 0; w < 4; w++) {
				const intensity = w >= 2 ? rearI : frontI;
				if (intensity < SMOKE_ON) {
					spawnT[w] = 0;
					continue;
				}
				spawnT[w] += delta * (SPAWN_BASE + SPAWN_GAIN * intensity);
				if (spawnT[w] < 1) continue;
				spawnT[w] -= 1;

				const puff = puffs[head];
				head = (head + 1) % POOL;
				_v.set(WHEELS[w][0], 0.1 + SMOKE_LIFT, WHEELS[w][1]);
				body.localToWorld(_v);
				const roll = w >= 2 ? 0.8 + 0.8 * Math.random() : 0.3;
				puff.x = _v.x + (Math.random() - 0.5) * 0.4;
				puff.y = _v.y;
				puff.z = _v.z + (Math.random() - 0.5) * 0.4;
				puff.vx = -rX * carV + rX * roll + (Math.random() - 0.5) * 0.8;
				puff.vz = -rZ * carV + rZ * roll + (Math.random() - 0.5) * 0.8;
				puff.vy = 1.1 + 0.9 * Math.random() + 0.7 * intensity;
				puff.birth = clock;
				puff.life = 1.0 + 0.6 * Math.random();
				puff.s0 = 0.3 + 0.3 * intensity;
				puff.grow = (1.5 + 1.3 * intensity) * (0.8 + 0.4 * Math.random());
				puff.alive = true;
				puff.mesh.visible = true;
				puff.dyn.birth.value = clock;
				puff.dyn.life.value = puff.life;
				puff.dyn.strength.value = intensity;
				puff.dyn.seed.value = Math.random();
				spawned = true;
			}

			// ── Update: drift (with drag), grow, billboard, die ──────────────────
			const cam = camera.current;
			let alive = spawned;
			for (const p of puffs) {
				if (!p.alive) continue;
				const t = (clock - p.birth) / p.life;
				if (t >= 1 || !cam) {
					p.alive = false;
					p.mesh.visible = false;
					continue;
				}
				alive = true;
				const drag = Math.exp(-1.5 * delta);
				p.vx *= drag;
				p.vz *= drag;
				p.x += p.vx * delta;
				p.y += p.vy * delta;
				p.z += p.vz * delta;
				p.mesh.position.set(p.x, p.y, p.z);
				p.mesh.scale.setScalar(p.s0 + p.grow * t);
				p.mesh.quaternion.copy(cam.quaternion);
			}
			if (alive) invalidate();
		},
		{ autoInvalidate: false }
	);

	onDestroy(() => {
		puffGeometry.dispose();
		for (const p of puffs) (p.mesh.material as THREE.Material).dispose();
		perlinTex.dispose();
		cellularTex.dispose();
	});
</script>

<!-- World-anchored (mounted at TestGame root, NOT in the car): smoke hangs in
     the air while the car drives away. The meshes are pooled and driven from
     the task — frustumCulled off, hidden when dead. -->
<T is={smokeRoot} userData={{ hideInTree: true, selectable: false }} />
