<script lang="ts">
	// WebGPU-safe rain layer: falling streaks that STOP at the world's surfaces, plus the
	// two impact layers -- an expanding ground ring and a small upward burst. Each drop is
	// a TSL-driven quad animated in the vertex node, and the mesh is recentered on the
	// active camera every frame -- no world-sized particle system needed.
	//
	// ── THE BOX FOLLOWS THE CAMERA; THE DROPS DO NOT ─────────────────────────────────
	//
	// Conflating those two is what makes rain feel bolted to the player. The mesh is
	// camera-anchored so drops always surround the view, but each drop's `fract()` wrap is
	// taken about the anchor IN WORLD SPACE (see `motionOf`), pinning the drop to a fixed
	// world position and merely recycling it when the box leaves it behind: drops stream
	// past with honest parallax, and splashes stay on the patch of ground they landed on.
	//
	// The quad is INSTANCED (skyLayer.ts): one head-anchored four-vertex quad drawn
	// `count` times.
	//
	// ── COLLISION, AND WHY IT COSTS NOTHING PER DROP ──────────────────────────────────
	//
	// The fall is a deterministic sawtooth: `u = fract((y0 + halfH - t*speed) / boxH)`
	// walks 1 -> 0 and wraps. That determinism is the whole trick: the height field
	// (heightField.ts) gives the surface height under a drop, which converts to the
	// sawtooth phase `uImpact` at which it reaches it -- so "has it landed?" is
	// `u <= uImpact` and "how long ago?" is `(uImpact - u) * boxH / speed`, both
	// closed-form in the vertex stage. No CPU clock, no collision events, no per-drop
	// state; the splash layers reuse the drops' own instance buffers.
	//
	// Where the height field has no data -- outside its footprint, or before its first
	// pass -- `valid` is 0, `uImpact` is forced below the box, and drops fall straight
	// through: the failure mode is the old behaviour, never drops frozen in mid-air.
	//
	// The field records only the TOPMOST surface per column, so rain stops on a roof and
	// does not reach the floor beneath it -- correct outdoors (sheltered spots for free),
	// wrong inside a multi-storey interior, which would need a different approach.
	//
	// ── A SPLASH BELONGS TO A PLACE, NOT TO A DROP ────────────────────────────────────
	//
	// The splash layers are evaluated at the drop's IMPACT point, never at its live
	// position: the live position still contains accumulated wind travel, which keeps
	// accumulating after the drop has landed, so a splash evaluated there slides downwind
	// for its whole life and can walk off the surface it landed on. The fix is closed-form:
	// `fallSinceImpact` is exactly `(uImpact - u) * boxH`, and rolling the drift back by
	// that much gives the world position where the drop actually hit -- the splash layers
	// evaluate their whole solution (position, height sample, timing) there.
	// `freezeAtImpact` in `motionOf` is that switch; the streaks, which really are at their
	// live position, leave it off.
	//
	// ── SHEETS ────────────────────────────────────────────────────────────────────────
	//
	// Rain arrives in bands that travel with the wind, and that -- more than drop count --
	// is what makes a downpour read as weather rather than as a particle system. `uSheet`
	// modulates the density threshold by a two-octave travelling wave along the wind
	// bearing, so drops thin out and thicken in slow gusts. It is a WIND phenomenon: still
	// air gets none of it.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		float,
		fract,
		mix,
		modelViewMatrix,
		modelWorldMatrix,
		positionLocal,
		pow,
		sin,
		smoothstep,
		sqrt,
		step,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { clamp01, descriptor, mulberry32, rainAmount, windAxisX, windAxisZ } from '../../model';
	import { sampleHeightField } from './heightField';
	import {
		billboardClip,
		instancedQuad,
		instancedVec2,
		instancedVec3,
		instancedVec4,
		projectClip,
		skyLayerMaterial,
		streakClip,
		HEAD_ANCHORED_QUAD,
		SKY_LAYER_USERDATA
	} from '../skyLayer';

	interface Props {
		count?: number;
		/** Local box around the camera. Keep it inside the camera far plane. */
		width?: number;
		height?: number;
		depth?: number;
		length?: number;
		minSpeed?: number;
		maxSpeed?: number;
		/**
		 * Median streak HALF-width in world units, at full intensity. The drawn width is
		 * this times a per-drop factor times `uWidthScale`, which rides precipitation --
		 * so this is the storm figure and a drizzle draws a fraction of it.
		 */
		widthWorld?: number;
		/**
		 * How many drops also produce a splash. A subset, because a splash costs two more
		 * instanced layers and only the near ones read as anything -- the drops chosen are
		 * the first `splashCount`, which is a random sample since the field is generated in
		 * random order.
		 */
		splashCount?: number;
		/** Seconds an impact ring takes to expand and fade. */
		ringDuration?: number;
		/** World radius the ring reaches. */
		ringRadius?: number;
		/** Seconds a burst droplet is airborne. */
		burstDuration?: number;
		seed?: number;
	}

	let {
		count = 9000,
		width = 70,
		height = 42,
		depth = 70,
		length = 1.2,
		minSpeed = 16,
		maxSpeed = 28,
		widthWorld = 0.018,
		splashCount = 1500,
		ringDuration = 0.5,
		ringRadius = 0.22,
		burstDuration = 0.28,
		seed = 20260831
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let streaks = $state.raw<Mesh>();
	let rings = $state.raw<Mesh>();
	let bursts = $state.raw<Mesh>();

	const opacity = uniform(0);
	/**
	 * The wind's horizontal travel PER UNIT OF FALL, as a vector: strength folded together
	 * with the bearing from `windDirection` -- that is the whole of what gives rain a
	 * direction. Strength stays a 0..1 INTENSITY upstream, never a [-1, 1] remap.
	 */
	const uWindSlant = uniform(new THREE.Vector2());
	/**
	 * Fraction of the drop field that is alive, compared per drop against its own random.
	 * Culling thins the field for real -- and the quad WIDTH is multiplied by the same
	 * flag, so a dead drop collapses to a degenerate triangle. Light rain is cheaper than
	 * heavy rain.
	 */
	const uDensity = uniform(1);
	/**
	 * Unit wind bearing, separate from `uWindSlant` because that one is the bearing SCALED
	 * by strength and therefore collapses to zero in still air. The sheets need an axis to
	 * band along even when the strength driving them is small.
	 */
	const uWindDir = uniform(new THREE.Vector2(0, 1));
	/**
	 * How deeply the travelling sheets cut into the density, 0..1. A wind term: still air
	 * falls evenly, and only moving air organises rain into bands.
	 */
	const uSheet = uniform(0);
	/**
	 * Phase of the sheet waves, accumulated for the same reason as `uFallTime` -- its
	 * rate moves with the wind.
	 */
	const uGustTime = uniform(0);
	/** Streak length multiplier: heavy rain falls faster and blurs longer. */
	const uLengthScale = uniform(1);
	/**
	 * Streak width multiplier, the other half of what makes intensity legible: density
	 * alone thins the field but leaves every surviving drop as fat as a storm's -- a
	 * drizzle is made of SMALLER drops as well as fewer.
	 */
	const uWidthScale = uniform(1);
	/**
	 * Streak colour, premultiplied by the light response on the CPU. A `Vector3` rather
	 * than a `Color` on purpose: these are shader constants in working space, and `Color`
	 * would run them through colour management on assignment.
	 */
	const uStreakTint = uniform(new THREE.Vector3(0.55, 0.66, 0.78));
	/**
	 * Accumulated fall distance in SECONDS-equivalent, replacing the raw `time` node:
	 * a rate multiplied into absolute elapsed time teleports the whole field when the
	 * rate changes, while accumulating means a change only alters the rate from here
	 * on -- the "self-accumulated distance" rule (layers/CLAUDE.md).
	 */
	const uFallTime = uniform(0);
	/**
	 * Accumulated HORIZONTAL travel, the wind-axis counterpart of `uFallTime` -- never
	 * `fall * uWindSlant` evaluated live, which is the elapsed x rate teleport with a
	 * moving slant (see `uFallTime`). Accumulated against the same fall step, so drift
	 * stays a fixed ratio of fall -- which is what a slant is.
	 */
	const uWindTravel = uniform(new THREE.Vector2());
	/**
	 * Splash brightness from the light hints, as Snow does for its flakes. Water is a
	 * reflector, so a ring at midnight must not glow at its noon brightness.
	 */
	const uLight = uniform(0.4);

	/**
	 * The camera's own world velocity in units per second, smoothed -- a raw position-delta
	 * over dt jitters frame to frame and the streaks would shimmer. Drives the streak
	 * orientation only; see the note where it is used.
	 */
	const uCameraVelocity = uniform(new THREE.Vector3());

	/** Droplets kicked up per impact. Each is one more instance in the burst layer. */
	const BURST_PER_IMPACT = 3;

	/**
	 * Horizontal travel per unit of fall at full wind, along whatever bearing the weather
	 * is blowing. The accumulated travel is scaled by the drop's own `aSpeed`, just as its
	 * fall is, so the SLANT this produces is identical for every drop however fast it
	 * falls -- one shared direction, many speeds, which is what a curtain of wind-driven
	 * rain looks like. The streak geometry derives its direction from the same vector, so
	 * a drop travels ALONG the streak that draws it.
	 */
	const WIND_SLANT = 0.4;

	/** How much of the density a full-strength gust can take away. */
	const SHEET_STRENGTH = 0.45;
	/** Sheet phase rate in radians/second: a slow breathing base plus the wind's own drive. */
	const GUST_RATE = 0.1;
	const GUST_RATE_WIND = 1.4;

	/**
	 * The near-camera fade, in world units of view distance. A drop 0.3 units from the
	 * lens draws a streak up to a couple of units long -- a bar across a large fraction of
	 * the screen -- and is far inside the near focus besides, where a lens does not resolve
	 * it at all. Fading it out is both the cheaper answer and the more honest one.
	 */
	const NEAR_FADE_START = 0.55;
	const NEAR_FADE_END = 2.4;

	/** Seconds for the camera-velocity smoother to cover ~63% of a step change. */
	const VELOCITY_SMOOTHING = 0.12;
	/**
	 * A single-frame camera move beyond this is a cut, not motion. Reporting the implied
	 * velocity would lean every streak flat for as long as the smoother took to recover.
	 */
	const TELEPORT_WORLD = 8;

	/**
	 * Builds every layer, once. One closure because all of it is BUILD-TIME props -- see
	 * the same note in Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Per-drop data: box position, (speed, length, width, phase) packed as a vec4, and
		// the density draw.
		const centers = new Float32Array(count * 3);
		const params = new Float32Array(count * 4);
		// (densityDraw, brightness).
		//
		// The draw is ITS OWN RANDOM, not a reuse of the phase in `params.w`: phase is the
		// drop's offset down the box, so culling against it would remove whole bands of the
		// fall cycle at once -- horizontal stripes of rain marching downward.
		//
		// Brightness rides alongside it rather than reusing the draw, and that pairing is
		// the trap: `alive` keeps the drops whose draw is LOW, so a brightness read off the
		// same number would leave every surviving drop at the dim end of the range. It
		// shares the attribute because a second instanced buffer would take one of WebGPU's
		// 8 vertex-buffer slots (skyLayer.ts); widening this one costs nothing.
		const randoms = new Float32Array(count * 2);

		for (let i = 0; i < count; i++) {
			centers[i * 3] = (rng() - 0.5) * width;
			centers[i * 3 + 1] = (rng() - 0.5) * height;
			centers[i * 3 + 2] = (rng() - 0.5) * depth;
			params[i * 4] = minSpeed + rng() * (maxSpeed - minSpeed);
			params[i * 4 + 1] = length * (0.65 + rng() * 0.7);
			params[i * 4 + 2] = widthWorld * (0.65 + rng() * 0.9);
			params[i * 4 + 3] = rng();
			randoms[i * 2] = rng();
			randoms[i * 2 + 1] = 0.55 + rng() * 0.6;
		}

		const halfWidth = float(width * 0.5);
		const halfHeight = float(height * 0.5);
		const halfDepth = float(depth * 0.5);
		const boxWidth = float(width);
		const boxHeight = float(height);
		const boxDepth = float(depth);

		/**
		 * The shared motion + collision solution, so the streaks and both splash layers
		 * cannot disagree about where or when a drop lands. Takes the instanced attribute
		 * nodes rather than closing over them, because the splash layers run over a SUBSET
		 * of the drops and therefore have their own (smaller) attribute buffers.
		 */
		const motionOf = (
			aCenter: THREE.Node<'vec3'>,
			aParams: THREE.Node<'vec4'>,
			aRandoms: THREE.Node<'vec2'>,
			/**
			 * Evaluate the whole solution at the drop's IMPACT POINT rather than at wherever
			 * it has since drifted to. The splash layers want this and the streaks do not --
			 * see the header.
			 */
			freezeAtImpact = false
		) => {
			const aSpeed = aParams.x;
			const aPhase = aParams.w;
			const aDraw = aRandoms.x;

			// The box's world origin. The mesh is re-centred on the camera every frame, so
			// this IS the camera position -- taken from the model matrix rather than TSL's
			// `cameraPosition` node, which follows whichever camera is currently rendering
			// (the height pass brings its own) while the anchor is a property of THIS mesh.
			const anchor = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;

			// `uFallTime`, not the raw `time` node -- see the uniform's note on why a
			// variable fall speed cannot be a multiplier on absolute elapsed time.
			const fall = uFallTime.mul(aSpeed).add(aPhase.mul(boxHeight));

			// THE WRAP IS TAKEN ABOUT THE ANCHOR, IN WORLD SPACE (see the header for why
			// that is load-bearing). Mechanics: the camera cancels except through `floor(g)`
			// (the fract argument), which is piecewise constant -- the drop hangs at a FIXED
			// world position and jumps exactly one box width when the box travels past it,
			// onto a face where `wrapFade` below has already faded it. Precision: `g` is a
			// world coordinate over a box dimension, so it quantises only for cameras tens
			// of thousands of units from the origin -- far beyond the 144-unit far plane.
			const u = fract(aCenter.y.add(halfHeight).sub(fall).sub(anchor.y).div(boxHeight));
			const localY = u.mul(boxHeight).sub(halfHeight);

			// THE HORIZONTAL POSITION, TAKEN A GIVEN FALL DISTANCE AGO. `back` is how far
			// back along the drop's own fall to evaluate: 0 is now, and the splash layers pass
			// the distance fallen since landing. Travel comes from the accumulator, not
			// `fall * uWindSlant` (see `uWindTravel`); the rollback still uses the live slant
			// -- exact in steady wind, and mid-blend a fraction of a second of drift at a
			// slant a fraction of a second stale.
			const driftX = (back: THREE.Node<'float'>) =>
				fract(
					aCenter.x
						.add(halfWidth)
						.add(uWindTravel.x.mul(aSpeed))
						.sub(back.mul(uWindSlant.x))
						.sub(anchor.x)
						.div(boxWidth)
				)
					.mul(boxWidth)
					.sub(halfWidth);
			const driftZ = (back: THREE.Node<'float'>) =>
				fract(
					aCenter.z
						.add(halfDepth)
						.add(uWindTravel.y.mul(aSpeed))
						.sub(back.mul(uWindSlant.y))
						.sub(anchor.z)
						.div(boxDepth)
				)
					.mul(boxDepth)
					.sub(halfDepth);

			/**
			 * The surface under a given box-local XZ, and the sawtooth phase that reaches it.
			 * Only XZ selects the column; `localY` is passed only so the returned value comes
			 * back box-local.
			 */
			const surfaceAt = (px: THREE.Node<'float'>, pz: THREE.Node<'float'>) => {
				// The mesh is camera-anchored with no rotation or scale, so this is just a
				// translation -- but going through the matrix keeps it correct if that ever
				// changes.
				const world = modelWorldMatrix.mul(vec4(px, localY, pz, 1)).xyz;
				const { height: surfaceWorldY, valid } = sampleHeightField(world);
				// The surface expressed in the box's local space: subtract the box origin,
				// which is `world.y - localY`.
				const surfaceLocalY = surfaceWorldY.sub(world.y).add(localY);
				// ...and the sawtooth phase at which the drop reaches it. Forced to -1 where
				// the field has no data, so `below` is 0 forever and the drop falls through.
				const uImpact = mix(float(-1), surfaceLocalY.add(halfHeight).div(boxHeight), valid);
				return { surfaceLocalY, uImpact, valid };
			};

			const xLive = driftX(float(0));
			const zLive = driftZ(float(0));
			const live = surfaceAt(xLive, zLive);

			let x = xLive;
			let z = zLive;
			let surface = live;

			if (freezeAtImpact) {
				// The distance the drop has fallen SINCE impact: `u` falls by exactly `1/boxH`
				// per unit of fall, so it is `(uImpact - u) * boxH` -- one closed expression, no
				// clock and no stored state. That rollback is what `driftX`/`driftZ` take.
				//
				// GUARDED BY `valid`, which is not optional. Where the live column has no
				// height data `uImpact` is the sentinel -1, and feeding that through would
				// throw the frozen position more than a box height away, land it on some
				// unrelated column that might well BE valid, and draw a splash out of
				// nowhere. Holding at the live fall instead leaves the second sample on the
				// same empty column, so `below` stays 0 and nothing draws -- the module's
				// standing fail-safe (heightField.ts).
				const fallSinceImpact = mix(float(0), live.uImpact.sub(u).mul(boxHeight), live.valid);
				x = driftX(fallSinceImpact);
				z = driftZ(fallSinceImpact);
				// Re-sampled at the impact column, so a ring's HEIGHT belongs to the place it
				// landed too. Without this the ring holds still horizontally and then slides
				// vertically instead, which is worse.
				surface = surfaceAt(x, z);
			}

			// WRAP FADE: a drop leaving the box teleports to the opposite face, so the outer
			// shell is faded to zero before it jumps (and rain has no business ending at a
			// hard wall 35 units out anyway).
			//
			// Both terms are `smoothstep(low, high, v).oneMinus()` rather than a smoothstep
			// with its edges swapped: WGSL leaves `smoothstep` UNDEFINED when edge0 >= edge1.
			const shell = x.abs().div(halfWidth).max(z.abs().div(halfDepth));
			const wrapFade = smoothstep(float(0.72), float(1), shell)
				.oneMinus()
				// The same at the top of the box, where the FALL recycles: without it, any
				// drop that never meets a surface pops into existence directly overhead.
				.mul(smoothstep(float(0.84), float(1), u).oneMinus());

			// 1 once the drop has reached the surface. Note a surface ABOVE the box top puts
			// uImpact past 1, so `below` is permanently 1 and no drop ever renders -- which
			// is exactly right: there is a roof overhead.
			const below = step(u, surface.uImpact);
			// Seconds since impact. Only meaningful while `below` is 1.
			const secondsSinceImpact = surface.uImpact.sub(u).mul(boxHeight).div(aSpeed);

			// THE SHEETS: two travelling waves along the wind bearing (~60 and ~155 world
			// units). Phased off the drop's WORLD XZ, not box-local -- otherwise the bands
			// would be nailed to the screen, and walking would change which drops exist
			// rather than moving through them.
			const band = x.add(anchor.x).mul(uWindDir.x).add(z.add(anchor.z).mul(uWindDir.y));
			const gust = sin(band.mul(0.105).sub(uGustTime))
				.mul(0.55)
				.add(sin(band.mul(0.041).add(uGustTime.mul(0.6))).mul(0.45));
			const density = uDensity.mul(mix(float(1), gust.mul(0.5).add(0.5), uSheet));

			// Alive if this drop's draw came in under the current density. A fixed per-drop
			// number against a moving threshold, so thinning the field removes a stable
			// SUBSET rather than reshuffling which drops exist every frame. A smoothstep
			// rather than a `step` because the threshold is not only the slow-moving
			// intensity -- a sheet sweeps it several times a second, and a hard cut against
			// that flickers. The ramp is one twentieth of the range and still reaches exactly
			// 0, keeping the width collapse (and its raster saving) intact.
			const alive = smoothstep(density.sub(0.06), density, aDraw).oneMinus();

			return {
				x,
				z,
				localY,
				surfaceLocalY: surface.surfaceLocalY,
				below,
				secondsSinceImpact,
				wrapFade,
				alive,
				aParams,
				aRandoms
			};
		};

		// ── The streaks ──────────────────────────────────────────────────────────────
		const streakMaterial = skyLayerMaterial({ side: THREE.DoubleSide });
		{
			const aCenter = instancedVec3(centers);
			const aParams = instancedVec4(params);
			const aRandoms = instancedVec2(randoms);
			const m = motionOf(aCenter, aParams, aRandoms);

			const aSpeed = aParams.x;
			const aBright = aRandoms.y;
			// Heavier rain draws longer streaks, because it also falls faster.
			const aLength = aParams.y.mul(uLengthScale);
			// The density flag rides on the WIDTH, not only the opacity (see `uDensity`);
			// `uWidthScale` is the intensity term on the same axis.
			const aWidth = aParams.z.mul(uWidthScale).mul(m.alive);

			// Head-anchored quad: x is the cross-axis corner, y walks head (0) to tail (1).
			const corner = positionLocal.xy;
			const across = corner.x;
			const along = corner.y;

			const head = vec3(m.x, m.localY, m.z);

			// THE STREAK TRAILS ALONG THE DROP'S VELOCITY RELATIVE TO THE CAMERA -- that is
			// what a motion-blurred drop physically is. Standing still gives the near-vertical
			// streaks; moving leans them into the direction of travel and stretches them,
			// which is what makes running or driving through rain read as speed. With the
			// camera at rest `uCameraVelocity` is zero and this is the plain vertical tail.
			//
			// The mesh carries translation only, so a world-space direction is already a
			// local-space one and no basis change is needed here.
			const velocity = vec3(uWindSlant.x, float(-1), uWindSlant.y).mul(aSpeed).sub(uCameraVelocity);
			// Guarded rather than `.normalize()`: a camera falling at exactly the drop's
			// own velocity makes this vector zero, and normalising that is NaN -- which
			// propagates to the quad's clip position and kills the whole draw, not one drop.
			const relativeSpeed = velocity.length().max(float(1e-4));
			// Longer streaks the faster the relative motion, but BOUNDED: unclamped, a fast
			// camera stretches drops clear across the screen. Pairs with the near fade -- the
			// worst offenders are long streaks close to the lens.
			const stretch = relativeSpeed.div(aSpeed).clamp(0.8, 2);
			const tail = head.sub(velocity.div(relativeSpeed).mul(aLength.mul(stretch)));

			// Deliberately NOT depth-pinned, unlike the dome layers: a drop is near the
			// camera and must be occluded by scene geometry, so it keeps its honest depth.
			streakMaterial.vertexNode = streakClip(head, tail, along, across, aWidth);

			// THE COMET TAPER: a motion-blurred drop is brightest where the drop actually IS
			// -- the tail is the exposure it left behind and has to fall away. A short ramp
			// over the first tenth (so the quad's head edge is not a hard cap), then decay
			// across the whole remaining length.
			const taper = smoothstep(float(0), float(0.09), along).mul(
				smoothstep(float(0.28), float(1), along).oneMinus()
			);
			// Soft across the streak: at these widths the quad is a couple of pixels across,
			// so the falloff IS the antialiasing.
			const edgeFade = pow(across.abs().oneMinus(), float(1.35));

			// The near fade -- see NEAR_FADE_START. `modelViewMatrix` is the ACTIVE camera's,
			// which is what this wants: it is the view being composed, and the height pass
			// (which brings its own camera) hides this whole group anyway.
			const viewDistance = modelViewMatrix.mul(vec4(head, 1)).xyz.length();
			const nearFade = smoothstep(float(NEAR_FADE_START), float(NEAR_FADE_END), viewDistance);

			streakMaterial.colorNode = uStreakTint;
			// `below.oneMinus()` is the collision: the streak stops existing the instant it
			// reaches the surface, and the ring and burst take over from the same solution.
			streakMaterial.opacityNode = opacity
				.mul(taper)
				.mul(edgeFade)
				.mul(m.wrapFade)
				.mul(m.below.oneMinus())
				.mul(nearFade)
				// Per-drop brightness: uniform opacity flattens the field into one plane of
				// identical marks; a spread gives it depth for free.
				.mul(aBright);
		}

		// The splash layers run over the first `splashCount` drops. `subarray` is a VIEW,
		// so this shares memory with the buffers above rather than copying them.
		const splashes = Math.max(0, Math.min(splashCount, count));
		const splashCenters = centers.subarray(0, splashes * 3);
		const splashParams = params.subarray(0, splashes * 4);
		// The splash layers inherit the drops' own density draws, so splash count follows
		// rain intensity -- and the sheets -- for free.
		const splashRandoms = randoms.subarray(0, splashes * 2);

		// ── The impact ring ──────────────────────────────────────────────────────────
		// A ground-aligned quad at the impact point with an expanding, fading annulus.
		const ringMaterial = skyLayerMaterial();
		{
			const aCenter = instancedVec3(splashCenters);
			const aParams = instancedVec4(splashParams);
			// `freezeAtImpact` -- the whole reason the rings used to wander. See the header.
			const m = motionOf(aCenter, aParams, instancedVec2(splashRandoms), true);

			const corner = positionLocal.xy;
			const progress = m.secondsSinceImpact.div(ringDuration).clamp(0, 1);
			const active = m.below.mul(step(m.secondsSinceImpact, float(ringDuration)));

			// A bigger drop throws a bigger ring: `aParams.z` over the median recovers this
			// drop's own 0.65..1.55 width draw -- the size variation the streaks already
			// have, spent again so a spatter is not a field of identical stamps.
			const dropScale = m.aParams.z.div(widthWorld).mul(0.55).add(0.45);
			const radius = dropScale.mul(ringRadius);

			// Laid flat in XZ at the surface, lifted a hair to stay off it: these share a
			// plane with the ground, and depth-testing coplanar geometry z-fights.
			const local = vec3(
				m.x.add(corner.x.mul(radius)),
				m.surfaceLocalY.add(0.015),
				m.z.add(corner.y.mul(radius))
			);
			// Honest projection, not depth-pinned: a ring lies on the world and must be
			// occluded by anything in front of it.
			ringMaterial.vertexNode = projectClip(local);

			// THE RIPPLE: a band at radius `grow`, thinning as it goes. `sqrt(progress)`
			// rather than `progress` -- a real ripple decelerates, throwing most of its travel
			// into the first part of its life; linear expansion reads as a circle being drawn.
			// A fixed-width band on a ring expanding through its whole range is a soft blob,
			// not an annulus; narrowing is what makes it a ripple.
			const grow = sqrt(progress);
			const bandWidth = mix(float(0.3), float(0.09), progress);
			const r = sqrt(corner.x.mul(corner.x).add(corner.y.mul(corner.y)));
			const band = smoothstep(float(0), bandWidth, r.sub(grow).abs()).oneMinus();

			ringMaterial.colorNode = vec3(0.62, 0.72, 0.84).mul(uLight);
			ringMaterial.opacityNode = opacity
				.mul(active)
				.mul(m.alive)
				.mul(m.wrapFade)
				.mul(band)
				// Squared, so the ring holds its brightness while it is still tight and then
				// goes quickly, instead of lingering as a wide grey halo.
				.mul(pow(progress.oneMinus(), float(2)))
				.mul(m.aRandoms.y)
				.mul(0.6);
		}

		// ── The burst ────────────────────────────────────────────────────────────────
		// A few droplets kicked up and out from each impact, on a parabolic arc.
		const burstMaterial = skyLayerMaterial();
		const burstInstances = splashes * BURST_PER_IMPACT;
		{
			// The drop data is repeated once per droplet so the burst layer can be indexed
			// by instance like any other, with the per-droplet variation in its own vec4.
			const burstCenters = new Float32Array(burstInstances * 3);
			const burstParams = new Float32Array(burstInstances * 4);
			// (dirX, dirZ, reach, size)
			const burstShape = new Float32Array(burstInstances * 4);
			const burstRandoms = new Float32Array(burstInstances * 2);

			for (let i = 0; i < splashes; i++) {
				for (let b = 0; b < BURST_PER_IMPACT; b++) {
					const j = i * BURST_PER_IMPACT + b;
					burstCenters[j * 3] = centers[i * 3];
					burstCenters[j * 3 + 1] = centers[i * 3 + 1];
					burstCenters[j * 3 + 2] = centers[i * 3 + 2];
					burstParams[j * 4] = params[i * 4];
					burstParams[j * 4 + 1] = params[i * 4 + 1];
					burstParams[j * 4 + 2] = params[i * 4 + 2];
					burstParams[j * 4 + 3] = params[i * 4 + 3];
					burstRandoms[j * 2] = randoms[i * 2];
					burstRandoms[j * 2 + 1] = randoms[i * 2 + 1];

					// Spread around the compass, jittered so the droplets are not a rosette.
					const angle = ((b + rng() * 0.7) / BURST_PER_IMPACT) * Math.PI * 2;
					burstShape[j * 4] = Math.cos(angle);
					burstShape[j * 4 + 1] = Math.sin(angle);
					burstShape[j * 4 + 2] = 0.06 + rng() * 0.1;
					burstShape[j * 4 + 3] = widthWorld * (1.8 + rng() * 2.2);
				}
			}

			const aCenter = instancedVec3(burstCenters);
			const aParams = instancedVec4(burstParams);
			const aShape = instancedVec4(burstShape);
			// Frozen at the impact point, exactly as the ring -- see the header.
			const m = motionOf(aCenter, aParams, instancedVec2(burstRandoms), true);

			const corner = positionLocal.xy;
			const progress = m.secondsSinceImpact.div(burstDuration).clamp(0, 1);
			const active = m.below.mul(step(m.secondsSinceImpact, float(burstDuration)));

			// Out along its own bearing, and up on a parabola that returns to the surface --
			// 4p(1-p) peaks at 0.5 and is zero at both ends.
			const reach = aShape.z;
			const arc = progress.mul(progress.oneMinus()).mul(4);
			const local = vec3(
				m.x.add(aShape.x.mul(reach).mul(progress)),
				m.surfaceLocalY.add(arc.mul(reach).mul(1.6)).add(0.01),
				m.z.add(aShape.y.mul(reach).mul(progress))
			);

			// Billboarded and honestly projected, as the streaks are.
			burstMaterial.vertexNode = billboardClip(local, corner.mul(aShape.w));

			// A round speck, fading as it falls back.
			const d2 = corner.x.mul(corner.x).add(corner.y.mul(corner.y));
			const speck = smoothstep(float(0), float(1), d2).oneMinus();
			burstMaterial.colorNode = vec3(0.6, 0.7, 0.82).mul(uLight);
			burstMaterial.opacityNode = opacity
				.mul(active)
				.mul(m.alive)
				.mul(m.wrapFade)
				.mul(speck)
				.mul(progress.oneMinus())
				.mul(m.aRandoms.y)
				.mul(0.8);
		}

		return {
			streakGeometry: instancedQuad(count, HEAD_ANCHORED_QUAD),
			streakMaterial,
			ringGeometry: instancedQuad(splashes),
			ringMaterial,
			burstGeometry: instancedQuad(burstInstances),
			burstMaterial
		};
	};

	const {
		streakGeometry,
		streakMaterial,
		ringGeometry,
		ringMaterial,
		burstGeometry,
		burstMaterial
	} = build();

	// Camera-velocity tracking. Plain variables, written and read only by the task below --
	// a per-frame value can never be a prop or reactive state.
	let lastCameraPosition: THREE.Vector3 | null = null;
	const stepVector = new THREE.Vector3();

	useTask(
		(delta) => {
			const w = descriptor.weather;
			// `rainAmount` owns the rain/snow split (the explicit `precipitationType`
			// channel), one definition shared with Snow and RainLens.
			const rain = rainAmount(w);

			// INTENSITY IS SPLIT ACROSS FOUR KNOBS (density, width, length, fall speed --
			// see the uniforms), not folded into alpha: `presence` reaches full by a quarter
			// intensity and is only there to take the layer cleanly to zero.
			const presence = Math.min(1, rain * 4);
			opacity.value = Math.min(0.6, presence * (0.22 + w.cloudCover * 0.78));
			uDensity.value = clamp01(0.06 + 0.94 * rain);
			uLengthScale.value = 0.55 + 0.8 * rain;
			uWidthScale.value = 0.6 + 0.65 * rain;

			// Wind strength folded together with its bearing, so the drift and the streak
			// direction cannot disagree -- they read the same vector. The bare bearing goes
			// out alongside it for the sheets, which need an axis in still air too.
			const wind = clamp01(w.wind);
			const dirX = windAxisX(w);
			const dirZ = windAxisZ(w);
			uWindDir.value.set(dirX, dirZ);
			const gust = wind * WIND_SLANT;
			uWindSlant.value.set(dirX * gust, dirZ * gust);

			// Sheets are a wind phenomenon, and their phase accumulates like the fall does
			// (see `uGustTime`).
			uSheet.value = wind * SHEET_STRENGTH;
			uGustTime.value += delta * (GUST_RATE + wind * GUST_RATE_WIND);

			// Fall distance accumulates; the rate is what intensity changes. See uFallTime.
			const fallStep = delta * (0.6 + 0.4 * rain);
			uFallTime.value += fallStep;
			// The wind's horizontal travel accumulates against THE SAME STEP, so drift
			// stays a fixed ratio of fall (which is what a slant is). See `uWindTravel`.
			uWindTravel.value.x += uWindSlant.value.x * fallStep;
			uWindTravel.value.y += uWindSlant.value.y * fallStep;

			// Splashes are water catching the light, so they track the key and fill as
			// Snow's flakes do -- bright in daylight, faint under a night deck.
			const { ambient, intensity } = descriptor.light;
			const lit = Math.min(1.1, Math.max(0.2, 0.25 + ambient * 0.5 + intensity * 0.09));
			uLight.value = lit;

			// The streaks track it too, but on a much shallower curve and off a high floor:
			// a splash is a reflection and genuinely goes dark, while a falling drop is lit
			// from every direction at once -- taking it to a splash's night brightness would
			// erase the rain from night scenes, the ones it is most wanted in.
			const streakLit = 0.5 + Math.min(1, lit) * 0.5;
			uStreakTint.value.set(0.55 * streakLit, 0.66 * streakLit, 0.78 * streakLit);

			const visible = opacity.value > 0.01;
			const position = camera.current.position;

			// The camera's velocity, from its own position delta rather than any physics
			// body: the streaks must lean against whatever is actually moving the VIEW
			// (free-fly camera, cutscene rig, spectator). Tracked even while dry, so the
			// first frame of a downpour does not inherit a smoother primed with a stale
			// value.
			if (lastCameraPosition === null) {
				lastCameraPosition = position.clone();
			} else {
				stepVector.subVectors(position, lastCameraPosition);
				lastCameraPosition.copy(position);
				if (stepVector.length() > TELEPORT_WORLD) {
					uCameraVelocity.value.set(0, 0, 0);
				} else if (delta > 0) {
					// One-pole smoothing, framerate-independent: the `exp` form gives the
					// same time constant at 30 fps as at 144, where a bare lerp factor
					// would not.
					uCameraVelocity.value.lerp(
						stepVector.divideScalar(delta),
						1 - Math.exp(-delta / VELOCITY_SMOOTHING)
					);
				}
			}

			for (const mesh of [streaks, rings, bursts]) {
				if (!mesh) continue;
				mesh.visible = visible;
				mesh.position.copy(position);
			}
			// The fall runs off the TSL `time` node, so it animates every frame while it
			// is raining -- and not at all when it is not. See Skybox.svelte on renderMode.
			if (visible) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			streakGeometry.dispose();
			streakMaterial.dispose();
			ringGeometry.dispose();
			ringMaterial.dispose();
			burstGeometry.dispose();
			burstMaterial.dispose();
		};
	});
</script>

<T.Mesh
	bind:ref={streaks}
	geometry={streakGeometry}
	material={streakMaterial}
	renderOrder={3}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>

<!-- The impact layers sit just after the streaks: they are drawn on and just above world
     surfaces, so they must sort over the drops falling past them. -->
<T.Mesh
	bind:ref={rings}
	geometry={ringGeometry}
	material={ringMaterial}
	renderOrder={3.1}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>

<T.Mesh
	bind:ref={bursts}
	geometry={burstGeometry}
	material={burstMaterial}
	renderOrder={3.2}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
