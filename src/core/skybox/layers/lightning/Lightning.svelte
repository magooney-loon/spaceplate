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
	// the channel flickering rather than as a new strike) and SHEET strikes (in-cloud
	// flash with no bolt, softer and slower -- cheap frequency that never strobes).
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
	import { flashState } from './flashState';

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
	type StrikeKind = 'bolt' | 'sheet';
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
	};

	let nowMs = 0;
	let strike: Strike | null = null;
	let nextStrikeAtMs = Infinity;
	// Set when a bolt strike rolls a re-strike: the next strike reuses this direction,
	// because a channel that flickers is the same channel.
	let restrikeDir: { x: number; y: number; z: number } | null = null;
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
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});

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
			const coreW = float(0.018)
				.mul(y.mul(0.32).add(0.7))
				.add(centerUp.sub(center).abs().mul(5));

			// DISJOINT BANDS. Each is the next one out minus the one inside it, so the
			// centre pixel is pure core and every band can carry its own colour.
			const core = smoothstep(float(0), coreW, dist).oneMinus();
			const glowRaw = smoothstep(float(0), float(0.07), dist).oneMinus();
			const glow = glowRaw.sub(core).max(0);
			const haloRaw = smoothstep(float(0), float(1.1), dist).oneMinus();
			const halo = haloRaw.sub(glowRaw).max(0);

			// ALONG-LENGTH FLICKER. A real channel does not burn evenly: segments run hotter
			// than their neighbours, which is the single most recognisable thing about a
			// photographed bolt after the branching. Centred on 1 so it redistributes
			// brightness along the channel rather than adding any.
			const hot = perlin1Fast(y.mul(9).add(uSeed.mul(2.3))).mul(0.75).add(0.64);

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
				.add(HALO_COLOR.mul(halo.mul(0.16)));

			// Vertical shaping: fade the channel out as it enters the deck at the top,
			// and cut it off near the ground along a noise-wobbled line whose height is
			// drawn per strike -- bolts that stop mid-air read as leaders, not as
			// geometry clipped by a quad edge.
			const topFade = smoothstep(float(0.86), float(1), y).oneMinus();
			const wobble = perlin1(x.mul(1.2).add(uGate.mul(4))).mul(0.03);
			const ground = smoothstep(uGate, uGate.add(0.05), y.add(wobble));

			return rgb.mul(topFade).mul(ground);
		});

		// THE WHOLE EFFECT RIDES `colorNode`, AND `opacityNode` IS LEFT ALONE. Under
		// `AdditiveBlending` three sets blendSrc to SrcAlpha, so what lands in the frame is
		// `colorNode * opacity` -- and alpha is a fixed-function blend factor, which the
		// hardware CLAMPS to [0,1]. `uBolt` peaks at 1.25 (the return stroke plus the
		// linger), so driving opacity with it would silently discard the top 25% of every
		// strike's punch. Folded into the colour instead it stays in HDR, which is also
		// where the core's above-1.0 white belongs -- sky layers are not tone mapped.
		material.colorNode = boltFn().mul(uBoltTint).mul(uBolt);

		return material;
	};

	const uFlash = uniform(0);
	const uWash = uniform(0);

	const buildOverlayMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending
		});

		material.vertexNode = domeVertexNode();

		// Slightly blue: lightning is hotter than daylight (its flash is ~9500 K against
		// the sun's ~5800 K), so the wash must never read warm.
		material.colorNode = vec3(0.82, 0.88, 1.05);
		material.opacityNode = uWash;
		return material;
	};

	// The quad: tall enough for the full channel (boltBottom..boltTop) and about twice
	// as wide, so the path's ±0.2 wander, the glow, and the broad halo all fit inside
	// with room -- the halo's smoothstep (1.1) reaches zero before the quad's edge
	// (nearest approach ~1.3), or the quad would clip it into a visible rectangle.
	// Captured once on purpose, like every sky layer's geometry: authored constants in,
	// and a change re-mounts rather than rebuilding buffers under a live material.
	// svelte-ignore state_referenced_locally
	const boltHeight = boltTop - boltBottom;
	const boltGeometry = new THREE.PlaneGeometry(boltHeight * 2.1, boltHeight);
	const boltMaterial = buildBoltMaterial();
	const overlayGeometry = new THREE.SphereGeometry(950, 32, 16);
	const overlayMaterial = buildOverlayMaterial();

	const beginStrike = (cover: number, forceBolt = false) => {
		const isRestrike = restrikeDir !== null;
		const kind: StrikeKind =
			!isRestrike && !forceBolt && cover > 0.25 && rng() < 0.45 ? 'sheet' : 'bolt';

		// Direction: a re-strike reuses the channel (bearing and all); otherwise a fresh
		// view-biased azimuth. Sheets sit deeper in the deck -- they are the cell
		// backlighting itself, not a channel to the ground.
		let azimuth: number;
		let dir = restrikeDir;
		restrikeDir = null;
		if (dir) {
			azimuth = Math.atan2(dir.x, dir.z);
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
		// overhead while reading as a distant one. Everything visual now derives from it.
		const strikeDistance =
			kind === 'sheet' ? 1200 + rng() * 1800 : BOLT_NEAR + rng() * (BOLT_FAR - BOLT_NEAR);
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
			lightScale:
				kind === 'sheet' ? SHEET_LIGHT_SCALE : lerp(LIGHT_FAR, LIGHT_NEAR, nearness),
			boltScale: lerp(SCALE_FAR, SCALE_NEAR, nearness),
			boltDim: lerp(DIM_FAR, DIM_NEAR, nearness)
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
		flashState.strikeId++;

		// The whole per-strike variety of the bolt is uniforms; no geometry is rebuilt.
		if (kind === 'bolt') {
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
				restrikeDir = null;
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
						restrikeDir = strike.dir;
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
						bolt.position.set(
							cam.x + Math.sin(strike.azimuth) * distance,
							cam.y + (boltTop + boltBottom) / 2,
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


<!-- {
  "questions": [
    {
      "question": "Forked branches are the biggest missing thing — real lightning is a dendritic channel, this draws one squiggle. How far do you want to take it?",
      "header": "Branching",
      "options": [
        {
          "label": "2-3 forks per bolt (Recommended)",
          "description": "Secondary channels peel off the main path at randomised heights, diverge as they descend, thin out and die before the ground. Per-strike random fork heights, sides and spread rates — so no two bolts share a silhouette. Modest shader cost."
        },
        {
          "label": "Full dendritic — forks with sub-forks",
          "description": "Branches that themselves branch, plus short dead-end stubs along the main channel. The most spectacular and the most expensive: roughly triples the distance-to-path evaluations per pixel."
        },
        {
          "label": "Keep it single-channel",
          "description": "Leave the silhouette alone and get the variety purely from scale, colour and along-length flicker."
        }
      ],
      "multiSelect": false
    },
    {
      "question": "Should a bolt's apparent size change with how far away it is? (The distance is already rolled for thunder timing — nothing visual uses it yet.)",
      "header": "Depth",
      "options": [
        {
          "label": "Yes — near bolts big, far ones small and hazy (Recommended)",
          "description": "Drive the quad's distance and scale off the same roll thunder uses. Near strikes tower and read blue-white; distant ones are small, dimmer and reddened by atmosphere. Big variety win, and it makes the flash-to-thunder gap finally agree with what you saw."
        },
        {
          "label": "Vary brightness and colour only",
          "description": "Keep every bolt the same size in frame, but let distant ones be dimmer and warmer. Safer compositionally — no bolt ever dominates or gets too small to notice."
        },
        {
          "label": "Leave it fixed",
          "description": "Every bolt stays at distance 750 as now."
        }
      ],
      "multiSelect": false
    },
    {
      "question": "What character should the bolt itself have?",
      "header": "Bolt look",
      "options": [
        {
          "label": "Photographic — hot white core, tight blue glow",
          "description": "Thin near-white core that clips to white through the additive blend, a tight blue-violet inner glow, broad faint halo. Adds along-length flicker so some segments run hotter than others, and a slight taper toward the ground. Reads like a long-exposure photograph."
        },
        {
          "label": "Stylised — thicker, more graphic",
          "description": "Chunkier channel with a stronger, wider glow and more saturated colour. Reads more like a game effect than a photograph — more legible at a glance, less realistic."
        },
        {
          "label": "Keep the current core/glow/halo balance",
          "description": "Only add the variety (branches, flicker, per-strike colour), leave the stroke weights as authored."
        }
      ],
      "multiSelect": false
    }
  ]
}

Your questions have been answered: "Forked branches are the biggest missing thing — real lightning is a dendritic channel, this draws one squiggle. How far do you want to take it?"="2-3 forks per bolt (Recommended)", "Should a bolt's apparent size change with how far away it is? (The distance is already rolled for thunder timing — nothing visual uses it yet.)"="Yes — near bolts big, far ones small and hazy (Recommended)", "What character should the bolt itself have?"="Photographic — hot white core, tight blue glow". You can now continue with these answers in mind.
 -->
