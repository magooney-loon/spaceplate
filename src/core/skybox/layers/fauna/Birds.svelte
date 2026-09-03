<script lang="ts">
	// Bird flocks as sky dressing -- a few distant flocks wheeling over the sky plus
	// some stray birds drifting between them, ported from three.js's
	// `webgpu_compute_birds` example and rescaled from its 800-unit murmuration to
	// ambient fauna you notice the way you notice real birds: mostly at the edge of
	// attention, wheeling far off against the clouds.
	//
	// WHY GPU COMPUTE, unlike every other particle layer here. Stars, Rain and Snow are
	// stateless -- each particle is a pure function of `time`, so a vertex node
	// synthesises motion at zero per-frame cost. Flocking is not: separation, alignment
	// and cohesion are O(n²) interactions between PERSISTENT neighbours, so each bird
	// carries position, velocity and an attitude vec4 (flap phase, roll, previous
	// heading) in `instancedArray` storage buffers that two compute passes integrate
	// every frame. Three buffers exactly, which is what fits under the default
	// `maxStorageBuffersInVertexStage` (App.svelte requests no `requiredLimits` — see the
	// attitude-vec4 note below) -- anything else a bird needs to remember goes in the
	// vec4, and anything that never changes goes in a plain vertex attribute. That is also
	// why this is the one layer that cannot run on the WebGL2 fallback (three's own example
	// is marked "TODO: Fix example with WebGL backend"): the task gates on the live backend
	// and the flock simply never mounts work elsewhere.
	//
	// FEW FLOCKS AND STRAYS FROM ONE PASS. Every bird carries its own FLOCK ANCHOR in a
	// read-only storage buffer, and the centre-pull targets that instead of a shared
	// origin -- so one compute pass serves several independent flocks (their anchors sit
	// far apart, well outside the ~12-unit interaction zone, so flocks never merge) plus
	// single birds anchored to points of their own. A strayed bird that crosses a
	// flock's zone briefly joins it, which reads as exactly what a stray does.
	//
	// THE ANCHOR IS A SEED, NOT A LEASH. A constant pull to a fixed point is a closed
	// orbit: with the speed floor, a flock laps the same circuit for as long as you
	// watch, which reads as birds on rails. The pull target instead WANDERS -- sums of
	// incommensurate sines seeded per flock, plus a smaller per-bird drift so the flock
	// is not a rigid formation -- and the pull strength itself breathes on a slow sine.
	// The paths are quasi-periodic: they never close, and no two flocks wander in
	// phase. Gust turbulence scaled by the wind channel rides on top.
	//
	// WHAT AN INDIVIDUAL BIRD DOES, which is where a flock stops reading as a particle
	// system. Three things, all of them per-bird and none of them in the reference:
	//   - IT BANKS. The reference's heading frame is yaw and pitch only, so its birds
	//     slide round their turns flat. Roll is driven off the yaw RATE, chased rather
	//     than snapped, and applied FIRST in the rotation chain because it turns about
	//     the bird's own forward axis. At this distance a wheeling flock is mostly read
	//     by its tilt.
	//   - IT GLIDES. Nothing beats its wings continuously. A slow per-bird burst cycle
	//     drops the flap to a held dihedral and back, overridden by a climb term -- a
	//     bird pulling up always beats.
	//   - IT HAS A SIZE. A seeded per-bird scale, so a flock reads as individuals at
	//     different depths rather than one stamped sprite repeated.
	//
	// BOUNDED, NOT JUST PLACED. The layout keeps the flocks far away, but distance is
	// enforced rather than hoped for: no bird may go below MIN_ALT (the ground plane
	// and the scene's furniture live there) or inside KEEP_OUT of the origin (the
	// cameras sit within ~13 of it) -- soft decelerations in the velocity pass, hard
	// clamps in the position pass. The centre-pull is likewise a spring that scales
	// with distance from the target, so weather bends a flock downwind but can never
	// carry it off.
	//
	// DESCRIPTOR-DRIVEN, like the weather it lives in:
	//   - DAY. Birds are diurnal. They fade out through twilight on the same
	//     `starVisibility` ramp that fades Stars in, so dusk hands the sky over.
	//   - STORMS. Real birds land before weather arrives; precipitation or fog thick
	//     enough grounds the flock. It cannot simply be fogged to the same effect --
	//     sky layers run `fog = false` by contract (skyLayer.ts) -- so the channel is
	//     read as visibility instead.
	//   - WIND. The weather's bearing pushes the flock downwind as an acceleration, so
	//     a rising wind first bends the flock and only later hides it.
	//   - LIGHT. The plumage rides the key-light hints: a dark end and a light end of
	//     the light's hue, mixed per bird by a seeded shade -- mostly near-black and
	//     mid-grey birds with a few pale ones, the mottle a real flock shows at
	//     distance, rather than one flat fill colour.
	//
	// Drawn UNDER the cloud deck (renderOrder 2.2, deck is 2.5): where the deck is
	// dense the birds go behind it, which is the look -- they are part of the
	// skybox's weather, not actors in front of it.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		cameraProjectionMatrix,
		cameraViewMatrix,
		clamp,
		Continue,
		cos,
		float,
		Fn,
		If,
		instancedArray,
		instanceIndex,
		length,
		Loop,
		mat3,
		max,
		mix,
		modelWorldMatrix,
		negate,
		normalize,
		positionLocal,
		sin,
		smoothstep,
		sqrt,
		uint,
		uniform,
		vec3,
		vertexIndex
	} from 'three/tsl';
	import { descriptor, mulberry32, smooth01, windAxisX, windAxisZ } from '../../model';
	import { instancedFloat, pinFarPlane, SKY_LAYER_USERDATA, skyLayerMaterial } from '../skyLayer';

	interface Props {
		/**
		 * Approximate total bird count -- the flock layout below takes shares of it.
		 * The velocity compute is O(count²), and at these numbers it is nothing; the
		 * constraint is the LOOK, which wants a handful of flocks, not a swarm.
		 */
		count?: number;
		/** Changing this reseeds the flocks, strays and plumage. */
		seed?: number;
	}

	let { count = 68, seed = 20260901 }: Props = $props();

	const { renderer, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	// ── Tuning ────────────────────────────────────────────────────────────────────
	// The reference example's feel at skybox scale: its wingspan-8 birds in an 800
	// cube with a 55-radius interaction zone become wingspan-2 birds in flocks a
	// dozen-odd units across, with a ~12.5-radius zone (~6 wingspans either way) and
	// its speed limit 9 (×15 at integration) becomes 2.2.
	const SPEED_LIMIT = 2.2;
	/** Birds never hover: a floor keeps strays flying their lazy loops instead of
	 *  damping onto their anchors as the centre-pull decays them. */
	const MIN_SPEED = 0.55;
	const INTEGRATION = 15;
	const SEPARATION = 3.5;
	const ALIGNMENT = 4.5;
	const COHESION = 4.5;
	/** Centre-pull toward the bird's own flock target, per second -- with a vertical
	 *  bias, because a flock flies as a slab rather than a cube. Breathes ±35% on a
	 *  slow sine, and SCALES with distance from the target: ×0.5 at the target,
	 *  rising to ×PULL_MAX from PULL_RANGE out. A spring rather than a constant
	 *  shove -- which is what lets weather BEND a flock downwind without ever being
	 *  able to carry it off (a constant-magnitude pull loses to any stronger wind). */
	const CENTER_PULL = 1.2;
	const PULL_RANGE = 15;
	const PULL_MAX = 10;
	const SLAB_Y = 1.8;
	/** THE TARGET WANDERS. A fixed anchor is a leash: with a constant pull and a speed
	 *  floor, a flock laps the same closed circuit for as long as you watch, which
	 * reads as birds on rails. The pull target instead drifts on sums of
	 *  INCOMMENSURATE sines (per flock, seeded from the anchor), so its path is
	 *  quasi-periodic and never closes. Amplitudes in world units, frequencies inline
	 *  in the shader and deliberately irrational against each other. Kept small
	 *  enough that wandering flocks stay clear of each other's zones. */
	const WANDER = 20;
	const WANDER_Y = 4;
	/** Per-bird drift of the pull target, so a flock is a loose aggregate rather than
	 *  a rigid formation riding one point. */
	const PER_BIRD_DRIFT = 3;
	/** Gust turbulence as acceleration: a base that sways even still air gently, plus
	 *  a wind-scaled term that tosses a flock in a gale. */
	const TURB_BASE = 0.3;
	const TURB_WIND = 1.2;
	/** Weather wind channel (0..1) to acceleration. Sized to bend, not abduct: with
	 *  the spring pull above, even full wind only leans a flock ~40 units downwind of
	 *  its target -- and heavier weather grounds the birds anyway. */
	const WIND_GAIN = 3.5;
	/** THE HARD BOUNDARIES. Birds are sky, never scene: no bird below MIN_ALT (the
	 *  ground plane is y=0 and the scene's furniture lives under this) and none
	 *  inside KEEP_OUT of the origin (the stock cameras sit within ~13 of it, so 60
	 *  keeps every bird clearly distant). Enforced as hard clamps in the position
	 *  pass, with soft decelerations in the velocity pass so a clamp is a slowdown,
	 *  not a slide. Neither should ever fire at these anchors -- the layout already
	 *  sits far outside both; they are the guarantee, not the mechanism. */
	const MIN_ALT = 12;
	const KEEP_OUT = 60;
	/** Soft-range gains: the lift ramps in below y=20 (the lowest flock's deepest wander
	 *  is ~21.8 -- see the altitude note on FLOCKS -- so normal flight never touches it);
	 *  the radial push ramps in inside KEEP_OUT + 30. */
	const LIFT = 2.5;
	const CORE_PUSH = 4;
	const FLAP_AMP = 1.25;
	const FLAP_RATE_XZ = 8;
	const FLAP_RATE_Y = 12;
	/** BANKING. A bird rolls INTO its turn, and how far depends on how fast it is
	 *  turning -- so the target attitude is driven by the yaw RATE, not the heading.
	 *  `GAIN` is radians of bank per radian/second of turn, `MAX` the hard limit (~54
	 *  degrees, a strong but real bank) because a frame-sized spike out of the gust
	 *  turbulence must never flip a bird onto its back, and `RESPONSE` is how quickly
	 *  the roll chases that target -- which doubles as the low-pass keeping per-frame
	 *  turbulence out of the attitude. Without any of this the heading construction is
	 *  yaw and pitch only, and a wheeling flock slides round its turns flat. */
	const BANK_GAIN = 0.42;
	const BANK_MAX = 0.95;
	const BANK_RESPONSE = 3.5;
	/** FLAP AND GLIDE. Nothing beats its wings continuously; birds flap in bursts and
	 *  then hold a glide, and at this distance that alternation is most of what separates
	 *  a flock from a field of identically animated sprites. `RATE` is the burst cycle in
	 *  rad/s (~7 s round trip, offset per bird so a flock is never in unison), and
	 *  `DIHEDRAL` is the shallow V a gliding bird holds -- gliding to a raised wing
	 *  rather than to zero gives the glide a silhouette of its own instead of making it
	 *  the flap's midpoint. */
	const GLIDE_RATE = 0.85;
	const GLIDE_DIHEDRAL = 0.2;
	/** Per-bird size. Small enough to read as individuals at different depths rather
	 *  than as different species. */
	const SCALE_MIN = 0.78;
	const SCALE_MAX = 1.34;
	/** SUN_INTENSITY at full day (model/sky.svelte.ts); normalises the light inputs. */
	const KEY_FULL = 4.75;

	/**
	 * The flock layout: azimuth (deg, 0 = dead ahead of the boot camera), distance
	 * from the scene origin, altitude, share of `count`, and seed spread. Anchors sit
	 * FAR and LOW -- elevations of roughly 8-15 degrees -- because both stock cameras
	 * look at the origin roughly horizontally: anything overhead is simply never in
	 * frame.
	 *
	 * SIX SMALL FLOCKS RATHER THAN THREE LARGE ONES, at the same total count: three
	 * flocks over 360 degrees means most bearings have nothing in them, and a sky you
	 * have to go looking for is not sky dressing. Ten-odd birds apiece reads as a flock
	 * anyway at this distance.
	 *
	 * SPACING IS A CONSTRAINT, NOT A LOOK. Anchors must stay far enough apart that two
	 * flocks never fall inside each other's ~12.5-unit interaction zone even at the
	 * extremes of their wander (WANDER + its second harmonic = 30 units either way), so
	 * the real floor is about 75 units between anchors. The closest pair here is the
	 * first two at ~153 -- more margin than the three-flock layout had (~115), because
	 * spreading round the compass buys separation that stacking at one bearing did not.
	 * Azimuths are deliberately uneven: six flocks exactly 60 degrees apart reads as
	 * generated the moment you turn on the spot.
	 *
	 * ALTITUDES STAY ABOVE THE SOFT LIFT. The lowest is 30, and the deepest a flock
	 * dips is `altitude - WANDER_Y - PER_BIRD_DRIFT/2 - spread*0.45/2` ~ 21.8, clear of
	 * the lift ramp's top edge at 20. See LIFT: that ramp is a guarantee, not a
	 * mechanism, and normal flight must never ride it.
	 */
	const FLOCKS = [
		{ az: 0, distance: 150, altitude: 34, share: 0.17, spread: 14 },
		{ az: 52, distance: 190, altitude: 47, share: 0.15, spread: 13 },
		{ az: 118, distance: 165, altitude: 30, share: 0.13, spread: 12 },
		{ az: 186, distance: 215, altitude: 40, share: 0.15, spread: 14 },
		{ az: 248, distance: 175, altitude: 32, share: 0.12, spread: 12 },
		{ az: 308, distance: 200, altitude: 44, share: 0.14, spread: 13 }
	] as const;

	// ── Uniforms (one set, shared by the computes and the material) ───────────────
	const deltaTime = uniform(0);
	/** The flock's own clock, accumulated in the task -- not the TSL `time` node, for
	 *  the same elapsed-x-rate reason every layer keeps its own: it only advances while the
	 *  flocks are ungrounded, so nothing jumps when weather clears. Drives the target
	 *  wander, the pull breathing and the gust turbulence. */
	const uTime = uniform(0);
	const uWind = uniform(new THREE.Vector3());
	/** Gust turbulence magnitude, `TURB_BASE + TURB_WIND × wind` from the task. */
	const uTurb = uniform(TURB_BASE);
	/** The key light's hue at unit luminance; the two levels below mix along it. */
	const uHue = uniform(new THREE.Vector3(1, 1, 1));
	const uDark = uniform(0.08);
	const uLight = uniform(0.7);
	const opacity = uniform(0);

	// ── Geometry ──────────────────────────────────────────────────────────────────
	// Three triangles, as in the reference: a vertical body slab (nose +z, belly down)
	// plus two horizontal wings whose tips -- vertices 4 and 7 -- the vertex node
	// flaps. Drawn `count` times through InstancedBufferGeometry; the per-bird
	// dynamics live in storage buffers rather than attributes, which is what escapes
	// the 8-vertex-buffer cap skyLayer.ts documents.
	const birdGeometry = (): THREE.InstancedBufferGeometry => {
		const vertices = new Float32Array([
			// Body
			0, 0, -1.0, 0, -0.4, 0.5, 0, 0, 1.5,
			// Left wing (tip = vertex 4)
			0, 0, -0.75, -1.0, 0, 0.25, 0, 0, 0.75,
			// Right wing (tip = vertex 7)
			0, 0, 0.75, 1.0, 0, 0.25, 0, 0, -0.75
		]);
		const geometry = new THREE.InstancedBufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
		geometry.instanceCount = count;
		return geometry;
	};

	/**
	 * Builds the storages, the compute passes and the material together, once. One
	 * closure because every input is a BUILD-TIME prop -- see the same note in
	 * Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Walk the layout: the flocks take their shares of `count`, strays fill the
		// rest. Both stay far and low (see FLOCKS) so they are actually in frame.
		const anchors = new Float32Array(count * 3);
		const positions = new Float32Array(count * 3);
		const velocities = new Float32Array(count * 3);
		/**
		 * Per-bird ATTITUDE STATE, one vec4: (flap phase, roll, prevHeadingX,
		 * prevHeadingZ).
		 *
		 * Widened from the reference's bare phase float rather than given buffers of its
		 * own, and that is a hard constraint, not tidiness: the vertex stage reads exactly
		 * THREE storage buffers, and it already spends them on position, velocity and
		 * this. Roll has to reach the vertex stage, and the previous heading has to
		 * survive between position passes, so both ride here. The anchor buffer stays
		 * compute-only for the same reason.
		 *
		 * Three is what fits under the DEFAULT `maxStorageBuffersInVertexStage`: App.svelte
		 * deliberately requests no `requiredLimits`, since a limit the adapter cannot meet
		 * fails device creation and drops the whole app to WebGL2. On an adapter that
		 * reports 0 for it (compatibility mode) this material does not build, and that is
		 * accepted — the flock is sky dressing. See layers/CLAUDE.md.
		 */
		const states = new Float32Array(count * 4);
		const shades = new Float32Array(count);
		const scales = new Float32Array(count);

		const entries: { x: number; y: number; z: number; spread: number }[] = [];
		for (const flock of FLOCKS) {
			const az = (flock.az * Math.PI) / 180;
			for (let j = 0; j < Math.round(count * flock.share) && entries.length < count; j++) {
				entries.push({
					x: Math.sin(az) * flock.distance,
					y: flock.altitude,
					z: -Math.cos(az) * flock.distance,
					spread: flock.spread
				});
			}
		}
		while (entries.length < count) {
			// Strays, scattered around the compass. The altitude floor is 32 rather than
			// the flocks' 30 because a stray's seed spread is wider, and the same sum has
			// to clear the soft lift's top edge at 20 (see FLOCKS).
			const az = rng() * Math.PI * 2;
			const distance = 150 + rng() * 120;
			entries.push({
				x: Math.sin(az) * distance,
				y: 32 + rng() * 30,
				z: -Math.cos(az) * distance,
				spread: 26
			});
		}

		for (let i = 0; i < count; i++) {
			const { x, y, z, spread } = entries[i];
			anchors[i * 3] = x;
			anchors[i * 3 + 1] = y;
			anchors[i * 3 + 2] = z;

			// Seed in a flat-ish box around the anchor; the slab bias below holds the
			// flock there. Phases spread across the reference's 62.83 (= 2π·10) wrap so
			// no two birds flap in lockstep.
			positions[i * 3] = x + (rng() - 0.5) * spread;
			positions[i * 3 + 1] = y + (rng() - 0.5) * spread * 0.45;
			positions[i * 3 + 2] = z + (rng() - 0.5) * spread;

			const vx = rng() - 0.5;
			const vy = rng() - 0.5;
			const vz = rng() - 0.5;
			const l = Math.hypot(vx, vy, vz) || 1;
			const s = 0.6 + rng() * 0.9;
			const vxF = (vx / l) * s;
			const vyF = (vy / l) * s;
			const vzF = (vz / l) * s;
			velocities[i * 3] = vxF;
			velocities[i * 3 + 1] = vyF;
			velocities[i * 3 + 2] = vzF;

			// Phases spread across the reference's 62.83 (= 2*pi*10) wrap so no two birds
			// flap in lockstep. Roll starts level.
			states[i * 4] = rng() * 62.83;
			states[i * 4 + 1] = 0;
			// Seeded with the bird's ACTUAL starting heading, in the same (cos ry, sin ry)
			// form the position pass writes back -- otherwise the first frame reads a turn
			// from (0,0) to a real heading and banks the whole flock hard on frame one.
			const hxz = Math.hypot(vxF, vzF) || 1;
			states[i * 4 + 2] = vxF / hxz;
			states[i * 4 + 3] = -vzF / hxz;

			scales[i] = SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN);

			// Plumage: mostly dark to mid greys with a few pale birds -- a real flock
			// at distance is a mottle, not a fill.
			const r = rng();
			shades[i] =
				r < 0.55 ? 0.05 + rng() * 0.3 : r < 0.85 ? 0.35 + rng() * 0.3 : 0.72 + rng() * 0.28;
		}

		// No setPBO(): that is the WebGL2 compute readback path, and this layer is
		// WebGPU-only by the gate below. The anchor buffer is read in the COMPUTE pass
		// only, so the vertex stage still reads exactly three storage buffers --
		// position, velocity, state -- which is the count App.svelte requests.
		const positionStorage = instancedArray(positions, 'vec3').setName('birdPosition');
		const velocityStorage = instancedArray(velocities, 'vec3').setName('birdVelocity');
		const stateStorage = instancedArray(states, 'vec4').setName('birdState');
		const anchorStorage = instancedArray(anchors, 'vec3').setName('birdAnchor');

		// ── The velocity pass ────────────────────────────────────────────────────────
		// Boids, verbatim from the reference minus its pointer-ray scatter: pull to the
		// bird's own WANDERING target, then the O(n²) separation / alignment / cohesion
		// sweep and a speed clamp. The zone thresholds are ratios of the zone radius,
		// so tuning the three radii retunes the personality without touching the
		// branches.
		const computeVelocity = Fn(() => {
			const PI = float(3.141592653589793);
			const PI_2 = PI.mul(2.0);

			const zoneRadius = float(SEPARATION + ALIGNMENT + COHESION).toConst();
			const separationThresh = float(SEPARATION).div(zoneRadius).toConst();
			const alignmentThresh = float(SEPARATION + ALIGNMENT)
				.div(zoneRadius)
				.toConst();
			const zoneRadiusSq = zoneRadius.mul(zoneRadius).toConst();

			const birdIndex = instanceIndex.toConst('birdIndex');
			const position = positionStorage.element(birdIndex).toVar();
			const velocity = velocityStorage.element(birdIndex).toVar();

			// THE WANDERING TARGET. The anchor is a seed, not a leash: the pull target
			// drifts on incommensurate sines (so its path never closes), each bird's own
			// target drifts a little further (so the flock is not a rigid formation), and
			// the pull strength itself breathes. Together with the gust turbulence below,
			// this is what keeps the flocks from lapping one visible circuit.
			const anchor = anchorStorage.element(birdIndex);
			// Seed per flock from the anchor, so flocks wander out of phase.
			const seed = anchor.x.mul(0.37).add(anchor.z.mul(0.71)).add(anchor.y.mul(0.11)).toConst();

			const target = anchor
				.add(
					vec3(
						sin(uTime.mul(0.11).add(seed))
							.mul(float(WANDER))
							.add(sin(uTime.mul(0.043).add(seed.mul(2.7))).mul(float(WANDER * 0.5))),
						sin(uTime.mul(0.06).add(seed.mul(1.7))).mul(float(WANDER_Y)),
						cos(uTime.mul(0.09).add(seed.mul(1.3)))
							.mul(float(WANDER))
							.add(cos(uTime.mul(0.037).add(seed.mul(3.1))).mul(float(WANDER * 0.5)))
					)
				)
				.toVar();
			// Per-bird drift: golden-angle phase off the bird's own index.
			const driftPhase = float(birdIndex).mul(0.618);
			target.addAssign(
				vec3(
					sin(uTime.mul(0.21).add(driftPhase)).mul(float(PER_BIRD_DRIFT)),
					sin(uTime.mul(0.16).add(driftPhase.mul(1.9))).mul(float(PER_BIRD_DRIFT * 0.5)),
					cos(uTime.mul(0.19).add(driftPhase.mul(1.3))).mul(float(PER_BIRD_DRIFT))
				)
			);

			// The pull: toward the wandering target, harder vertically (the slab). The
			// division is the epsilon-hardened form of normalize() -- a bird passing
			// exactly over its target must not write NaNs into the buffers.
			const dirToCenter = position.sub(target).toVar();
			dirToCenter.y.mulAssign(float(SLAB_Y));
			const centerDist = length(dirToCenter).max(1e-6);
			// Breathing × distance: ×0.5 at the target itself, ×PULL_MAX from PULL_RANGE
			// out. The spring that keeps weather from carrying a flock off.
			const pull = float(CENTER_PULL)
				.mul(float(0.65).add(float(0.35).mul(sin(uTime.mul(0.043).add(seed.mul(1.1))))))
				.mul(clamp(centerDist.div(float(PULL_RANGE)), float(0.5), float(PULL_MAX)));
			velocity.subAssign(dirToCenter.div(centerDist).mul(deltaTime).mul(pull));

			// Wind: the weather's bearing as a plain acceleration, plus gust turbulence
			// -- slow directional sines that sway still air and toss a gale.
			velocity.addAssign(uWind.mul(deltaTime).mul(float(WIND_GAIN)));
			const gustPhase = seed.mul(2.3);
			velocity.addAssign(
				vec3(
					sin(uTime.mul(0.31).add(gustPhase)),
					sin(uTime.mul(0.23).add(gustPhase.mul(1.7))).mul(0.4),
					cos(uTime.mul(0.27).add(gustPhase.mul(1.3)))
				)
					.mul(uTurb)
					.mul(deltaTime)
			);

			// THE SOFT HALF OF THE BOUNDARIES (the hard half lives in the position pass):
			// a lift that ramps in below the flock band, and a radial push out of the
			// camera's volume. Neither should ever fire at these anchors -- they exist so
			// a retune or a freak gust decelerates a bird before the clamp has to catch
			// it. Edges are given low-to-high: WGSL leaves reversed smoothstep undefined.
			velocity.y.addAssign(
				smoothstep(float(14), float(20), position.y).oneMinus().mul(deltaTime).mul(float(LIFT))
			);
			const originDist = length(position).max(1e-6);
			velocity.addAssign(
				position
					.div(originDist)
					.mul(smoothstep(float(KEEP_OUT), float(KEEP_OUT + 30), originDist).oneMinus())
					.mul(deltaTime)
					.mul(float(CORE_PUSH))
			);

			Loop({ start: uint(0), end: uint(count), type: 'uint', condition: '<' }, ({ i }) => {
				If(i.equal(birdIndex), () => {
					Continue();
				});

				const birdPosition = positionStorage.element(i);
				const dirToBird = birdPosition.sub(position);
				const distToBird = length(dirToBird);

				If(distToBird.lessThan(0.0001), () => {
					Continue();
				});

				const distToBirdSq = distToBird.mul(distToBird);

				// Out of the zone: no interaction at all. With the anchors spaced as
				// they are, this is also what keeps separate flocks separate.
				If(distToBirdSq.greaterThan(zoneRadiusSq), () => {
					Continue();
				});

				const percent = distToBirdSq.div(zoneRadiusSq);

				If(percent.lessThan(separationThresh), () => {
					// Separation -- move apart for comfort.
					const velocityAdjust = separationThresh.div(percent).sub(1.0).mul(deltaTime);
					velocity.subAssign(normalize(dirToBird).mul(velocityAdjust));
				})
					.ElseIf(percent.lessThan(alignmentThresh), () => {
						// Alignment -- fly the same direction.
						const threshDelta = alignmentThresh.sub(separationThresh);
						const adjustedPercent = percent.sub(separationThresh).div(threshDelta);
						const birdVelocity = velocityStorage.element(i);

						const cosRange = cos(adjustedPercent.mul(PI_2));
						const cosRangeAdjust = float(0.5).sub(cosRange.mul(0.5)).add(0.5);
						const velocityAdjust = cosRangeAdjust.mul(deltaTime);
						velocity.addAssign(normalize(birdVelocity).mul(velocityAdjust));
					})
					.Else(() => {
						// Cohesion -- move closer.
						const threshDelta = alignmentThresh.oneMinus();
						const adjustedPercent = threshDelta
							.equal(0.0)
							.select(1.0, percent.sub(alignmentThresh).div(threshDelta));

						const cosRange = cos(adjustedPercent.mul(PI_2));
						const velocityAdjust = float(0.5).sub(cosRange.mul(-0.5).add(0.5)).mul(deltaTime);
						velocity.addAssign(normalize(dirToBird).mul(velocityAdjust));
					});
			});

			// The speed band: capped as in the reference, and floored because birds
			// do not hover -- without the floor the centre-pull damps a lonely stray
			// onto its anchor until it hangs there. Again divided rather than
			// normalize()d, so a freak zero speed cannot smear NaNs into the buffers.
			const speed = length(velocity).max(1e-6);
			velocity.assign(velocity.div(speed).mul(clamp(speed, float(MIN_SPEED), float(SPEED_LIMIT))));

			velocityStorage.element(birdIndex).assign(velocity);
		})()
			.compute(count)
			.setName('Sky birds velocity');

		// ── The position pass ────────────────────────────────────────────────────────
		// Integrate, advance the attitude state, and enforce THE HARD BOUNDARIES: never
		// below MIN_ALT, never inside KEEP_OUT of the origin. The floor is applied
		// first and the keep-out projection only ever scales a position UP (it fires
		// when the bird is inside the sphere), so the two cannot fight each other.
		const computePosition = Fn(() => {
			const pos = positionStorage.element(instanceIndex).toVar();
			pos.addAssign(velocityStorage.element(instanceIndex).mul(deltaTime).mul(float(INTEGRATION)));

			pos.y = max(pos.y, float(MIN_ALT));
			const originDist = length(pos).max(1e-6);
			If(originDist.lessThan(float(KEEP_OUT)), () => {
				pos.assign(pos.div(originDist).mul(float(KEEP_OUT)));
			});
			positionStorage.element(instanceIndex).assign(pos);

			const velocity = velocityStorage.element(instanceIndex);
			const state = stateStorage.element(instanceIndex).toVar();

			// ── THE BANK ──
			// The horizontal heading, stored as the SAME (cos ry, sin ry) pair the vertex
			// node builds its yaw from -- z negated and all. Keeping it in that form is
			// what makes the turn below a plain 2-D cross product rather than a sign
			// puzzle: for unit vectors cross(previous, current) is sin of the yaw change,
			// and at frame scale sin of the change IS the change.
			const xz = length(velocity.xz).max(1e-6);
			const hx = velocity.x.div(xz);
			const hz = velocity.z.negate().div(xz);
			const turn = state.z.mul(hz).sub(state.w.mul(hx));

			// Bank INTO the turn, proportional to the yaw RATE. Positive `turn` is a
			// left turn (increasing ry swings the nose toward -z, which is the bird's
			// left) and positive roll drops the left wing, so the sign works out with no
			// negation -- the whole reason for storing the heading in the vertex node's
			// convention rather than the world's.
			const targetRoll = clamp(
				turn.div(deltaTime.max(1e-4)).mul(float(BANK_GAIN)),
				float(-BANK_MAX),
				float(BANK_MAX)
			);
			// Chased, not snapped: a bird rolls into a turn over a beat or two, and the
			// same smoothing is what keeps a single turbulent frame from throwing the
			// attitude around.
			state.y = mix(
				state.y,
				targetRoll,
				clamp(deltaTime.mul(float(BANK_RESPONSE)), float(0), float(1))
			);
			state.z = hx;
			state.w = hz;

			// ── THE FLAP PHASE ── as the reference: faster with speed, faster again on a
			// climb. Whether the wings are actually beating is the vertex node's call --
			// see the glide term there. The phase runs regardless, so a bird coming out of
			// a glide picks up mid-stroke rather than snapping to the top of one.
			state.x = state.x
				.add(deltaTime)
				.add(length(velocity.xz).mul(deltaTime).mul(float(FLAP_RATE_XZ)))
				.add(max(velocity.y, 0.0).mul(deltaTime).mul(float(FLAP_RATE_Y)))
				.mod(62.83);

			stateStorage.element(instanceIndex).assign(state);
		})()
			.compute(count)
			.setName('Sky birds position');

		// ── The material ─────────────────────────────────────────────────────────
		// Tone-mapped like CloudDeck and Moon: a bird is an object in the dome's
		// exposure space, not an emissive phenomenon.
		const material = skyLayerMaterial({ side: THREE.DoubleSide, toneMapped: true });

		// The two per-bird constants, as plain instanced ATTRIBUTES rather than storage:
		// they never change, so they cost the vertex stage nothing it is short of. That
		// distinction is the point -- storage buffers are the scarce resource here (three
		// in the vertex stage), vertex buffers are not (this takes the geometry to three
		// of the eight skyLayer.ts documents). `aShade` is read in the FRAGMENT stage and
		// is auto-lifted to a varying, the same lift Meteors' brightness rides.
		const aShade = instancedFloat(shades);
		const aScale = instancedFloat(scales);

		// The vertex node, as the reference: flap the wing tips, rotate the bird into
		// its velocity's heading frame, add the storage position, project. The mesh's
		// own rotation.y = π/2 (set on the T.Mesh below) is part of the construction,
		// not framing -- it turns the geometry's +z nose into the frame's forward.
		// `negate()` is required wherever the reference uses it: a plain `-node`
		// resolves to NaN under WGSL.
		const birdVertex = Fn(() => {
			const position = positionLocal.toVar();
			const state = stateStorage.element(instanceIndex).toVar();
			const heading = normalize(velocityStorage.element(instanceIndex)).toVar();

			// FLAP OR GLIDE, whichever the bird is owed. Two terms, stronger wins: a slow
			// per-bird burst cycle (golden-angle offset off the index, the same idiom the
			// target drift uses, so a flock is never in unison), and a climb term --
			// nothing gains height on a glide, so a bird pulling up always beats.
			const glide = smoothstep(
				float(-0.45),
				float(0.1),
				sin(uTime.mul(float(GLIDE_RATE)).add(float(instanceIndex).mul(2.399)))
			);
			const beat = max(glide, smoothstep(float(-0.2), float(0.12), heading.y));

			If(vertexIndex.equal(4).or(vertexIndex.equal(7)), () => {
				// Gliding wings are HELD, and held slightly raised -- the shallow dihedral
				// a soaring bird carries. Mixing toward that rather than toward zero gives
				// the glide a silhouette of its own instead of parking it at the flap's
				// midpoint, where it would read as a bird that had simply stopped.
				position.y = mix(float(GLIDE_DIHEDRAL), sin(state.x).mul(float(FLAP_AMP)), beat);
			});

			// Per-bird size, applied AFTER the flap so a bigger bird sweeps a bigger wing
			// rather than a big bird flapping a small one's stroke.
			position.mulAssign(aScale);

			const world = modelWorldMatrix.mul(position);

			heading.z.mulAssign(-1.0);
			// The epsilons guard the degenerate headings the reference leaves to
			// chance: straight up (xz → 0) and the sqrt rounding past 1.0, either of
			// which would smear a NaN triangle across the sky.
			const xz = length(heading.xz).add(1e-6);
			const x = sqrt(heading.y.mul(heading.y).oneMinus().max(0.0));

			const cosry = heading.x.div(xz).toVar();
			const sinry = heading.z.div(xz).toVar();
			const cosrz = x;
			const sinrz = heading.y.toVar();

			const maty = mat3(cosry, 0, negate(sinry), 0, 1, 0, sinry, 0, cosry);
			const matz = mat3(cosrz, sinrz, 0, negate(sinrz), cosrz, 0, 0, 0, 1);

			// ROLL, and it goes FIRST in the chain because it is a rotation about the
			// bird's own FORWARD axis -- which is +x in this frame (the mesh's
			// rotation.y = pi/2 turns the geometry's +z nose into it), and only stays the
			// forward axis while the yaw and pitch are still ahead of it. Put it after
			// them and it becomes a roll about a world axis, which is a bird cartwheeling.
			const cosrx = cos(state.y);
			const sinrx = sin(state.y);
			const matx = mat3(1, 0, 0, 0, cosrx, sinrx, 0, negate(sinrx), cosrx);

			const finalVert = maty.mul(matz).mul(matx).mul(world);
			finalVert.addAssign(positionStorage.element(instanceIndex));

			// Far-plane pinning, exactly like every dome layer: honest depth at these
			// distances is beyond the camera's 144 far plane. Pinned also means scene
			// geometry occludes the flock for free -- a bird behind terrain hides.
			return pinFarPlane(cameraProjectionMatrix.mul(cameraViewMatrix).mul(finalVert));
		})();

		material.vertexNode = birdVertex;

		// Plumage: the per-bird shade mixes between the dark and light ends of the
		// key light's hue.
		material.colorNode = uHue.mul(mix(uDark, uLight, aShade));
		material.opacityNode = opacity;

		return { geometry: birdGeometry(), material, computeVelocity, computePosition };
	};

	const { geometry, material, computeVelocity, computePosition } = build();

	// The backend gate. Storage-buffer compute is WebGPU-only (see the header); on the
	// WebGL2 fallback the layer goes dormant instead of erroring. Typed as a narrow
	// object because `isWebGPUBackend` is a runtime flag three's Backend type does not
	// declare.
	const isComputeBackend = (backend: object): boolean =>
		(backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

	// THE WARM-UP, AND WHY IT NEEDS TWO FLAGS. The backend may not be initialized before
	// anything has rendered; `renderer.compute()` in that state warns and falls back to the
	// async path anyway, so the first pass is issued through `computeAsync`, which awaits
	// initialization properly.
	//
	// `issued` must be set SYNCHRONOUSLY or every frame until the promise settles issues
	// another warm-up. `ready` may only be set when it actually SETTLES -- one flag doing
	// both jobs was set on the frame the warm-up was issued, so the very next frame took
	// the sync path against the initialization it was supposed to be waiting for, which is
	// the one case the warm-up exists for. It self-healed (three warns and falls back), so
	// the cost was a console warning and a warm-up that did nothing.
	let computeIssued = false;
	let computeReady = false;

	useTask(
		(delta) => {
			if (!isComputeBackend(renderer.backend)) {
				if (mesh) mesh.visible = false;
				return;
			}

			const w = descriptor.weather;

			// Day, on the same ramp the stars use and inverted: dusk hands the sky over.
			const day = 1 - smooth01(0.15, 0.5, descriptor.sky.starVisibility);
			// Weather: birds land before it arrives. The mixer already eases both
			// channels over their blends, so this needs no easing of its own.
			const grounded = Math.max(smooth01(0.2, 0.5, w.precipitation), smooth01(0.55, 0.85, w.fog));
			opacity.value = day * (1 - grounded);

			const visible = opacity.value > 0.01;
			if (mesh) mesh.visible = visible;
			if (!visible) return;

			// Wind: the bearing and strength as one acceleration vector, and the gust
			// magnitude that rides it -- a base sway in still air, tossing in a gale.
			uWind.value.set(windAxisX(w) * w.wind, 0, windAxisZ(w) * w.wind);
			uTurb.value = TURB_BASE + TURB_WIND * w.wind;

			// The flock's clock advances with the integration it drives -- same clamped
			// delta, so backgrounding the tab does not jump the wander.
			deltaTime.value = Math.min(delta, 0.1);
			uTime.value += deltaTime.value;

			// Plumage from the key-light hints: the hue at unit luminance, with a dark
			// end that is the old silhouette and a light end that only exists by day --
			// a pale bird at midnight would read as a ghost.
			const { color, intensity } = descriptor.light;
			const norm = Math.min(1, intensity / KEY_FULL);
			const m = Math.max(0.001, color[0], color[1], color[2]);
			uHue.value.set(color[0] / m, color[1] / m, color[2] / m);
			uDark.value = 0.05 + 0.07 * norm;
			uLight.value = 0.3 + 0.5 * norm;

			// Integrate, then draw. The flock simply holds still for the frame or two the
			// warm-up takes to settle, which is not visible at startup.
			if (computeReady) {
				renderer.compute(computeVelocity);
				renderer.compute(computePosition);
			} else if (!computeIssued) {
				computeIssued = true;
				// Both issued in the same tick, so they keep their order: `computeAsync`
				// only awaits when the backend is uninitialized, and two calls awaiting the
				// same init resume in the order they queued -- velocity before the position
				// pass that integrates what it wrote.
				void Promise.all([
					renderer.computeAsync(computeVelocity),
					renderer.computeAsync(computePosition)
				])
					.then(() => {
						computeReady = true;
					})
					.catch(() => {
						// Let a later frame try again rather than stranding the flock.
						computeIssued = false;
					});
			}

			// The flocks only animate while they exist at all -- the compute passes are
			// this layer's clock, not the TSL `time` node. See Skybox.svelte on
			// renderMode.
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});
</script>

<!-- renderOrder 2.2 -- under the cloud deck (2.5) and over the Moon (2): where the
     deck is dense the birds go behind it, and a flock always flies in front of
     everything celestial. frustumCulled={false} is mandatory for a depth-pinned layer
     (see pinFarPlane). The rotation is part of the heading construction, not
     framing. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	rotation={[0, Math.PI / 2, 0]}
	renderOrder={2.2}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
