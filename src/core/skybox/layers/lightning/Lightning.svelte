<script lang="ts">
	// Lightning: the `lightning` channel's renderer (DOCS/weather-system.md §17).
	//
	// A strike is the bolt, plus a flash published to `flashState` for the other sky
	// layers. CloudDeck.svelte is the flash's main consumer -- the deck lights up from
	// the inside, localized around the strike's azimuth and weighted by its own cloud
	// structure. That localized deck glow, not a screen wash, is where the drama lives.
	// The full-sky wash here is deliberately FAINT (an immersion cue, at most a tenth of
	// the already-halved envelope), and the shadowless flash light carries the scene.
	//
	// THE BOLT is a procedural noise path, ported from the classic perlin-lightning
	// construction: the channel's horizontal offset is a 1-D perlin function of height,
	// f(y), and the fragment shader draws it as DISTANCE TO PATH -- a thin bright core,
	// a tight glow, a broad soft halo -- with the width slope-compensated so steep
	// sections of the path do not pinch thin. A noise-wobbled gate decides how far down
	// the strike reaches, per seed. There is no per-strike geometry to rebuild, just
	// uniforms; the bolt is a single camera-anchored quad.
	//
	// THE THREE BANDS ARE DISJOINT, which is what lets each carry its own COLOUR. They
	// used to be nested smoothsteps summed on top of each other, so the core pixel was
	// core + glow + halo all at once and no band could be tinted without tinting the two
	// inside it. Subtracting each band from the next out (`glow = glowRaw - core`) makes
	// them an annulus set: a hot near-white core that clips to white through the additive
	// blend, a tight blue-violet glow around it, a broad cool halo beyond. That is the
	// photographic look -- and it is why `colorNode` carries the whole spatial structure
	// while `opacityNode` is left alone (see the note where the material is built).
	//
	// BOTH MESHES BLEND ADDITIVELY AND WRITE NO ALPHA, which is load-bearing rather than
	// tidy. They cover huge areas of the frame; the lens layers (RainLens, SnowLens) draw
	// last and sample the finished frame INCLUDING its alpha; and stock
	// `AdditiveBlending` is `src.a + dst.a` on the alpha channel. A layer carrying its
	// coverage in `colorNode` therefore emits src.a = 1 for every pixel it covers, lit or
	// not, and stamps a screen-sized rectangle of alpha into the frame -- which the wet
	// lens then read as "composite here at full wetness". That was the hard-edged
	// rectangle behind a strike: not the bolt at all, the rain lens wearing its outline.
	// See the blend flags where each material is built.
	//
	// WHY NO TWO BOLTS LOOK ALIKE. The path seed and the ground gate varied already, which
	// changed where the channel wandered but never what KIND of thing it was: every strike
	// was one unbranched squiggle of the same sinuosity, standing upright, at the same
	// distance, at the same size in frame. Four more per-strike uniforms fix that --
	// `uWander` (how much the channel meanders), `uLean` (a linear tilt, so it is not
	// always a vertical line), and three `uBranch` vec4s, each a fork that peels off the
	// main channel at its own height and side, grows its own wander as it separates, and
	// dies out before the ground. A bolt rolls one to three of them.
	//
	// DEPTH. `flashState.strikeDistance` was already rolled per strike, but only thunder
	// read it -- so a bolt the audio treated as a mile away drew at exactly the size and
	// brightness of one overhead. It now drives the quad's SCALE, the bolt's brightness,
	// the scene light's share and a per-strike tint: near strikes tower and read blue-
	// white, distant ones sit small and low with the red-shift of a long air path. The
	// quad is scaled about its BOTTOM edge rather than its centre, so a distant bolt sits
	// down near the horizon instead of shrinking toward the middle of the sky.
	//
	// None of that touches the photosafety envelope below: the distance term only ever
	// scales the scene light DOWN from the authored peak, never up.
	//
	// PHOTOSAFETY. Flash-induced seizures come from sharp, large-area luminance steps
	// (WCAG 2.3.1 fails at three general flashes within any one second). Every constant
	// below is chosen against that:
	//   - No step edges: every pulse attacks through a ~45-55 ms smoothstep ramp and
	//     decays exponentially. The bolt attacks faster (~12 ms) but it is a thin
	//     small-area element, not the frame.
	//   - Amplitude: the sky/scene envelope peaks at ~0.55 for bolt strikes and ~0.43 for
	//     sheets, and the wash multiplies that by at most 0.1.
	//   - Density: at most 2 pulses per strike, at least 0.6 s between event starts, and
	//     re-strikes wait 0.45 s -- worst case stays under the three-flashes-per-second
	//     line with margin, and every ramp is soft on top of that.
	// To tone it down further, lower `flashIntensity` and the WASH_* / envelope constants;
	// do not shorten the attack times.
	//
	// TIMING. The channel is an intensity, not an event stream, so this component runs
	// the scheduler: mean inter-event interval falls from ~11 s at the channel's floor to
	// ~2 s at full storm. Two kinds of event: BOLT strikes (path + flash, can re-strike
	// the same channel a few hundred ms later -- real storms do, and the repeat reads as
	// the channel flickering rather than as a new strike, which is why a re-strike
	// inherits the bearing, the distance AND the path uniforms instead of rolling them)
	// and SHEET strikes (in-cloud flash with no bolt, softer and slower -- cheap
	// frequency that never strobes).
	//
	// WHERE THEY STRIKE. A uniform pick over the compass puts most bolts behind the
	// player, and a bolt you never see may as well not exist. So azimuths are biased
	// toward the camera's forward direction (triangular spread, dense ahead), and both
	// the bolt and the flash light are re-anchored on the active camera every frame, as
	// Rain is -- a strike holds a fixed BEARING wherever the player stands, instead of
	// living around the world origin. A quarter of strikes still land anywhere on the
	// compass; those still register through the deck glow, the wash and the scene light.
	//
	// THE LIGHT STAYS MOUNTED at intensity 0. Toggling a light's visibility changes
	// three's lights-state hash and recompiles every lit material -- a stutter on every
	// strike. A zero-intensity light costs a uniform slot and nothing else.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { DirectionalLight, Mesh } from 'three/webgpu';
	import {
		Fn,
		Loop,
		float,
		floor,
		fract,
		mix,
		smoothstep,
		sin,
		uniform,
		uv,
		vec3
	} from 'three/tsl';
	import { clamp01, descriptor, lerp, mulberry32 } from '../../model';
	import { domeVertexNode, skyLayerMaterial, SKY_LAYER_USERDATA } from '../skyLayer';
	import { flashState, type StrikeKind } from './flashState';

	interface Props {
		/** Horizontal distance of the bolt quad from the active camera. Inside the dome. */
		distance?: number;
		/**
		 * Peak intensity of the flash light. SUN_INTENSITY is 4.75 for scale; 2.5 puts a
		 * full strike at roughly half of noon daylight for a fraction of a second.
		 */
		flashIntensity?: number;
		/** Bolt geometry: top / bottom height in the bolt's local (camera-anchored) plane. */
		boltTop?: number;
		boltBottom?: number;
		seed?: number;
	}

	let {
		distance = 750,
		flashIntensity = 2.5,
		boltTop = 380,
		boltBottom = -50,
		seed = 20260831
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let bolt = $state.raw<Mesh>();
	let overlay = $state.raw<Mesh>();
	let flashLight = $state.raw<DirectionalLight>();

	// Captured once on purpose: the seed is an authored constant and re-reading it
	// reactively would rebuild the RNG mid-session.
	// svelte-ignore state_referenced_locally
	const rng = mulberry32(seed);

	// ── Photosafety constants ──────────────────────────────────────────────────────
	// See the header. These bound the worst case no matter what the scheduler rolls.
	/** Seconds between event starts, hard floor. Keeps any rolling 1 s window ≤ 2 events. */
	const MIN_EVENT_GAP_S = 0.6;
	/** Delay before a re-strike of the same channel, in seconds. */
	const RESTRIKE_DELAY_S = [0.45, 0.9] as const;
	/** Sky-wash ceiling at full cloud cover. The wash is an accent, not the effect. */
	const WASH_MAX = 0.1;
	const WASH_MIN = 0.05;
	/** How much of a bolt strike's pulse amplitude reaches the sky/scene envelope. */
	const BOLT_SKY_SCALE = 0.55;
	/** Sheets are their own amplitude (below BOLT_SKY_SCALE) and light the scene less. */
	const SHEET_LIGHT_SCALE = 0.45;

	// ── Depth ──────────────────────────────────────────────────────────────────────
	/**
	 * The range a bolt's distance is rolled over, world units. Also the range the visual
	 * terms are interpolated across, so the bolt you see and the thunder you hear agree
	 * about which strike it was.
	 */
	const BOLT_NEAR = 200;
	const BOLT_FAR = 1500;
	/** Quad scale at the two ends. 1 is the authored `boltTop..boltBottom` span. */
	const SCALE_NEAR = 1.3;
	const SCALE_FAR = 0.42;
	/** How much of the bolt's own brightness survives at each end. */
	const DIM_NEAR = 1;
	const DIM_FAR = 0.5;
	/**
	 * How much of the scene light a strike takes, by distance. NEAR IS 1, NOT MORE: this
	 * term may only ever attenuate the authored peak, or it would be a photosafety change
	 * wearing a lighting change's clothes.
	 */
	const LIGHT_NEAR = 1;
	const LIGHT_FAR = 0.45;

	// ── Strike state ───────────────────────────────────────────────────────────────
	// Plain variables: written and read only by the task, so reactive proxies would just
	// add cost. One strike is live at a time -- overlapping envelopes from different
	// azimuths read as a strobe fault.
	type Pulse = {
		t0: number;
		amp: number;
		tau: number;
		/** Bolt attack: thin element, snappy is safe and reads best. */
		attackBolt: number;
		/** Sky/scene attack: large-area, so this is the photosafety-critical one. */
		attackSky: number;
	};
	type Strike = {
		kind: StrikeKind;
		startMs: number;
		/** Horizontal bearing from the camera, radians -- where the bolt is re-anchored. */
		azimuth: number;
		dir: { x: number; y: number; z: number };
		pulses: Pulse[];
		durationS: number;
		/** How much of the envelope the scene light takes (sheets and far bolts are gentler). */
		lightScale: number;
		/** Quad scale, from the strike's distance. Applied about the quad's bottom edge. */
		boltScale: number;
		/** Brightness the bolt keeps at this distance. */
		boltDim: number;
		/** The rolled distance itself -- kept so a re-strike can resume the same channel. */
		distance: number;
	};

	let nowMs = 0;
	let strike: Strike | null = null;
	let nextStrikeAtMs = Infinity;
	/**
	 * Set when a bolt strike rolls a re-strike: the next strike RESUMES this channel
	 * instead of rolling a new one, because a channel that flickers is the same channel.
	 *
	 * It carries the distance, not just the bearing. Distance drives the quad's scale, so
	 * a re-strike that re-rolled it would jump in size between flickers at a fixed
	 * bearing -- two different bolts in a row, which is the exact reading this exists to
	 * avoid. The path uniforms are left alone for the same reason (see `beginStrike`).
	 */
	let restrike: {
		dir: { x: number; y: number; z: number };
		azimuth: number;
		distance: number;
	} | null = null;
	// Scratch for the camera's forward direction -- the task must not allocate.
	const camDir = new THREE.Vector3();

	const scheduleNext = (channel: number) => {
		const meanS = lerp(11, 2, channel);
		const at = nowMs + meanS * (0.45 + rng() * 1.1) * 1000;
		nextStrikeAtMs = Math.max(nowMs + MIN_EVENT_GAP_S * 1000, at);
	};

	/** The camera's forward bearing; random if the view points too steeply to have one. */
	const forwardAzimuth = (): number => {
		camera.current.getWorldDirection(camDir);
		const horizontal = camDir.x * camDir.x + camDir.z * camDir.z;
		return horizontal > 1e-4 ? Math.atan2(camDir.x, camDir.z) : rng() * Math.PI * 2;
	};

	/**
	 * WHERE a strike lands. Three quarters biased toward the forward bearing with a
	 * triangular spread ((rng+rng-1) is dense at the centre, thin at the edges, ~±97°);
	 * one quarter anywhere on the compass so the storm does not feel like it is
	 * performing for the player. Off-view strikes still register through the deck glow,
	 * the wash and the scene light.
	 */
	const nextAzimuth = (): number =>
		rng() < 0.25 ? rng() * Math.PI * 2 : forwardAzimuth() + (rng() + rng() - 1) * 1.7;

	/**
	 * One pulse at elapsed time `s`. Smoothstep attack then exponential decay -- the
	 * curve is C1-continuous, so there is no step edge anywhere for the eye to catch.
	 */
	const pulseValue = (s: number, p: Pulse, attack: number, decayScale: number): number => {
		if (s < p.t0) return 0;
		const t = s - p.t0;
		const k = Math.min(1, t / attack);
		const rise = k * k * (3 - 2 * k);
		return p.amp * rise * Math.exp(-Math.max(0, t - attack) / (p.tau * decayScale));
	};

	// ── The bolt shader ────────────────────────────────────────────────────────────
	// Distance-to-path rendering on one camera-facing quad. The quad's local X is
	// normalized to ±1.5 (half of its width is 1.5 path units) and Y to 0..1 bottom-to-
	// top; the path wanders ±0.2 of that. All widths below are in those X units, so they
	// scale with the quad, which scales with `boltTop - boltBottom`.
	const uBolt = uniform(0);
	/** Domain offset of the path noise -- the per-strike fingerprint. */
	const uSeed = uniform(0);
	/** Where the wobbled ground gate cuts the channel off, as a fraction of height. */
	const uGate = uniform(0.12);
	/**
	 * How far the channel meanders, in path units. Was the hardcoded 0.4 that gave every
	 * strike the same sinuosity -- a different squiggle each time, but always a squiggle of
	 * the same character, which is most of why they read as one repeated bolt.
	 */
	const uWander = uniform(0.4);
	/**
	 * A linear tilt across the channel's height, so a bolt is not always a vertical line.
	 * Cheaper than any amount of extra noise and does more for the silhouette than any of
	 * it: the eye reads overall lean long before it reads wander.
	 */
	const uLean = uniform(0);
	/**
	 * The forks: (forkY, spread, seed, reach) apiece.
	 *
	 * `forkY` is where the branch leaves the main channel, `spread` its signed divergence
	 * per unit of descent, `seed` its own noise domain and `reach` how far below the fork it
	 * survives. REACH 0 IS A DEAD BRANCH -- that is how a strike rolls fewer than three
	 * without a second material or a branch count in the shader: the life term below is
	 * identically zero for every pixel, and the compiler sees the same code either way.
	 */
	const uBranch0 = uniform(new THREE.Vector4());
	const uBranch1 = uniform(new THREE.Vector4());
	const uBranch2 = uniform(new THREE.Vector4());
	/** Indexable, so rolling the forks is a loop rather than three copies of one block. */
	const branchUniforms = [uBranch0, uBranch1, uBranch2];
	/**
	 * Per-strike chromatic shift with distance -- cool blue-white near, red-shifted far by
	 * the long air path. Deliberately close to luminance-neutral: how BRIGHT a distant bolt
	 * is belongs to `boltDim`, and folding the two together would make either one impossible
	 * to tune alone.
	 */
	const uBoltTint = uniform(new THREE.Vector3(0.92, 0.98, 1.15));

	// The reference's 1-D noise family, verbatim: hash -> linear value noise -> 6
	// octaves of doubling frequency / halving amplitude. A factory, as Nebula's
	// makeField: the octave count is closed over, not passed as an Fn argument.
	const rand1 = Fn(([p]: [any]) => fract(sin(p).mul(75154.32912)));

	const noise1 = Fn(([pImmutable]: [any]) => {
		const p = float(pImmutable).toVar();
		const i = floor(p);
		const f = p.sub(i);
		return mix(rand1(i), rand1(i.add(1)), f);
	});

	const makePerlin1 = (octaves: number) =>
		Fn(([pImmutable]: [any]) => {
			const p = float(pImmutable).toVar();
			const r = float(0).toVar();
			const s = float(1).toVar();
			const w = float(1).toVar();
			Loop(octaves, () => {
				s.mulAssign(2);
				w.mulAssign(0.5);
				r.addAssign(w.mul(noise1(s.mul(p))));
			});
			return r;
		});

	const perlin1 = makePerlin1(6);
	/**
	 * Four octaves, for the terms where six buys nothing visible: a branch is thin, short
	 * and dimmer than the main channel, and the along-length flicker is a broad brightness
	 * wobble. The main channel keeps all six. This is the difference between the branches
	 * costing what the bolt already cost and costing twice it.
	 */
	const perlin1Fast = makePerlin1(4);

	/** THE PATH: the channel's horizontal offset at height `y`, a perlin wander plus lean. */
	const pathAt = (y: any) =>
		uWander.mul(perlin1(y.mul(2).add(uSeed)).sub(0.5)).add(uLean.mul(y.sub(0.5)));

	const buildBoltMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			blending: THREE.CustomBlending,
			side: THREE.DoubleSide
		});

		// PURE ADD, AND NOT ONE BIT OF DESTINATION ALPHA. This is `AdditiveBlending` with
		// its alpha half amputated, and the amputation is the whole point.
		//
		// three maps non-premultiplied `AdditiveBlending` to
		// `setBlend(SrcAlpha, One, One, One)` (WebGPUPipelineUtils.js) -- so the alpha
		// channel is `src.a + dst.a`, and a layer that leaves `opacityNode` unset emits
		// src.a = 1 for EVERY pixel it covers, lit or not. This quad covers most of the
		// frame. It was therefore stamping alpha = 1 across a screen-sized rectangle on
		// every strike, and `RainLens` -- which draws afterwards (renderOrder 10), samples
		// the finished frame as a vec4 and multiplies that sample's alpha into its own
		// wetness -- composited its blur at full strength inside the stamp and at the
		// frame's real alpha outside it. The bolt was invisible in the artifact: what you
		// saw was a hard-edged rectangle of over-blurred wet lens, and only while raining.
		//
		// It is a regression from moving the coverage out of `opacityNode` (see the note
		// where `colorNode` is set). That move is right; the alpha it left behind was not.
		// An emissive layer contributes light, never coverage, so the honest blend is
		// `dst.rgb + src.rgb` with `dst.a` untouched -- which also drops the RGB path's
		// dependency on src.a entirely, and with it any way for this to come back.
		material.blendEquation = THREE.AddEquation;
		material.blendSrc = THREE.OneFactor;
		material.blendDst = THREE.OneFactor;
		material.blendEquationAlpha = THREE.AddEquation;
		material.blendSrcAlpha = THREE.ZeroFactor;
		material.blendDstAlpha = THREE.OneFactor;

		// Far-plane depth pinning + frustumCulled={false}: the quad sits at 750 units
		// against a 144 far plane, exactly like the dome layers.
		material.vertexNode = domeVertexNode();

		// The three bands, each its own colour -- see the header on why they are disjoint.
		// Above 1.0 on the core because it should clip toward white through the additive
		// blend, which is what a lightning core does to the eye.
		const CORE_COLOR = vec3(1.16, 1.19, 1.24);
		const GLOW_COLOR = vec3(0.42, 0.62, 1.25);
		const HALO_COLOR = vec3(0.3, 0.45, 0.95);

		/**
		 * Halo radius and weight, in path units (half the quad is 1.5 of them).
		 *
		 * The radius is authored to die before the quad's border, and it no longer quite
		 * does: the channel's centre sits up to `uWander/2 + uLean/2` off the quad's axis
		 * -- ±0.475 at the shipped ranges -- so the nearest border is 1.025 away, inside
		 * 1.1. What survives there is ~1% of the halo, which is a step of a few values out
		 * of 255 against a night sky rather than anything you would call a rectangle, and
		 * `edgeFade` below closes it without moving the authored look. Retune the radius
		 * only for the LOOK; the border is the envelope's job, not this number's.
		 */
		const HALO_RADIUS = 1.1;
		const HALO_WEIGHT = 0.16;

		/**
		 * One fork, as (core, glow) coverage. `b` is (forkY, spread, seed, reach).
		 *
		 * It leaves the main channel AT the main channel: `mainCenter` is the base, so at
		 * the fork height the two are the same line and the branch is attached rather than
		 * floating beside it. Below that it acquires its own wander over the first tenth of
		 * its length and diverges linearly at `spread`. Building it as an independent path
		 * and hoping the ends met was the obvious alternative and it does not work -- the
		 * seam is exactly where the eye is looking.
		 */
		const branchAt = (y: any, x: any, b: any, mainCenter: any) => {
			const forkY = b.x;
			const spread = b.y;
			const reach = b.w;
			// Positive below the fork, negative above it.
			const drop = forkY.sub(y);

			const own = float(0.3).mul(perlin1Fast(y.mul(2.6).add(b.z)).sub(0.5));
			const separation = drop.div(0.12).clamp(0, 1);
			const center = mainCenter.add(own.mul(separation)).add(spread.mul(drop));

			// Alive only below the fork, and only for `reach` after it. Both terms are
			// low-to-high smoothsteps: WGSL leaves `smoothstep` undefined for edge0 >= edge1,
			// and `reach - 0.1 < reach` holds even at reach 0, where this is 0 everywhere
			// and the branch is switched off entirely.
			const life = smoothstep(float(0), float(0.03), drop).mul(
				smoothstep(reach.sub(0.1), reach, drop).oneMinus()
			);

			// Thinner than the main channel, and thinning further as it runs out of charge.
			const width = float(0.011).mul(drop.div(reach.max(1e-3)).oneMinus().clamp(0.35, 1));
			const dist = x.sub(center).abs();
			const core = smoothstep(float(0), width, dist).oneMinus();
			const glowRaw = smoothstep(float(0), float(0.045), dist).oneMinus();

			return { core: core.mul(life), glow: glowRaw.sub(core).max(0).mul(life) };
		};

		const boltFn = Fn(() => {
			const uvN = uv();
			const x = uvN.x.mul(3).sub(1.5).toVar(); // ±1.5 across the quad
			const y = uvN.y.toVar(); // 0 at the bottom of the quad, 1 at the top

			// Path centre at this height, plus a hair higher for the slope term. The
			// slope compensation is what keeps steep sections of the channel from
			// pinching: the stroke's width grows with |df/dy| exactly as in the reference.
			const center = pathAt(y).toVar();
			const centerUp = pathAt(y.add(0.001));

			const dist = x.sub(center).abs().toVar();
			// Tapered toward the ground: a leader thins as it descends. The slope term is
			// added after the taper so a steep section is still protected from pinching.
			const coreW = float(0.018).mul(y.mul(0.32).add(0.7)).add(centerUp.sub(center).abs().mul(5));

			// DISJOINT BANDS. Each is the next one out minus the one inside it, so the
			// centre pixel is pure core and every band can carry its own colour.
			const core = smoothstep(float(0), coreW, dist).oneMinus();
			const glowRaw = smoothstep(float(0), float(0.07), dist).oneMinus();
			const glow = glowRaw.sub(core).max(0);
			const haloRaw = smoothstep(float(0), float(HALO_RADIUS), dist).oneMinus();
			const halo = haloRaw.sub(glowRaw).max(0);

			// ALONG-LENGTH FLICKER. A real channel does not burn evenly: segments run hotter
			// than their neighbours, which is the single most recognisable thing about a
			// photographed bolt after the branching. Centred on 1 so it redistributes
			// brightness along the channel rather than adding any.
			const hot = perlin1Fast(y.mul(9).add(uSeed.mul(2.3)))
				.mul(0.75)
				.add(0.64);

			const b0 = branchAt(y, x, uBranch0, center);
			const b1 = branchAt(y, x, uBranch1, center);
			const b2 = branchAt(y, x, uBranch2, center);
			const branchCore = b0.core.add(b1.core).add(b2.core);
			const branchGlow = b0.glow.add(b1.glow).add(b2.glow);

			// The halo is the air scattering the discharge, not the channel itself, so it
			// takes neither the flicker nor a branch contribution -- it is one soft bloom
			// around the whole event.
			const rgb = CORE_COLOR.mul(core.add(branchCore.mul(0.6)).mul(hot))
				.add(GLOW_COLOR.mul(glow.mul(0.45).add(branchGlow.mul(0.25)).mul(hot)))
				.add(HALO_COLOR.mul(halo.mul(HALO_WEIGHT)));

			// Vertical shaping: fade the channel out as it enters the deck at the top,
			// and cut it off near the ground along a noise-wobbled line whose height is
			// drawn per strike -- bolts that stop mid-air read as leaders, not as
			// geometry clipped by a quad edge.
			const topFade = smoothstep(float(0.86), float(1), y).oneMinus();
			const wobble = perlin1(x.mul(1.2).add(uGate.mul(4))).mul(0.03);
			const ground = smoothstep(uGate, uGate.add(0.05), y.add(wobble));

			// THE EDGE ENVELOPE. The quad is invisible geometry, so any pixel still lit at
			// its border draws the BORDER. HALO_RADIUS is authored to reach zero first and
			// very nearly does; this makes it structural instead of arithmetic, so the next
			// retune of the wander, the lean or the bands cannot quietly spend the margin
			// the way per-strike wander and lean already spent some of it. Only the sides
			// need it -- `topFade` closes the top, and `ground` closes the bottom (uGate is
			// at least 0.05 against a wobble of at most 0.03, so the gate is always shut by
			// the time y reaches 0).
			const edgeFade = smoothstep(float(0), float(0.05), uvN.x).mul(
				smoothstep(float(0.95), float(1), uvN.x).oneMinus()
			);

			return rgb.mul(topFade).mul(ground).mul(edgeFade);
		});

		// THE WHOLE EFFECT RIDES `colorNode`, AND `opacityNode` IS LEFT ALONE. Alpha is a
		// fixed-function blend factor, which the hardware CLAMPS to [0,1]. `uBolt` peaks at
		// 1.25 (the return stroke plus the linger), so driving opacity with it would
		// silently discard the top 25% of every strike's punch. Folded into the colour it
		// stays in HDR, which is also where the core's above-1.0 white belongs -- sky
		// layers are not tone mapped.
		//
		// The catch is that `opacityNode` unset does not mean "no alpha", it means alpha 1
		// over every pixel of the quad, and under stock `AdditiveBlending` that lands in
		// the frame. Hence the custom blend above: the colour goes in at One, so nothing
		// here is scaled by an alpha that is no longer carrying coverage, and no alpha goes
		// in at all.
		material.colorNode = boltFn().mul(uBoltTint).mul(uBolt);

		return material;
	};

	const uFlash = uniform(0);
	const uWash = uniform(0);

	const buildOverlayMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			side: THREE.BackSide,
			blending: THREE.CustomBlending
		});

		// `AdditiveBlending` for the colour (SrcAlpha, One -- the wash's coverage really is
		// its opacity here), and the same amputated alpha half as the bolt. This one leaves
		// no edge behind: the dome covers the whole frame, so all it did was raise the lens
		// layers' wetness slightly on every flash, everywhere at once. Fixed alongside the
		// bolt because it is the identical mistake and the next reader will look here.
		material.blendEquation = THREE.AddEquation;
		material.blendSrc = THREE.SrcAlphaFactor;
		material.blendDst = THREE.OneFactor;
		material.blendEquationAlpha = THREE.AddEquation;
		material.blendSrcAlpha = THREE.ZeroFactor;
		material.blendDstAlpha = THREE.OneFactor;

		material.vertexNode = domeVertexNode();

		// Slightly blue: lightning is hotter than daylight (its flash is ~9500 K against
		// the sun's ~5800 K), so the wash must never read warm.
		material.colorNode = vec3(0.82, 0.88, 1.05);
		material.opacityNode = uWash;
		return material;
	};

	// The quad: tall enough for the full channel (boltBottom..boltTop) and about twice as
	// wide, so the path's wander, its lean, the forks and the halo all fit inside with
	// room. NOTHING MAY BE LIT AT THE BORDER -- the quad is invisible geometry, so a lit
	// border draws the border. This comment used to assert that as a fixed budget (a ±0.2
	// wander against a 1.1 halo) and the budget went stale underneath it the moment wander
	// and lean became per-strike; that is where the rectangle came from. It is now
	// enforced in the shader instead, by HALO_RADIUS and the edge envelope.
	// Captured once on purpose, like every sky layer's geometry: authored constants in,
	// and a change re-mounts rather than rebuilding buffers under a live material.
	// svelte-ignore state_referenced_locally
	const boltHeight = boltTop - boltBottom;
	const boltGeometry = new THREE.PlaneGeometry(boltHeight * 2.1, boltHeight);
	const boltMaterial = buildBoltMaterial();
	const overlayGeometry = new THREE.SphereGeometry(950, 32, 16);
	const overlayMaterial = buildOverlayMaterial();

	const beginStrike = (cover: number, forceBolt = false) => {
		// Captured and cleared up front: four separate decisions below ask whether this
		// strike is resuming a channel, and exactly one place may consume the record.
		const resume = restrike;
		restrike = null;

		const kind: StrikeKind =
			!resume && !forceBolt && cover > 0.25 && rng() < 0.45 ? 'sheet' : 'bolt';

		// Direction: a re-strike resumes the channel (bearing and all); otherwise a fresh
		// view-biased azimuth. Sheets sit deeper in the deck -- they are the cell
		// backlighting itself, not a channel to the ground.
		let azimuth: number;
		let dir: { x: number; y: number; z: number };
		if (resume) {
			azimuth = resume.azimuth;
			dir = resume.dir;
		} else {
			azimuth = nextAzimuth();
			const elevation = kind === 'sheet' ? 0.55 + rng() * 0.25 : 0.5 + rng() * 0.3;
			dir = {
				x: Math.sin(azimuth) * Math.cos(elevation),
				y: Math.sin(elevation),
				z: Math.cos(azimuth) * Math.cos(elevation)
			};
		}

		// Pulses. Bolt: full-amplitude leader, a second return stroke 60% of the time.
		// Never a third -- see the photosafety constants. Sheet: one soft slow pulse.
		const pulses: Pulse[] =
			kind === 'bolt'
				? [
						{ t0: 0, amp: 1, tau: 0.06 + rng() * 0.04, attackBolt: 0.012, attackSky: 0.045 },
						...(rng() < 0.6
							? [
									{
										t0: 0.12 + rng() * 0.1,
										amp: 0.4 + rng() * 0.15,
										tau: 0.06 + rng() * 0.04,
										attackBolt: 0.012,
										attackSky: 0.045
									}
								]
							: [])
					]
				: [
						{
							t0: 0,
							amp: 0.3 + rng() * 0.13,
							tau: 0.2 + rng() * 0.1,
							attackBolt: 0,
							attackSky: 0.055
						}
					];

		// HOW FAR AWAY, rolled BEFORE anything that depends on it -- which is the whole
		// point. This used to be set at the bottom of the function purely to time thunder,
		// so the sound and the picture were two unrelated rolls and a bolt could crack
		// overhead while reading as a distant one. Everything visual now derives from it --
		// which is also why a re-strike must inherit it rather than roll again.
		const strikeDistance = resume
			? resume.distance
			: kind === 'sheet'
				? 1200 + rng() * 1800
				: BOLT_NEAR + rng() * (BOLT_FAR - BOLT_NEAR);
		// 1 at the near end of the range, 0 at the far.
		const nearness =
			kind === 'sheet' ? 0 : clamp01((BOLT_FAR - strikeDistance) / (BOLT_FAR - BOLT_NEAR));

		const last = pulses[pulses.length - 1];
		// Bolt paths outlive their pulses: the heated channel glows on for a moment
		// after the discharge (see the linger term in the task).
		const durationS =
			kind === 'bolt'
				? Math.max(1.05, last.t0 + last.tau * 4)
				: last.t0 + last.attackSky + last.tau * 4;

		strike = {
			kind,
			startMs: nowMs,
			azimuth,
			dir,
			pulses,
			durationS,
			// Sheets keep their own authored share; bolts take theirs from distance, and
			// only ever downward from the authored peak -- see LIGHT_NEAR.
			lightScale: kind === 'sheet' ? SHEET_LIGHT_SCALE : lerp(LIGHT_FAR, LIGHT_NEAR, nearness),
			boltScale: lerp(SCALE_FAR, SCALE_NEAR, nearness),
			boltDim: lerp(DIM_FAR, DIM_NEAR, nearness),
			distance: strikeDistance
		};
		flashState.direction.x = dir.x;
		flashState.direction.y = dir.y;
		flashState.direction.z = dir.z;

		// Publish the strike itself, for consumers that care about the EVENT rather than
		// the per-frame envelope -- thunder, today. A sheet is the inside of a cell lighting
		// up somewhere back in the deck, so it draws a farther distance than a bolt, which
		// is a channel to the ground near enough to see. That difference is most of why a
		// storm reads as having depth: near cracks, distant rumbles, and the gap between
		// the flash and the sound telling you which you just got.
		flashState.strikeDistance = strikeDistance;
		flashState.strikeKind = kind;
		flashState.strikeId++;

		// The whole per-strike variety of the bolt is uniforms; no geometry is rebuilt.
		// A RE-STRIKE ROLLS NONE OF IT. It is the same channel discharging a second time,
		// so it keeps the path, the forks and the tint it already had -- re-rolling them
		// gave a different bolt at the same bearing, which reads as two strikes rather
		// than as one channel flickering, and that is the whole point of a re-strike.
		if (kind === 'bolt' && !resume) {
			uSeed.value = rng() * 100;
			uGate.value = 0.05 + rng() * 0.2;
			// How much it meanders and which way it leans -- the two terms that decide
			// whether this reads as the same bolt again. The lean is triangular
			// ((rng+rng-1) is dense at the centre), so upright is common and a hard slant
			// is occasional rather than every other strike.
			uWander.value = 0.25 + rng() * 0.35;
			uLean.value = (rng() + rng() - 1) * 0.35;

			// One to three forks. The unused slots get reach 0, which the shader reads as
			// a dead branch -- no branch count ever crosses into the shader.
			const forks = 1 + Math.floor(rng() * 3);
			for (let i = 0; i < 3; i++) {
				const v = branchUniforms[i].value;
				if (i >= forks) {
					v.set(0, 0, 0, 0);
					continue;
				}
				const forkY = 0.25 + rng() * 0.55;
				// Never longer than the drop to the ground gate: a fork that outran the
				// main channel's own termination would hang below the bolt it came from.
				const reach = Math.min(0.1 + rng() * 0.3, forkY * 0.85);
				v.set(forkY, (rng() < 0.5 ? -1 : 1) * (0.15 + rng() * 0.35), rng() * 100, reach);
			}

			// Cool blue-white near, red-shifted far -- the long air path scatters the blue
			// out of a distant discharge exactly as it does a distant anything.
			uBoltTint.value.set(
				lerp(1.12, 0.92, nearness),
				lerp(0.95, 0.98, nearness),
				lerp(0.8, 1.15, nearness)
			);
		}
	};

	useTask(
		(delta) => {
			// `nowMs` advances by task deltas, so the scheduler depends on frames happening at
			// all. Safe here by construction: Lightning mounts only inside the procedural
			// branch, where Sky's and Rain's tasks invalidate every frame.
			nowMs += delta * 1000;
			const channel = clamp01(descriptor.weather.lightning);
			const cover = clamp01(descriptor.weather.cloudCover);

			// A manual strike request (Studio's Strike button) fires immediately, as a bolt,
			// even at a dead channel -- tuning the look must not mean waiting for a storm.
			if (flashState.strikeRequest) {
				flashState.strikeRequest = false;
				if (!strike) beginStrike(cover, true);
			}

			// Dead channel clears any pending strike so the next storm schedules fresh.
			if (channel <= 0.05) {
				nextStrikeAtMs = Infinity;
				restrike = null;
			} else if (!strike) {
				if (!Number.isFinite(nextStrikeAtMs)) scheduleNext(channel);
				else if (nowMs >= nextStrikeAtMs) beginStrike(cover);
			}

			let flash = 0;
			let boltGlow = 0;
			let lightScale = 1;
			if (strike) {
				const s = (nowMs - strike.startMs) / 1000;
				if (s >= strike.durationS) {
					// A bolt strike may immediately queue a re-strike of the same channel:
					// same direction, short delay. It reads as the channel flickering.
					if (strike.kind === 'bolt' && channel > 0.25 && rng() < 0.35) {
						restrike = {
							dir: strike.dir,
							azimuth: strike.azimuth,
							distance: strike.distance
						};
						nextStrikeAtMs = nowMs + lerp(RESTRIKE_DELAY_S[0], RESTRIKE_DELAY_S[1], rng()) * 1000;
					} else {
						scheduleNext(channel);
					}
					strike = null;
				} else {
					lightScale = strike.lightScale;
					// Sky/scene envelope: the pulses, sky-attacked, scaled down for bolts.
					// Sheets run their authored amplitude straight through.
					const skyScale = strike.kind === 'bolt' ? BOLT_SKY_SCALE : 1;
					for (const p of strike.pulses) {
						flash += pulseValue(s, p, p.attackSky, 1) * skyScale;
					}

					if (strike.kind === 'bolt') {
						let sum = 0;
						for (const p of strike.pulses) {
							sum += pulseValue(s, p, p.attackBolt, 0.8);
						}
						// LINGER: the channel's afterglow -- the path stays faintly
						// visible for ~a second after the discharge has ended, decaying.
						const linger = s > 0.08 ? 0.16 * Math.exp(-(s - 0.08) / 0.55) : 0;
						// Distance dims the bolt itself. Applied after the cap so the cap
						// stays what it always was -- a ceiling on the envelope, not a
						// ceiling that a near strike could sneak back up to.
						boltGlow = Math.min(1.25, sum + linger) * strike.boltDim;
					}

					// CAMERA-ANCHORED, as Rain is: re-derived from the active camera every
					// frame, so the bolt reads as sky (a fixed bearing and elevation wherever
					// the player stands) rather than as an object sitting near the world
					// origin. Y centres the quad on the authored top/bottom span.
					const cam = camera.current.position;
					if (strike.kind === 'bolt' && bolt && boltGlow > 0.01) {
						// SCALED ABOUT THE BOTTOM EDGE, which the quad's own origin cannot
						// do -- that is at its centre, so scaling it plainly would shrink a
						// distant bolt toward the middle of the sky, away from the ground it
						// is supposed to be hitting. Pinning the bottom at `boltBottom` and
						// putting the centre half a SCALED height above it stands every bolt
						// on the same line; at scale 1 it is the authored midpoint exactly.
						bolt.scale.setScalar(strike.boltScale);
						bolt.position.set(
							cam.x + Math.sin(strike.azimuth) * distance,
							cam.y + boltBottom + (boltHeight * strike.boltScale) / 2,
							cam.z + Math.cos(strike.azimuth) * distance
						);
						bolt.lookAt(cam);
					}
					if (flashLight && flash > 0.001) {
						// A DirectionalLight aims from its position at its TARGET, and the
						// target is not in the scene graph -- three only updates matrixWorld
						// for objects it knows about, so it is touched by hand, every frame.
						flashLight.position.set(
							cam.x + strike.dir.x * 40,
							cam.y + strike.dir.y * 40,
							cam.z + strike.dir.z * 40
						);
						flashLight.target.position.copy(cam);
						flashLight.target.updateMatrixWorld();
					}
				}
			}

			// Publish to the other sky layers FIRST -- CloudDeck's task reads this.
			flashState.flash = flash;

			uFlash.value = flash;
			uBolt.value = boltGlow;
			// The wash is an accent for immersion, not the effect: a fraction of the
			// already-halved envelope, scaled a touch by how much deck there is to
			// backlight. At full storm this peaks near 0.08 additive opacity.
			uWash.value = flash * lerp(WASH_MIN, WASH_MAX, cover);

			if (flashLight) flashLight.intensity = flash * flashIntensity * lightScale;
			if (overlay) overlay.visible = flash > 0.004;
			if (bolt) bolt.visible = strike !== null && strike.kind === 'bolt' && boltGlow > 0.01;

			if (flash > 0.003 || boltGlow > 0.003) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			boltGeometry.dispose();
			boltMaterial.dispose();
			overlayGeometry.dispose();
			overlayMaterial.dispose();
		};
	});
</script>

<!-- The bolt quad (renderOrder 2.6) draws over the cloud deck (2.5) and under the rain
     (3); the wash dome (4) draws over everything, very faintly. All depth-pinned to the
     far plane, so renderOrder is the only sort. The light is always mounted; see the
     header. -->
<T.Mesh
	bind:ref={bolt}
	geometry={boltGeometry}
	material={boltMaterial}
	renderOrder={2.6}
	frustumCulled={false}
	visible={false}
	userData={SKY_LAYER_USERDATA}
/>

<T.Mesh
	bind:ref={overlay}
	geometry={overlayGeometry}
	material={overlayMaterial}
	renderOrder={4}
	frustumCulled={false}
	visible={false}
	userData={SKY_LAYER_USERDATA}
/>

<T.DirectionalLight
	bind:ref={flashLight}
	castShadow={false}
	color="#b8ceff"
	intensity={0}
	userData={SKY_LAYER_USERDATA}
/>
