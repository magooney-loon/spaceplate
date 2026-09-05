<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useThrelte } from '@threlte/core/webgpu';
	import { usePhysicsTask } from '@threlte/rapier';
	import * as THREE from 'three/webgpu';
	import {
		Fn,
		TWO_PI,
		attribute,
		mix,
		oneMinus,
		saturate,
		sin,
		spherizeUV,
		step,
		texture,
		uniform,
		uv,
		vec2,
		vec3,
		vec4
	} from 'three/tsl';
	import { sceneState } from '$extensions/scene';
	import { BASE_URL } from '$extensions/settings';
	import { GR86 } from './gr86';
	import { clamp } from './carMath';
	import { carSim } from './carTelemetry.svelte';

	// Exhaust flames — pops and bangs on nasty downshifts (and limiter bangs),
	// adapted from three.js's webgpu_tsl_vfx_flames example (TSL VFX, @cmzw_).
	//
	// MOUNTING: inside the car's ×2.5 group, so everything below is authored in
	// MODEL METRES, nose −Z — the same contract as CarHeadlights. The tips are
	// MEASURED, not eyeballed: decode the GLB's Draco `Nickel_Smooth` mesh (the
	// chrome exhaust) and cluster the rear-most vertices — two clean rings at
	// (±0.446, 0.293, 2.053), symmetric about the centreline. Tweak TIP_L/TIP_R
	// if the model is ever replaced; flip DEBUG_TIPS off once the cones line up.
	//
	// SHAPE: per tip, one group of additive quads — a rear-facing blob (what
	// the chase cam sees; crossed quads alone are edge-on from dead behind)
	// plus two crossed quads along the jet axis for the side/top views, and a
	// sparser ember layer (the example's flame 2) on the crossed pair. Both
	// tips share the two materials; the whole group scales with intensity (the
	// jet stretches rearward), so the physics task only touches group
	// scale/visible — no per-vertex work after mount.
	//
	// TRIGGER (physics task, reads carSim after TestGame's task wrote it — the
	// same parent-first ordering CarWheels relies on):
	//   downshift — gear DROPS INTO a real gear (≥1; N/R transitions never
	//               pop). Burst size grows with rpm — a money downshift near
	//               the limiter is a fireball, a lazy 6→5 is a hiccup.
	//   limiter   — each fuel-cut bounce (rising edge of `limiting`) pops small.
	// Energy decays at ~6.5/s: a burst reads as a 0.3–0.5 s flame, not a torch.

	const DEBUG_TIPS = true;

	/** Model metres, measured from the GLB (see header). */
	const TIP_L = new THREE.Vector3(-0.446, 0.293, 2.05);
	const TIP_R = new THREE.Vector3(0.446, 0.293, 2.05);

	// Downshift burst sizing: base + gain × (rpm at the shift / limiter).
	const POP_BASE = 0.55;
	const POP_RPM_GAIN = 0.45;
	/** Pop size for each limiter fuel-cut bounce. */
	const LIMITER_POP = 0.28;
	/** 1/s — burst energy decay. */
	const POP_DECAY = 6.5;
	const ENERGY_CAP = 1.25;

	const { invalidate } = useThrelte();

	// ── Textures ────────────────────────────────────────────────────────────────
	// The gradient is a canvas (like the example) tuned for a backfire: dim
	// violet edge → deep red → orange → white-hot core. TextureLoader returns
	// synchronously and fills in async — invalidate when the noise PNGs land or
	// the first flames render against an incomplete mip chain. (Not
	// @threlte/extras' useTexture: it returns a store, and this repo is
	// runes-only — see Moon.svelte.)

	const gradientCanvas = document.createElement('canvas');
	gradientCanvas.width = 128;
	gradientCanvas.height = 1;
	const gradientCtx = gradientCanvas.getContext('2d')!;
	const gradientFill = gradientCtx.createLinearGradient(0, 0, 128, 0);
	for (const [stop, color] of [
		[0, '#0b0524'],
		[0.25, '#6d1240'],
		[0.55, '#e0331c'],
		[0.8, '#ff9e2e'],
		[1, '#fff4d6']
	] as const) {
		gradientFill.addColorStop(stop, color);
	}
	gradientCtx.fillStyle = gradientFill;
	gradientCtx.fillRect(0, 0, 128, 1);
	const gradientTex = new THREE.CanvasTexture(gradientCanvas);
	gradientTex.colorSpace = THREE.SRGBColorSpace;

	const cellularTex = new THREE.TextureLoader().load(
		`${BASE_URL}textures/noises/voronoi.png`,
		() => invalidate()
	);
	const perlinTex = new THREE.TextureLoader().load(
		`${BASE_URL}textures/noises/perlin.png`,
		() => invalidate()
	);
	// The colorNode uvs run through .mod(1) — repeat wrapping keeps the seam
	// from smearing (the example got away with clamp; repeat is strictly safer).
	for (const t of [cellularTex, perlinTex]) {
		t.wrapS = THREE.RepeatWrapping;
		t.wrapT = THREE.RepeatWrapping;
	}

	// ── Shared uniforms + per-quad seed ─────────────────────────────────────────
	// One uIntensity drives both layers; aSeed (per quad, baked into both
	// geometries) offsets the noise so the crossed quads and the two tips never
	// animate in lockstep.
	const uTime = uniform(0);
	const uIntensity = uniform(0);
	const aSeed = attribute<'float'>('aSeed');

	// ── Geometry ────────────────────────────────────────────────────────────────
	// Unit quads, jet growing +Z (rearward) from the tip:
	//   top  — XZ plane, seen from above (the chase cam sits high)
	//   side — the top quad stood up into the YZ plane (rotate about the flame
	//          axis), seen from the sides
	//   rear — plain XY quad facing +Z: the end-on blob for a camera directly
	//          behind the car
	// Merged by hand (≤24 verts) with a per-quad aSeed — BufferGeometryUtils
	// for this is heavier than the loop.

	type QuadKind = 'top' | 'side' | 'rear';

	function makeLayer(specs: { kind: QuadKind; width: number; length: number }[]) {
		const parts: { pos: Float32Array; uvs: Float32Array; seed: number }[] = [];
		let seed = 0;
		for (const spec of specs) {
			const plane = new THREE.PlaneGeometry(spec.width, spec.length);
			if (spec.kind === 'rear') {
				// Blob: centred on the opening, a touch behind it.
				plane.translate(0, 0, spec.length * 0.35);
			} else {
				// v axis (plane +Y) → +Z, v=0 edge anchored at the origin.
				plane.rotateX(Math.PI / 2);
				plane.translate(0, 0, spec.length / 2);
				if (spec.kind === 'side') plane.rotateZ(Math.PI / 2);
			}
			const flat = plane.toNonIndexed();
			parts.push({
				pos: flat.getAttribute('position').array as Float32Array,
				uvs: flat.getAttribute('uv').array as Float32Array,
				// Fractional: the colorNode uvs wrap at 1, so integer-spaced seeds
				// would all land on the same noise phase.
				seed: seed++ * 0.37
			});
			plane.dispose();
			flat.dispose();
		}
		const vertCount = parts.reduce((n, p) => n + p.pos.length / 3, 0);
		const pos = new Float32Array(vertCount * 3);
		const uvs = new Float32Array(vertCount * 2);
		const seeds = new Float32Array(vertCount);
		let v = 0;
		for (const p of parts) {
			pos.set(p.pos, v * 3);
			uvs.set(p.uvs, v * 2);
			seeds.fill(p.seed, v, v + p.pos.length / 3);
			v += p.pos.length / 3;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
		geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
		return geometry;
	}

	// Flame layer: crossed jets + the rear blob. Ember layer: crossed jets only.
	const flameGeometry = makeLayer([
		{ kind: 'top', width: 0.14, length: 0.42 },
		{ kind: 'side', width: 0.14, length: 0.42 },
		{ kind: 'rear', width: 0.22, length: 0.26 }
	]);
	const emberGeometry = makeLayer([
		{ kind: 'top', width: 0.1, length: 0.34 },
		{ kind: 'side', width: 0.1, length: 0.34 }
	]);

	// ── Materials ───────────────────────────────────────────────────────────────
	// Both adapted from the example's two flames; MeshBasicNodeMaterial rather
	// than SpriteNodeMaterial because these are meshes, not sprites — and no
	// billboarding: the flame is car-local and shoots REARWARD, which a camera
	// -facing sprite can't express. Additive: a pop should glow, not occlude.
	// The .assign()s live inside Fn() — outside is silently dropped
	// (webgpu-notes §1.3).

	function makeFlameMaterial() {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		material.colorNode = Fn(() => {
			const mainUv = uv().toVar();
			mainUv.assign(spherizeUV(mainUv, 10).mul(0.6).add(0.2));
			mainUv.assign(mainUv.pow(vec2(1, 2)));
			mainUv.assign(mainUv.mul(2, 1).sub(vec2(0.5, 0)));

			const gradient1 = sin(uTime.mul(10).sub(mainUv.y.mul(TWO_PI).mul(2))).toVar();
			const gradient2 = mainUv.y.smoothstep(0, 1).toVar();
			mainUv.x.addAssign(gradient1.mul(gradient2).mul(0.2));

			const cellularUv = mainUv
				.mul(0.5)
				.add(vec2(aSeed, uTime.negate().mul(0.5)))
				.mod(1);
			const cellularNoise = texture(cellularTex, cellularUv, 0)
				.r.oneMinus()
				.smoothstep(0, 0.5)
				.oneMinus();
			cellularNoise.mulAssign(gradient2);

			const shape = mainUv.sub(0.5).mul(vec2(3, 2)).length().oneMinus().toVar();
			shape.assign(shape.sub(cellularNoise));

			const gradientColor = texture(gradientTex, vec2(saturate(shape), 0));
			const color = mix(gradientColor, vec3(1), shape.step(0.8));
			const flicker = sin(uTime.mul(37).add(aSeed.mul(12))).mul(0.25).add(0.85);
			const alpha = shape.smoothstep(0, 0.3).mul(uIntensity).mul(flicker);
			return vec4(color.rgb, alpha);
		})();
		return material;
	}

	function makeEmberMaterial() {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		material.colorNode = Fn(() => {
			const mainUv = uv().toVar();
			mainUv.assign(spherizeUV(mainUv, 10).mul(0.6).add(0.2));
			mainUv.assign(mainUv.abs().pow(vec2(1, 3)).mul(mainUv.sign()));
			mainUv.assign(mainUv.mul(2, 1).sub(vec2(0.5, 0)));

			const perlinUv = mainUv.add(vec2(aSeed, uTime.negate())).mod(1);
			const perlinNoise = texture(perlinTex, perlinUv, 0).sub(0.5);
			mainUv.x.addAssign(perlinNoise.x.mul(0.5));

			const gradient1 = sin(uTime.mul(10).sub(mainUv.y.mul(TWO_PI).mul(2)));
			const gradient2 = mainUv.y.smoothstep(0, 1);
			const gradient3 = oneMinus(mainUv.y).smoothstep(0, 0.3);
			mainUv.x.addAssign(gradient1.mul(gradient2).mul(0.2));

			const cellularUv = mainUv.add(vec2(aSeed, uTime.negate().mul(1.5))).mod(1);
			const cellularNoise = texture(cellularTex, cellularUv, 0)
				.r.oneMinus()
				.smoothstep(0.25, 1);

			const shape = step(mainUv.sub(0.5).mul(vec2(6, 1)).length(), 0.5).toVar();
			shape.assign(shape.mul(cellularNoise));
			shape.mulAssign(gradient3);
			shape.assign(step(0.01, shape));

			// White-hot core with a warm rim, not the example's pure white.
			const color = mix(vec3(1, 0.82, 0.55), vec3(1), shape);
			const alpha = shape.mul(uIntensity).mul(0.8);
			return vec4(color, alpha);
		})();
		return material;
	}

	const flameMaterial = makeFlameMaterial();
	const emberMaterial = makeEmberMaterial();

	// ── Per-tip rigs ────────────────────────────────────────────────────────────

	function makeTip(position: THREE.Vector3) {
		const group = new THREE.Group();
		group.position.copy(position);
		group.visible = false; // the task shows it when a pop lands
		const flame = new THREE.Mesh(flameGeometry, flameMaterial);
		const ember = new THREE.Mesh(emberGeometry, emberMaterial);
		flame.frustumCulled = false; // scaling quads from a task — never cull
		ember.frustumCulled = false;
		group.add(flame, ember);
		return group;
	}

	const tipL = makeTip(TIP_L);
	const tipR = makeTip(TIP_R);

	// Positioning aids — wireframe cones AT the measured tips, pointing +Z.
	const tipCones = [TIP_L, TIP_R].map((p) => {
		const geo = new THREE.ConeGeometry(0.035, 0.14, 12);
		geo.rotateX(Math.PI / 2);
		const mesh = new THREE.Mesh(
			geo,
			new THREE.MeshBasicMaterial({ color: 0xff3020, wireframe: true })
		);
		mesh.position.copy(p);
		return mesh;
	});

	// ── Trigger ─────────────────────────────────────────────────────────────────

	let clock = 0;
	let energy = 0;
	let prevGear = 1;
	let prevLimiting = false;

	usePhysicsTask((delta) => {
		if (sceneState.currentScene !== 'testGame') {
			energy = 0;
			return;
		}
		clock += delta;
		uTime.value = clock;

		if (carSim.gear !== prevGear) {
			if (carSim.gear >= 1 && prevGear > carSim.gear) {
				energy += POP_BASE + POP_RPM_GAIN * clamp(carSim.rpm / GR86.limiterRpm, 0, 1);
			}
			prevGear = carSim.gear;
		}
		if (carSim.limiting && !prevLimiting) energy += LIMITER_POP;
		prevLimiting = carSim.limiting;

		energy = Math.min(energy * Math.exp(-POP_DECAY * delta), ENERGY_CAP);
		const i = clamp(energy, 0, 1);
		uIntensity.value = i;

		const show = i > 0.02;
		tipL.visible = show;
		tipR.visible = show;
		if (!show) return;
		// A visible flame is an animating visual — this component owns that
		// invalidate reason while a pop is alive (the driving case is already
		// covered by the chase camera; this covers a stationary rev-match).
		invalidate();

		// Per-tip flicker at unrelated frequencies so the pair never pulses as
		// one; the jet axis (z) stretches harder than the width.
		const fL = 0.85 + 0.2 * Math.sin(clock * 53);
		const fR = 0.85 + 0.2 * Math.sin(clock * 41 + 2.1);
		const w = 0.55 + 0.6 * i;
		const len = 0.35 + 1.15 * i;
		tipL.scale.set(w * fL, w * fL, len * (0.9 + 0.2 * fL));
		tipR.scale.set(w * fR, w * fR, len * (0.9 + 0.2 * fR));
	});

	onDestroy(() => {
		flameGeometry.dispose();
		emberGeometry.dispose();
		flameMaterial.dispose();
		emberMaterial.dispose();
		gradientTex.dispose();
		cellularTex.dispose();
		perlinTex.dispose();
		for (const c of tipCones) c.geometry.dispose();
	});
</script>

<T is={tipL} />
<T is={tipR} />
{#if DEBUG_TIPS}
	<T is={tipCones[0]} />
	<T is={tipCones[1]} />
{/if}
