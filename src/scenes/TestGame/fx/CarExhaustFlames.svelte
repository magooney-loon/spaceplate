<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { usePhysicsTask } from '@threlte/rapier';
	import * as THREE from 'three/webgpu';
	import {
		Fn,
		TWO_PI,
		attribute,
		float,
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
	import { currentCar } from '../cars';
	import { UNITS_PER_METER } from '../units';
	import { clamp } from '../sim/carMath';
	import { carSim } from '../sim/carTelemetry.svelte';
	import { triggerExhaustPop } from '../audio/carAudio';
	import { perlinNoise, voronoiNoise } from './noiseTextures';
	import { createPuffPool } from './puffPool';

	// Exhaust flames — pops and bangs on nasty downshifts (and limiter bangs),
	// adapted from three.js's webgpu_tsl_vfx_flames example (TSL VFX, @cmzw_).
	//
	// MOUNTING: inside the car's ×2.5 group, so everything below is authored in
	// MODEL METRES, nose −Z — the same contract as CarHeadlights. The tips are
	// MEASURED, not eyeballed: decode the GLB's Draco `Nickel_Smooth` mesh (the
	// chrome exhaust) and cluster the rear-most vertices — two clean rings at
	// (±0.446, 0.293, 2.053), symmetric about the centreline. Tweak TIP_L/TIP_R
	// if the model is ever replaced; flip DEBUG_TIPS to see cones at the tips.
	//
	// SHAPE: three stacked layers per tip, all additive:
	//   flame — THREE radial planes (0°/60°/120° about the jet axis — two
	//           crossed planes read as a flat X from halfway angles) + a
	//           rear-facing blob (what a chase cam dead behind sees)
	//   ember — sparser white-hot tongues on two crossed planes
	//   glow  — big soft radial halo that flashes on IGNITION and dies in
	//           ~150 ms. The same flash value blows the flame's width up at
	//           birth (width ×(1 + 0.5·flash)) — that initial expansion is
	//           what makes a pop read as a BANG instead of a torch.
	//   light — a real PointLight on that same flash, so the bang throws light on
	//           the road and the car's rear instead of glowing at nothing. One
	//           lamp for both pipes, permanently mounted; the rules are strict and
	//           they are at POP_LIGHT_* below. Read them before touching it.
	// The whole group scales with intensity (the jet stretches rearward), so
	// the physics task only touches group scale/visible — no per-vertex work
	// after mount. Each tip gets its OWN material instances (uniform values
	// differ, the node graphs are identical, so they share compiled programs)
	// — that is what lets one pipe bang harder than the other.
	//
	// NO TWO POPS ALIKE. Every pop rolls a STYLE, and style drives both the
	// CPU side (amplitude, decay, length, width) and the shader via uStyle:
	//   0 CRACK — short, sharp, narrow; fastest flicker; can double-bang
	//   1 BURN  — lazier and longer, slower rolling noise
	//   2 BALL  — fat fireball, wider than long, biggest white core + embers
	// On top of that: per-pop random noise phase (uPhase, per tip), per-tip
	// energy shares (≈18% of pops are effectively one-sided), and crack/ball
	// can queue a second, smaller bang 60–130 ms later (anti-lag stutter).
	//
	// TRIGGER (physics task, reads carSim after TestGame's task wrote it — the
	//   same parent-first ordering CarWheels relies on):
	//   downshift — gear DROPS INTO a real gear (≥1; N/R transitions never
	//               pop). Burst size grows with rpm — a money downshift near
	//               the limiter is a fireball, a lazy 6→5 is a hiccup.
	//   limiter   — each fuel-cut bounce (rising edge of `limiting`) pops small.
	//
	// NITROUS: while `carSim.nitrous` flows, two things change. (1) uNitro (a GLOBAL
	// uniform like uStyle — spray is engine state, not per-pop) crossfades every
	// layer's palette to a cold one — flame gradient indigo→royal→electric→ice,
	// icy ember rims, deep-blue glow — so pops that land mid-spray bang BLUE. (2) A
	// PILOT FLAME: the flow floors both tips' energy (no flash, no style roll — just
	// a steady jet), which is the continuous blue torch the chase cam reads as "the
	// system is on", plus a faint steady flash floor so the glow halos stay lit.
	//
	// SMOKE: every bang also coughs puffs — see the smoke section below. Unlike
	// the flames (car-local jets) the puffs are WORLD-ANCHORED, spawned at the
	// tip's world position and parented to the scene, so they hang in the air
	// while the car drives away; and they NORMAL-blend (they dim what is behind
	// them — the opposite job to the additive flames). Billboards via a camera
	// quaternion copy in the task.

	const DEBUG_TIPS = false;

	// The car's spec owns the tip positions (measured off the GLB — see the spec
	// file for provenance). Two entries, [left, right].
	const CAR = currentCar();
	const hw = CAR.hardware;
	const [TIP_L_ARR, TIP_R_ARR] = CAR.geometry.exhaustTips;
	/** Model metres, from the spec (see header). */
	const TIP_L = new THREE.Vector3(TIP_L_ARR[0], TIP_L_ARR[1], TIP_L_ARR[2]);
	const TIP_R = new THREE.Vector3(TIP_R_ARR[0], TIP_R_ARR[1], TIP_R_ARR[2]);

	// Downshift burst sizing: base + gain × (rpm at the shift / limiter).
	const POP_BASE = 0.55;
	const POP_RPM_GAIN = 0.45;
	/** Pop size for each limiter fuel-cut bounce. */
	const LIMITER_POP = 0.28;
	const ENERGY_CAP = 1.25;
	/** Share of pops that are (effectively) one-pipe. */
	const ONE_SIDED_CHANCE = 0.18;
	/** 1/s — how fast the ignition flash (glow + width boost) dies. */
	const FLASH_DECAY = 14;

	// ── The pop LIGHT ───────────────────────────────────────────────────────────
	// A bang throws light on the road, the barriers and the car's own rear — the
	// additive quads glow but illuminate nothing, so without this a night pop is a
	// sticker floating in the dark. Driven by the SAME flash value as the glow
	// halo, so the light is the bang by construction: full at ignition, gone in
	// ~150 ms, and floored by the nitrous pilot so a spray keeps a steady blue
	// wash under the car.
	//
	// **IT IS MOUNTED PERMANENTLY AND ONLY ITS `intensity` MOVES.** Never gate a
	// light with `visible`, and never toggle `castShadow`: three's `_projectObject`
	// skips invisible objects before `renderList.pushLight()`
	// (`Renderer.js:3082`), and `LightsNode.customCacheKey()` hashes every light's
	// `id` and `castShadow` — so removing one from the list changes the cache key
	// of EVERY lit material in the scene and rebuilds all of their shaders. On a
	// per-pop toggle that is a full recompile several times a second. Modulating
	// intensity touches a uniform and nothing else. (`CarHeadlights` already does
	// this — `light.intensity = on ? m.intensity : 0`.)
	//
	// The standing cost is one more light evaluated per fragment of every lit
	// material, always, even at intensity 0 — there is no way to have the light
	// available and not pay for it. This is the FIFTH light in the scene (sky key +
	// sky fill + two headlight projectors), so it is over the three-light guideline
	// in DOCS/best-practices.md §4; the budget that bought it is §1.1 of
	// DOCS/testperf.md, which took 313 725 triangles out of the shadow pass. No
	// shadow on this one — a shadow-casting PointLight is SIX shadow renders.
	//
	// ONE light, not one per pipe: two point sources 0.9 m apart, lit for 150 ms,
	// are not resolvable. The per-pipe asymmetry `fire()` rolls is kept by sliding
	// this single light toward the dominant pipe instead (see `fire`).
	/** Candela at full flash. Physical falloff (`intensity / d²` at decay 2), same
	 *  order as the headlights' main beam. Tuned by eye — turn it down if a pop
	 *  blows out the tarmac at night. */
	const POP_LIGHT_INTENSITY = 900;
	/** Cutoff radius. **WORLD units, not the model metres everything else in this
	 *  file is authored in** — three compares `light.distance` against a view-space
	 *  length (`PointLightNode` `cutoffDistanceNode`), so the car's ×2.5 group does
	 *  not scale it. Keeps the flash local instead of tinting the whole city. */
	const POP_LIGHT_DISTANCE = 30;
	const POP_LIGHT_DECAY = 2;
	/** Model metres rearward of the tips, so the lamp is not buried in the bumper. */
	const POP_LIGHT_BEHIND = 0.35;

	// amplitude range, decay 1/s, jet length range, width scale, double-bang chance
	const POP_STYLES = [
		{ amp: [1.05, 1.35], decay: 9, len: [0.85, 1.15], w: 1.0, dbl: 0.3 }, // crack
		{ amp: [0.85, 1.05], decay: 3.2, len: [1.25, 1.6], w: 1.0, dbl: 0 }, // burn
		{ amp: [1.2, 1.5], decay: 5.5, len: [0.75, 1.0], w: 1.55, dbl: 0.35 } // ball
	] as const;

	const { invalidate, camera, scene, autoRenderTask } = useThrelte();

	// ── Textures ────────────────────────────────────────────────────────────────
	// The gradient is a canvas (like the example): the backfire ramp is dim violet
	// edge → deep red → orange → white-hot core, the nitrous ramp the same shape
	// through a cold flame — indigo → royal → electric → ice. Two textures, not a
	// recolour in flight: the shader crossfades them by uNitro (below), which costs
	// one mix and never re-uploads a canvas. TextureLoader returns synchronously and
	// fills in async — invalidate when the noise PNGs land or the first flames render
	// against an incomplete mip chain. (Not @threlte/extras' useTexture: it returns a
	// store, and this repo is runes-only — see Moon.svelte.)

	function makeGradientTexture(stops: readonly (readonly [number, string])[]): THREE.CanvasTexture {
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 1;
		const ctx = canvas.getContext('2d')!;
		const fill = ctx.createLinearGradient(0, 0, 128, 0);
		for (const [stop, color] of stops) fill.addColorStop(stop, color);
		ctx.fillStyle = fill;
		ctx.fillRect(0, 0, 128, 1);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}

	const gradientTex = makeGradientTexture([
		[0, '#0b0524'],
		[0.25, '#6d1240'],
		[0.55, '#e0331c'],
		[0.8, '#ff9e2e'],
		[1, '#fff4d6']
	]);
	const nitroGradientTex = makeGradientTexture([
		[0, '#040920'],
		[0.25, '#122a7a'],
		[0.55, '#1e63e0'],
		[0.8, '#5fd0ff'],
		[1, '#eef8ff']
	]);

	// Shared with SkidMarks and TireSmoke — one fetch and one GPU texture per
	// file for the whole scene (fx/noiseTextures.ts). Repeat-wrapped there,
	// which is what the .mod(1) colorNode uvs below need: clamp would smear the
	// seam (the three.js example got away with it; repeat is strictly safer).
	const cellularTex = voronoiNoise(() => invalidate());
	const perlinTex = perlinNoise(() => invalidate());

	// ── Uniforms ────────────────────────────────────────────────────────────────
	// uTime/uStyle are global (one style per pop, shared by both pipes); each
	// tip owns its own intensity, flash and noise-phase uniforms so the pipes
	// never flame in lockstep. aSeed (per quad, baked into the geometry)
	// offsets the noise within one tip.
	const uTime = uniform(0);
	const uStyle = uniform(0);
	/** 0 = orange backfire palette, 1 = full nitrous blue. Global like uStyle: the
	 * spray is engine state, shared by both pipes and every layer. */
	const uNitro = uniform(0);
	const aSeed = attribute<'float'>('aSeed');

	function numUniform() {
		return uniform(0);
	}
	type DynUniforms = {
		// Pinned via a helper — `ReturnType<typeof uniform>` grabs the LAST
		// overload (a vec3 one), and `uniform<number>` isn't a legal instantiation.
		intensity: ReturnType<typeof numUniform>;
		phase: ReturnType<typeof numUniform>;
		/** Ignition flash, 0..1 — drives the glow layer + the width blow-up. */
		flash: ReturnType<typeof numUniform>;
	};

	// ── Geometry ────────────────────────────────────────────────────────────────
	// Unit quads, jet growing +Z (rearward) from the tip:
	//   jet  — a plane THROUGH the jet axis, rolled `angle` about it; 0° lies
	//          in the XZ plane (top view), π/2 stands it up (side view)
	//   rear — plain XY quad facing +Z: the end-on blob for a camera directly
	//          behind the car
	// Merged by hand (≤30 verts) with a per-quad aSeed — BufferGeometryUtils
	// for this is heavier than the loop.

	type QuadSpec =
		| { kind: 'jet'; width: number; length: number; angle?: number }
		| { kind: 'rear'; width: number; length: number };

	function makeLayer(specs: QuadSpec[]) {
		const parts: { pos: Float32Array; uvs: Float32Array; seed: number }[] = [];
		let seed = 0;
		for (const spec of specs) {
			const plane = new THREE.PlaneGeometry(spec.width, spec.length);
			if (spec.kind === 'jet') {
				// v axis (plane +Y) → +Z, v=0 edge anchored at the origin.
				plane.rotateX(Math.PI / 2);
				plane.translate(0, 0, spec.length / 2);
				if (spec.angle) plane.rotateZ(spec.angle);
			} else {
				// Blob: centred on the opening, a touch behind it.
				plane.translate(0, 0, spec.length * 0.35);
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

	// Flame: THREE radial planes (two crossed read flat from halfway angles) +
	// the rear blob. Embers: two crossed planes. Glow: big soft crossed pair +
	// blob for the ignition halo.
	const flameGeometry = makeLayer([
		{ kind: 'jet', width: 0.2, length: 0.5 },
		{ kind: 'jet', width: 0.2, length: 0.5, angle: Math.PI / 3 },
		{ kind: 'jet', width: 0.2, length: 0.5, angle: (2 * Math.PI) / 3 },
		{ kind: 'rear', width: 0.3, length: 0.32 }
	]);
	const emberGeometry = makeLayer([
		{ kind: 'jet', width: 0.13, length: 0.44 },
		{ kind: 'jet', width: 0.13, length: 0.44, angle: Math.PI / 2 }
	]);
	const glowGeometry = makeLayer([
		{ kind: 'jet', width: 0.34, length: 0.44 },
		{ kind: 'jet', width: 0.34, length: 0.44, angle: Math.PI / 2 },
		{ kind: 'rear', width: 0.38, length: 0.4 }
	]);

	// ── Materials ───────────────────────────────────────────────────────────────
	// Adapted from the example's two flames; MeshBasicNodeMaterial rather than
	// SpriteNodeMaterial because these are meshes, not sprites — and no
	// billboarding: the flame is car-local and shoots REARWARD, which a camera
	// -facing sprite can't express. Additive: a pop should glow, not occlude.
	// The .assign()s live inside Fn() — outside is silently dropped
	// (webgpu-notes §1.3). Style selects are branchless (step/mix): isBall/
	// isBurn pick stretch, noise speed, core size and ember gain per pop.
	//
	// Fat by design: the shape warp compresses x only ×2.1 (was ×3 — that is
	// what made the first cut read as a thin blade), exponents are lower, and
	// the alpha edge is wider, so the flame body is gassy rather than cut out.

	function makeFlameMaterial(dyn: DynUniforms) {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		material.colorNode = Fn(() => {
			const isBall = step(1.5, uStyle).toVar();
			const isBurn = step(0.5, uStyle).mul(oneMinus(isBall)).toVar();
			// CRACK: tall thin warp + fast noise. BURN: milder warp, slow roll.
			// BALL: nearly round + a fat white core.
			const stretchY = mix(mix(float(2.1), float(1.8), isBurn), float(1.05), isBall);
			const noiseSpeed = mix(mix(float(1.6), float(0.6), isBurn), float(1), isBall);
			const seed = aSeed.add(dyn.phase).toVar();

			const mainUv = uv().toVar();
			mainUv.assign(spherizeUV(mainUv, 10).mul(0.62).add(0.19));
			mainUv.assign(mainUv.pow(vec2(1, stretchY)));
			mainUv.assign(mainUv.mul(2, 1).sub(vec2(0.5, 0)));

			const gradient1 = sin(uTime.mul(10).mul(noiseSpeed).sub(mainUv.y.mul(TWO_PI).mul(2))).toVar();
			const gradient2 = mainUv.y.smoothstep(0, 1).toVar();
			mainUv.x.addAssign(gradient1.mul(gradient2).mul(0.2));

			const cellularUv = mainUv
				.mul(0.5)
				.add(vec2(seed, uTime.negate().mul(0.5).mul(noiseSpeed)))
				.mod(1);
			const cellularNoise = texture(cellularTex, cellularUv, 0)
				.r.oneMinus()
				.smoothstep(0, 0.5)
				.oneMinus();
			cellularNoise.mulAssign(gradient2);

			const shape = mainUv.sub(0.5).mul(vec2(2.1, 1.7)).length().oneMinus().toVar();
			shape.assign(shape.sub(cellularNoise));

			const gradientColor = mix(
				texture(gradientTex, vec2(saturate(shape), 0)),
				texture(nitroGradientTex, vec2(saturate(shape), 0)),
				uNitro
			);
			const core = shape.step(float(0.74).sub(isBall.mul(0.24)));
			const color = mix(gradientColor, vec3(1), core);
			const flicker = sin(uTime.mul(37).add(seed.mul(12)))
				.mul(0.25)
				.add(0.85);
			const alpha = shape.smoothstep(0, 0.42).mul(dyn.intensity).mul(flicker);
			return vec4(color.rgb, alpha);
		})();
		return material;
	}

	function makeEmberMaterial(dyn: DynUniforms) {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		material.colorNode = Fn(() => {
			const isBall = step(1.5, uStyle).toVar();
			const isBurn = step(0.5, uStyle).mul(oneMinus(isBall)).toVar();
			const noiseSpeed = mix(mix(float(1.6), float(0.6), isBurn), float(1), isBall);
			const emberGain = mix(mix(float(0.6), float(1.0), isBurn), float(1.5), isBall);
			const seed = aSeed.add(dyn.phase).toVar();

			const mainUv = uv().toVar();
			mainUv.assign(spherizeUV(mainUv, 10).mul(0.6).add(0.2));
			mainUv.assign(mainUv.abs().pow(vec2(1, 3)).mul(mainUv.sign()));
			mainUv.assign(mainUv.mul(2, 1).sub(vec2(0.5, 0)));

			const perlinUv = mainUv.add(vec2(seed, uTime.negate().mul(noiseSpeed))).mod(1);
			const perlinNoise = texture(perlinTex, perlinUv, 0).sub(0.5);
			mainUv.x.addAssign(perlinNoise.x.mul(0.5));

			const gradient1 = sin(uTime.mul(10).mul(noiseSpeed).sub(mainUv.y.mul(TWO_PI).mul(2)));
			const gradient2 = mainUv.y.smoothstep(0, 1);
			const gradient3 = oneMinus(mainUv.y).smoothstep(0, 0.3);
			mainUv.x.addAssign(gradient1.mul(gradient2).mul(0.2));

			const cellularUv = mainUv.add(vec2(seed, uTime.negate().mul(1.5).mul(noiseSpeed))).mod(1);
			const cellularNoise = texture(cellularTex, cellularUv, 0).r.oneMinus().smoothstep(0.25, 1);

			const shape = step(mainUv.sub(0.5).mul(vec2(6, 1)).length(), 0.5).toVar();
			shape.assign(shape.mul(cellularNoise));
			shape.mulAssign(gradient3);
			shape.assign(step(0.01, shape));

			// White-hot core with a warm rim (icy under nitrous), not the example's pure white.
			const color = mix(mix(vec3(1, 0.82, 0.55), vec3(0.55, 0.78, 1), uNitro), vec3(1), shape);
			const alpha = shape.mul(dyn.intensity).mul(0.9).mul(emberGain);
			return vec4(color, alpha);
		})();
		return material;
	}

	/** The ignition halo: no noise, just a soft hot centre that flares and dies. */
	function makeGlowMaterial(dyn: DynUniforms) {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		material.colorNode = Fn(() => {
			const r = uv().sub(0.5).mul(vec2(2.0, 1.7)).length().saturate().toVar();
			const falloff = oneMinus(r).pow(2.4).toVar();
			// Near-white hot centre falling off to deep orange (deep blue under nitrous).
			const color = mix(
				mix(vec3(1, 0.42, 0.15), vec3(0.15, 0.45, 1), uNitro),
				mix(vec3(1, 0.93, 0.82), vec3(0.82, 0.93, 1), uNitro),
				falloff
			);
			const alpha = falloff.mul(dyn.flash).mul(0.65);
			return vec4(color, alpha);
		})();
		return material;
	}

	// ── Per-tip rigs ────────────────────────────────────────────────────────────

	function makeTip(position: THREE.Vector3) {
		const dyn: DynUniforms = { intensity: uniform(0), phase: uniform(0), flash: uniform(0) };
		const group = new THREE.Group();
		group.position.copy(position);
		group.visible = false; // the task shows it when a pop lands
		const flame = new THREE.Mesh(flameGeometry, makeFlameMaterial(dyn));
		const ember = new THREE.Mesh(emberGeometry, makeEmberMaterial(dyn));
		const glow = new THREE.Mesh(glowGeometry, makeGlowMaterial(dyn));
		flame.frustumCulled = false; // scaling quads from a task — never cull
		ember.frustumCulled = false;
		glow.frustumCulled = false;
		group.add(glow, flame, ember);
		return {
			group,
			dyn,
			materials: [flame.material, ember.material, glow.material] as THREE.Material[]
		};
	}

	const tipL = makeTip(TIP_L);
	const tipR = makeTip(TIP_R);

	// The pop light (see the constants above for the mounting rules). Colour
	// crossfades to the nitrous palette with the flames, so a blue bang throws
	// blue light. Pre-allocated ends — `lerpColors` writes in place, no allocation
	// in the task.
	const POP_LIGHT_WARM = new THREE.Color(1, 0.45, 0.18);
	const POP_LIGHT_COLD = new THREE.Color(0.18, 0.45, 1);
	// `color.copy`, not a hex in the ctor: the ctor's hex path runs sRGB → working
	// space, while `new Color(r, g, b)` sets working-space components directly —
	// passing `WARM.getHex()` would round-trip through 8-bit sRGB for nothing.
	const popLight = new THREE.PointLight(0xffffff, 0, POP_LIGHT_DISTANCE, POP_LIGHT_DECAY);
	popLight.color.copy(POP_LIGHT_WARM);
	popLight.castShadow = false; // six shadow renders; and it is in the cache key
	popLight.position.set(0, TIP_L.y, TIP_L.z + POP_LIGHT_BEHIND);

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

	// ── Smoke ──────────────────────────────────────────────────────────────────
	// WORLD-ANCHORED on purpose: parented to the scene (an $effect below), spawned
	// at the tip's world position, so a puff hangs in the air while the car drives
	// away. NORMAL blending: smoke DIMS what is behind it, the opposite job to the
	// additive flames.
	//
	// ONE MESH, ONE MATERIAL, ONE DRAW CALL (fx/puffPool.ts). This used to be 16
	// meshes with 16 material instances — 16 separate first-render shader builds
	// (the first-pop hitch, which the boot-warm window below only ever hid for
	// ONE of them) and up to 16 transparent draw calls. The pool's mesh is always
	// in the graph, so its pipeline compiles on the scene's first frame; the warm
	// window that remains covers only the tips.
	/** 1/s — how fast a puff's lateral drift bleeds off. */
	const SMOKE_DRAG = 1.7;
	const smokeRoot = new THREE.Group();
	const smoke = createPuffPool({
		count: 16,
		lit: false,
		color: [0.3, 0.29, 0.28], // graphite — the flames' colour, cooled
		alphaPeak: 0.42,
		fadeOut: 1.6,
		roilScale: 1.6,
		roilDrift: [0.22, 0.13],
		clumpScale: 2.4,
		onTextureLoad: () => invalidate()
	});
	smokeRoot.add(smoke.mesh);

	// Scene-root parenting via effect — covers unmount AND any scene teardown.
	$effect(() => {
		scene.add(smokeRoot);
		return () => scene.remove(smokeRoot);
	});

	const _w = new THREE.Vector3();

	/** Cough one puff at a tip's world position — called by fire() with the same
	 * per-tip shares as the bang, so the pipe that reads loudest smokes most. */
	function spawnSmoke(tip: THREE.Group, strength: number): void {
		tip.getWorldPosition(_w); // updates world matrices on the way
		const e = tip.matrixWorld.elements;
		const rx = e[8];
		const rz = e[10]; // local +Z — REAR — in world
		// Inherit a lagged share of the car's motion, plus the rearward jet: at
		// speed the two nearly cancel, which is exactly right — the puff hangs
		// where it was coughed while the car leaves it behind.
		const v = carSim.speedMs * UNITS_PER_METER * 0.3;
		const jet = 2.0 + 1.8 * Math.random();
		smoke.spawn(
			_w.x,
			_w.y,
			_w.z,
			rx * (jet - v) + (Math.random() - 0.5) * 0.5,
			0.9 + 0.6 * Math.random(),
			rz * (jet - v) + (Math.random() - 0.5) * 0.5,
			0.9 + 0.5 * Math.random(),
			strength,
			0.24 + 0.2 * strength,
			(1.0 + 1.1 * strength) * (0.8 + 0.4 * Math.random())
		);
	}

	// ── Trigger ─────────────────────────────────────────────────────────────────

	let clock = 0;
	let energyL = 0;
	let energyR = 0;
	let prevGear = 1;
	let prevLimiting = false;
	// Per-pop character (replaced every time a pop lands; a fresh pop mid-decay
	// simply takes over, which is exactly what a limiter stutter looks like).
	let decayRate = 6.5;
	let lenMul = 1;
	let wMul = 1;
	// The queued second bang (anti-lag stutter): energy + countdown.
	let pending = 0;
	let pendingTimer = 0;
	// Seconds since each tip last ignited — drives the flash (glow + width
	// blow-up), which must lead the flame and die much faster than it.
	let ageL = 99;
	let ageR = 99;
	// Boot warm window, in seconds of task time: forces both tips VISIBLE at zero
	// alpha for the first moments after mount, so their six materials' pipelines
	// compile at scene entry — behind the transition veil — instead of hitching
	// the FIRST pop. The per-frame visibility write in the visual task below
	// would otherwise hide them before a frame ever rendered. (The smoke pool no
	// longer needs warming: its single mesh is permanently in the graph.)
	let warm = 0.3;

	/** Roll a pop: style, per-tip shares, per-tip noise phase, maybe a bang-bang. */
	function fire(amount: number): void {
		const roll = Math.random();
		const styleIdx = roll < 0.42 ? 0 : roll < 0.75 ? 1 : 2;
		const style = POP_STYLES[styleIdx];
		uStyle.value = styleIdx;

		const amp = amount * (style.amp[0] + Math.random() * (style.amp[1] - style.amp[0]));
		decayRate = style.decay * (0.85 + 0.3 * Math.random());
		lenMul = style.len[0] + Math.random() * (style.len[1] - style.len[0]);
		wMul = style.w * (0.9 + 0.2 * Math.random());

		// Mostly both pipes, sometimes basically one — a real corner-car fires
		// unevenly, and it reads better than a mirrored pair.
		const oneSided = Math.random() < ONE_SIDED_CHANCE;
		const bigSideRight = Math.random() < 0.5;
		const shareL = oneSided
			? bigSideRight
				? 0.12 + 0.1 * Math.random()
				: 1
			: 0.55 + 0.45 * Math.random();
		const shareR = oneSided
			? bigSideRight
				? 1
				: 0.12 + 0.1 * Math.random()
			: 0.55 + 0.45 * Math.random();
		energyL = Math.min(energyL + amp * shareL, ENERGY_CAP);
		energyR = Math.min(energyR + amp * shareR, ENERGY_CAP);
		ageL = 0;
		ageR = 0;
		tipL.dyn.phase.value = Math.random();
		tipR.dyn.phase.value = Math.random();

		// Slide the single pop light toward whichever pipe banged harder — this is
		// how one light keeps the one-sided pops' asymmetry (see POP_LIGHT_*). A
		// mirrored pop lands it dead centre, a one-sided one lands it on that pipe.
		popLight.position.x = TIP_L.x + (TIP_R.x - TIP_L.x) * (shareR / (shareL + shareR));

		// Voice it — same energy roll, same dominant pipe, so the bang comes from
		// the flame that reads loudest (carAudio picks/jitters the take).
		triggerExhaustPop(clamp(amp, 0, 1), shareR >= shareL);

		// Smoke follows the bang, sized by the same per-tip shares.
		spawnSmoke(tipL.group, clamp(amp * shareL, 0, 1));
		spawnSmoke(tipR.group, clamp(amp * shareR, 0, 1));

		if (style.dbl > 0 && Math.random() < style.dbl && pendingTimer <= 0) {
			pending = amount * 0.55;
			pendingTimer = 0.06 + 0.07 * Math.random();
		}
	}

	// ── The trigger runs at the PHYSICS rate; the VISUALS run once a frame ──────
	//
	// Only the edge detection needs the physics rate. A limiter bounce is a
	// rising edge of `carSim.limiting` that can come and go inside a single
	// rendered frame, so polling it per frame would silently drop bangs — that
	// is the whole reason this half stays in the physics task.
	//
	// Everything else used to live here too, and that was a real cost: the
	// simulation stage runs `ceil(accumulator / rate)` substeps per frame, so at
	// the 200 Hz the scene ran on then it was 4/3/3 per frame at 60 fps — the
	// uniform writes, the group scale, the whole smoke pool update and an
	// `invalidate()` all paid 3–4× per drawn frame for one frame's worth of
	// visible change. Worse, `clock` advanced by the SUBSTEP total (20 ms /
	// 15 ms / 15 ms), so the flame's own noise animation pulsed on a 20 Hz beat
	// that had nothing to do with anything. The default rate is 60 now, but
	// `ceil` keeps the count uneven at EVERY rate — the split is the fix, not
	// the number.
	usePhysicsTask((delta) => {
		if (pendingTimer > 0) {
			pendingTimer -= delta;
			if (pendingTimer <= 0) {
				pendingTimer = 0;
				const bang = pending;
				pending = 0;
				fire(bang);
			}
		}

		if (carSim.gear !== prevGear) {
			if (carSim.gear >= 1 && prevGear > carSim.gear) {
				fire(POP_BASE + POP_RPM_GAIN * clamp(carSim.rpm / hw.limiterRpm, 0, 1));
			}
			prevGear = carSim.gear;
		}
		if (carSim.limiting && !prevLimiting) fire(LIMITER_POP);
		prevLimiting = carSim.limiting;
	});

	// The visual half. `{ before: autoRenderTask }` puts it in the render stage,
	// after Rapier's synchronization — so the tips are scaled and the puffs
	// billboarded against the pose and the camera that are about to be drawn.
	useTask(
		(delta) => {
			clock += delta;
			uTime.value = clock;

			const decay = Math.exp(-decayRate * delta);
			energyL *= decay;
			energyR *= decay;
			ageL += delta;
			ageR += delta;

			// Nitrous: crossfade the palette (blue at full flow) and floor both tips'
			// energy — a steady pilot jet instead of discrete pops, the purge torch.
			// max(), not add: a pop landing on top of the floor still reads as a bang.
			const nitro = clamp(carSim.nitrous, 0, 1);
			uNitro.value = nitro;
			if (nitro > 0.01) {
				const pilot = 0.32 + 0.2 * nitro;
				if (energyL < pilot) energyL = pilot;
				if (energyR < pilot) energyR = pilot;
			}

			const iL = clamp(energyL, 0, 1);
			const iR = clamp(energyR, 0, 1);
			// The ignition flash leads the flame: full at birth, gone in ~150 ms.
			const flashL = Math.exp(-ageL * FLASH_DECAY) * clamp(energyL * 1.6, 0, 1);
			const flashR = Math.exp(-ageR * FLASH_DECAY) * clamp(energyR * 1.6, 0, 1);
			tipL.dyn.intensity.value = iL;
			tipR.dyn.intensity.value = iR;
			// A floor under the flash too, so the glow halos stay faintly lit while
			// spraying (a pilot jet with no halo reads as a dim pop, not a lit pipe).
			tipL.dyn.flash.value = Math.max(flashL, nitro * 0.35);
			tipR.dyn.flash.value = Math.max(flashR, nitro * 0.35);

			// The pop light rides the loudest pipe's flash — the same value the glow
			// halo uses, nitrous floor included, so the light IS the bang and a spray
			// leaves a steady blue wash. Written unconditionally and BEFORE the
			// tips-visible early return below: `flash` decays smoothly to ~0 on its
			// own, so the lamp is self-clearing and can never be left glowing after
			// the tips have gone. The invalidate is already owed by the tips.
			const lightFlash = Math.max(tipL.dyn.flash.value, tipR.dyn.flash.value);
			popLight.intensity = lightFlash * POP_LIGHT_INTENSITY;
			if (lightFlash > 0) popLight.color.lerpColors(POP_LIGHT_WARM, POP_LIGHT_COLD, nitro);

			tipL.group.visible = iL > 0.02 || flashL > 0.02;
			tipR.group.visible = iR > 0.02 || flashR > 0.02;
			// Boot warm window (see `warm`): force the tips visible at their default
			// (zero-alpha) uniforms for the first moments, so the first REAL pop
			// doesn't pay their six pipeline compiles.
			if (warm > 0) {
				warm -= delta;
				tipL.group.visible = true;
				tipR.group.visible = true;
				// The `visible` invalidate immediately below covers the warm frames too.
			}
			// A visible flame is an animating visual — this component owns that
			// invalidate reason while a pop is alive (the driving case is already
			// covered by the chase camera; this covers a stationary rev-match).
			if (tipL.group.visible || tipR.group.visible) invalidate();

			// Smoke: drift, grow, billboard, die — updated BEFORE the early return
			// below, because a puff outlives its bang.
			if (smoke.update(delta, camera.current, SMOKE_DRAG)) invalidate();

			if (!tipL.group.visible && !tipR.group.visible) return;

			// Per-tip flicker at unrelated frequencies so the pair never pulses as
			// one; the jet axis (z) stretches harder than the width, and the flash
			// BLOWS the width up at ignition — the bang.
			const fL = 0.85 + 0.2 * Math.sin(clock * 53);
			const fR = 0.85 + 0.2 * Math.sin(clock * 41 + 2.1);
			const wL = (0.8 + 0.75 * iL) * wMul * (1 + flashL * 0.5);
			const wR = (0.8 + 0.75 * iR) * wMul * (1 + flashR * 0.5);
			const lenL = (0.4 + 1.25 * iL) * lenMul * (1 + flashL * 0.3);
			const lenR = (0.4 + 1.25 * iR) * lenMul * (1 + flashR * 0.3);
			tipL.group.scale.set(wL * fL, wL * fL, lenL * (0.9 + 0.2 * fL));
			tipR.group.scale.set(wR * fR, wR * fR, lenR * (0.9 + 0.2 * fR));
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	onDestroy(() => {
		flameGeometry.dispose();
		emberGeometry.dispose();
		glowGeometry.dispose();
		smoke.dispose();
		for (const tip of [tipL, tipR]) {
			for (const m of tip.materials) m.dispose();
		}
		popLight.dispose();
		gradientTex.dispose();
		nitroGradientTex.dispose();
		// cellularTex/perlinTex are SHARED across the scene's fx — never disposed
		// by one consumer (fx/noiseTextures.ts).
		for (const c of tipCones) c.geometry.dispose();
	});
</script>

<!-- Car-local, model metres, like its siblings. The light is ALWAYS here — never
     put it behind an {#if} or a `visible` toggle, or every lit material in the
     scene recompiles on the frame it appears (see POP_LIGHT_* above). -->
<T is={popLight} />
<T is={tipL.group} />
<T is={tipR.group} />
{#if DEBUG_TIPS}
	<T is={tipCones[0]} />
	<T is={tipCones[1]} />
{/if}
