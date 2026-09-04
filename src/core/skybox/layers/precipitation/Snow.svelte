<script lang="ts">
	// WebGPU snow layer -- the precipitation counterpart to Rain.svelte.
	//
	// THE SPLIT. `precipitation` says how much is falling and `precipitationType` says what
	// kind (0 snow, 1 rain); `snowAmount` in weatherMixer.ts multiplies the two, and Rain
	// takes the complement from the same definition. Outside the sleet band exactly one
	// layer is live, so the usual case pays for one field of particles rather than two --
	// and inside it both render at a share that sums to the amount, which is what sleet is.
	//
	// THE LOOK, ported from a reference shader (the Journey-style point snow):
	//   - SPECKS, not blobs. The sprite is an inverse-distance falloff
	//     (0.5/d - 1, clamped): a tight bright core with a faint halo. A soft disc at
	//     snow scale reads as styrofoam; this reads as snow.
	//   - SMALL. Median radius ~0.05 world units with modest variance. The reference
	//     perspective-scales its point size (uSize * 1/-z); world-unit billboards do
	//     that for free.
	//   - COHERENT SWAY. The horizontal wander is phased by POSITION, not by a random
	//     per-flake seed: sin(t + x*k) drives z, cos(t + z*k) drives x. Neighbours share
	//     phase, so the field shears and swirls like one wind field instead of jittering
	//     independently. The sway sits INSIDE the wrap: a flake pushed past the box edge
	//     re-enters on the far side, indistinguishable among thousands.
	//   - TWINKLE. A flake is a plate and it tumbles, so its brightness pulses as its
	//     face turns toward and away from the light. Each flake gets its own rate, so
	//     the field scintillates rather than breathing as one.
	//   - FLURRIES. Density is banded by travelling waves along the wind bearing, the
	//     same construction as Rain's sheets and documented there. The sway makes
	//     neighbours move together; this makes whole regions arrive and pass.
	//
	// THE MOTION is all in the vertex node -- zero CPU work per frame per flake, exactly
	// as Rain: slow fall, fract-wrapped through the box, plus an accumulated wind-drift
	// term. Flakes are diffuse reflectors, so colour rides the descriptor's light hints
	// (see `uFlakeTint`); Rain's streaks do the same on a much shallower curve.
	//
	// The mesh is recentered on the active camera every frame, as Rain is, so the box
	// follows the player without a world-sized particle system. The quad is instanced
	// (skyLayer.ts), as Rain's.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		cos,
		float,
		fract,
		mix,
		modelViewMatrix,
		modelWorldMatrix,
		positionLocal,
		sin,
		smoothstep,
		sqrt,
		time,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { clamp01, descriptor, mulberry32, snowAmount, windAxisX, windAxisZ } from '../../model';
	import { sampleHeightField } from './heightField';
	import {
		billboardClip,
		instancedQuad,
		instancedVec3,
		instancedVec4,
		skyLayerMaterial,
		PRECIPITATION_LAYER,
		SKY_LAYER_USERDATA
	} from '../skyLayer';

	interface Props {
		count?: number;
		/** Local box around the camera. Keep it inside the camera far plane. */
		width?: number;
		height?: number;
		depth?: number;
		/** Terminal velocities, world units per second. */
		minSpeed?: number;
		maxSpeed?: number;
		/** Median flake radius in world units; varied per flake. */
		sizeWorld?: number;
		/** Sway amplitude ceiling, world units. */
		swayAmp?: number;
		seed?: number;
	}

	let {
		count = 11000,
		width = 64,
		height = 40,
		depth = 64,
		minSpeed = 0.6,
		maxSpeed = 1.7,
		sizeWorld = 0.05,
		swayAmp = 2,
		seed = 20260831
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	const opacity = uniform(0);
	/**
	 * Accumulated wind travel, in world units -- never `time * wind` (the elapsed x rate
	 * teleport; see Rain's `uFallTime`). Snow falls slowly enough to track a flake, so
	 * the teleport would be plainly visible here.
	 */
	const uWindDrift = uniform(new THREE.Vector2());
	/**
	 * Fraction of the flake field that is alive, against each flake's own random.
	 * Culling thins the field for real, and because flake SIZE is scaled by the same
	 * flag a dead flake is a zero-area quad the rasteriser never sees.
	 */
	const uDensity = uniform(1);
	/**
	 * Accumulated fall, in seconds-equivalent, replacing the raw `time` node -- see
	 * Rain's `uFallTime` for why it must accumulate.
	 */
	const uFallTime = uniform(0);
	/**
	 * Flake colour, derived from the light hints on the CPU. Near-white in day sun, and a
	 * COOL grey-blue at night rather than a dimmer white -- unlit snow takes its colour
	 * from the sky above it, and a neutral grey flake at midnight reads as dust.
	 * A `Vector3` rather than a `Color`: this is a working-space shader constant and
	 * `Color` would colour-manage it on assignment.
	 */
	const uFlakeTint = uniform(new THREE.Vector3(0.3, 0.3, 0.3));
	/** Flake size multiplier: heavier snow falls in bigger flakes as well as more of them. */
	const uSizeScale = uniform(1);
	/**
	 * Unit wind bearing and the travelling-gust terms, as Rain's sheets: snow arrives
	 * in flurries, and a field at uniform density is the one thing that reads
	 * unmistakably as a particle system. Milder than Rain's -- the coherent sway
	 * already gives snow some of this.
	 */
	const uWindDir = uniform(new THREE.Vector2(0, 1));
	const uSheet = uniform(0);
	const uGustTime = uniform(0);

	/**
	 * The near-camera fade, in world units of view distance. Tighter than Rain's, because a
	 * flake is a small disc rather than a long streak and can be let closer before it takes
	 * over the frame. Declared up here, not with the task's constants below, because `build`
	 * runs before those are initialised.
	 */
	const NEAR_FADE_START = 0.35;
	const NEAR_FADE_END = 1.6;

	/**
	 * Builds the field and its material together, once. One closure because every input
	 * is a BUILD-TIME prop -- see the same note in Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Per-flake data: box position, (speed, size, phase, swayAmp), and
		// (windMul, bright, densityDraw, twinkleRate). The density draw is packed into
		// the EXISTING vector rather than given its own attribute -- an instanced attribute
		// takes one of WebGPU's 8 vertex-buffer slots (skyLayer.ts), while widening a
		// buffer costs none (where the twinkle rate went too). The draw is its own random
		// rather than a reuse of `phase`, which is the flake's offset down the box --
		// culling against that would delete whole horizontal bands of the field at a time.
		const centers = new Float32Array(count * 3);
		const params = new Float32Array(count * 4);
		const params2 = new Float32Array(count * 4);

		for (let i = 0; i < count; i++) {
			centers[i * 3] = (rng() - 0.5) * width;
			centers[i * 3 + 1] = (rng() - 0.5) * height;
			centers[i * 3 + 2] = (rng() - 0.5) * depth;
			params[i * 4] = minSpeed + rng() * (maxSpeed - minSpeed);
			params[i * 4 + 1] = sizeWorld * (0.4 + rng() * 0.9);
			params[i * 4 + 2] = rng();
			params[i * 4 + 3] = swayAmp * (0.4 + rng() * 0.6);
			params2[i * 4] = 0.5 + rng() * 0.8; // windMul
			params2[i * 4 + 1] = 0.75 + rng() * 0.25; // bright
			params2[i * 4 + 2] = rng(); // density draw
			params2[i * 4 + 3] = 1.4 + rng() * 3.6; // twinkle rate, rad/s
		}

		const material = skyLayerMaterial();

		const aCenter = instancedVec3(centers);
		const aParams = instancedVec4(params);
		const aParams2 = instancedVec4(params2);
		const aSpeed = aParams.x;
		const aSize = aParams.y;
		const aPhase = aParams.z;
		const aSwayAmp = aParams.w;
		const aWindMul = aParams2.x;
		const aBright = aParams2.y;
		const aRandom = aParams2.z;
		const aTwinkleRate = aParams2.w;

		const corner = positionLocal.xy;

		const halfWidth = float(width * 0.5);
		const halfHeight = float(height * 0.5);
		const halfDepth = float(depth * 0.5);
		const boxWidth = float(width);
		const boxHeight = float(height);
		const boxDepth = float(depth);

		// The box's world origin -- the camera, since the mesh is re-centred on it every
		// frame. Read from the model matrix, not TSL's `cameraPosition`, for the reason
		// spelled out in Rain's `motionOf`.
		const anchor = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;

		// FALL + WRAP. Identical construction to Rain's Y, including the part that matters
		// most: the wrap is taken about the anchor IN WORLD SPACE, so a flake hangs at a
		// fixed world position and is merely recycled when the box moves past it. See the
		// worked note in Rain.svelte.
		const fall = uFallTime.mul(aSpeed).add(aPhase.mul(boxHeight));
		const y = fract(aCenter.y.add(halfHeight).sub(fall).sub(anchor.y).div(boxHeight))
			.mul(boxHeight)
			.sub(halfHeight);

		// THE SWIRL: sway phased by POSITION (z's phase from x, x's phase from the
		// already-swayed z -- sequential, as the reference), so neighbours move together
		// and the field shears like one wind field. Both sway terms sit INSIDE the wrap.
		// The spatial rate (0.12) tunes the coherence -- ~1.5 swirl cells across the box:
		// fully shared phase would move the field as one rigid sheet, fully independent
		// phase reads as jitter. The 0.5 temporal rate is the reference's lazy meander.
		//
		// THE SWIRL PHASE IS TAKEN BEFORE THE WRAP: `xBase`/`zBase` are world quantities
		// (a per-flake constant plus the shared wind travel), so a flake's place in the
		// swirl depends only on where it is in the WORLD. Phasing off the post-wrap local
		// coordinate instead would make the swirl a function of camera position -- walk
		// across the scene and every flake changes the way it sways.
		// The drift is a VECTOR along the weather's bearing.
		const xBase = aCenter.x.add(halfWidth).add(uWindDrift.x.mul(aWindMul));
		const zBase = aCenter.z.add(halfDepth).add(uWindDrift.y.mul(aWindMul));

		const swayZ = sin(time.mul(0.5).add(xBase.mul(0.12)))
			.mul(aSwayAmp)
			.mul(0.8);
		const zSwayed = zBase.add(swayZ);
		const z = fract(zSwayed.sub(anchor.z).div(boxDepth)).mul(boxDepth).sub(halfDepth);

		const swayX = cos(time.mul(0.5).add(zSwayed.mul(0.12))).mul(aSwayAmp);
		const x = fract(xBase.add(swayX).sub(anchor.x).div(boxWidth)).mul(boxWidth).sub(halfWidth);

		// WRAP FADE, as Rain: the outer shell of the box fades out so that a flake
		// recycling to the opposite face is already invisible when it jumps, plus the top
		// of the box so flakes do not appear out of nothing overhead. Snow needs this more
		// than rain does -- a flake is slow enough to follow with your eye, which is
		// exactly what makes a pop legible. Written as `smoothstep(...).oneMinus()` because
		// WGSL leaves `smoothstep` undefined when its edges are given high-to-low.
		const shell = x.abs().div(halfWidth).max(z.abs().div(halfDepth));
		const wrapFade = smoothstep(float(0.72), float(1), shell)
			.oneMinus()
			.mul(smoothstep(float(0.86), float(1), y.add(halfHeight).div(boxHeight)).oneMinus());

		// THE FLURRIES. Two travelling waves along the wind bearing (~85 and ~210 world
		// units), banding the field into gusts -- the same construction as Rain's sheets,
		// documented there, and phased off the flake's WORLD XZ for the same reason: bands
		// nailed to the screen would change which flakes exist as the player walks rather
		// than letting them walk through the gust.
		const band = x.add(anchor.x).mul(uWindDir.x).add(z.add(anchor.z).mul(uWindDir.y));
		const gust = sin(band.mul(0.074).sub(uGustTime))
			.mul(0.55)
			.add(sin(band.mul(0.03).add(uGustTime.mul(0.6))).mul(0.45));
		const density = uDensity.mul(mix(float(1), gust.mul(0.5).add(0.5), uSheet));

		// Camera-facing billboard, as Rain/Stars. Deliberately NOT depth-pinned: flakes
		// have honest depth and must be occluded by the world. Density rides on SIZE as
		// well as opacity, so a culled flake collapses to zero area before rasterisation.
		// The alive ramp is a smoothstep rather than a `step` because the gust threshold
		// sweeps several times a second and a hard cut flickers (see `wrapFade` for why a
		// pop is especially legible on snow).
		const alive = smoothstep(density.sub(0.06), density, aRandom).oneMinus();
		material.vertexNode = billboardClip(
			vec3(x, y, z),
			corner.mul(aSize.mul(uSizeScale).mul(alive))
		);

		// SETTLING. The same height field Rain collides against (heightField.ts), read the
		// same way: the mesh is camera-anchored with no rotation or scale, so the flake's
		// world position is just the local one through the model matrix.
		//
		// Snow does NOT splash -- a flake that reaches a surface has landed, so it fades
		// out over the last few centimetres of its fall rather than vanishing on a step.
		//
		// Where the field has no data `valid` is 0, `settle` collapses to 1, and flakes
		// fall through as they did before -- the same fail-safe Rain relies on.
		const world = modelWorldMatrix.mul(vec4(x, y, z, 1)).xyz;
		const { height: surfaceWorldY, valid } = sampleHeightField(world);
		const aboveSurface = world.y.sub(surfaceWorldY);
		const settle = mix(float(1), smoothstep(float(0), float(0.35), aboveSurface), valid);

		// THE SPECK: inverse-distance falloff, ported from the reference's
		// 0.5/distance - 1. The quad's corners are +/-1, so distance to centre is
		// length(corner) * 0.5 with the quad's edge at 0.5 -- the exact normalisation
		// gl_PointCoord gives point sprites. Bright core at a quarter of the radius,
		// gone at the edge; the epsilon guards the divide at the exact centre.
		const dist = sqrt(corner.x.mul(corner.x).add(corner.y.mul(corner.y))).mul(0.5);
		const speck = float(0.5).div(dist.max(1e-3)).sub(1).clamp(0, 1);

		// THE TWINKLE (see the header): each flake gets its own rate and reads its phase
		// from the one it already carries, so the field scintillates rather than pulsing
		// together. Off the raw `time` node deliberately -- unlike the fall and the drift,
		// the rate here is a per-flake CONSTANT, so there is no multiplier that can change
		// under absolute elapsed time and no teleport to design around.
		const twinkle = sin(time.mul(aTwinkleRate).add(aPhase.mul(6.283)))
			.mul(0.17)
			.add(0.87);

		// The near fade, as Rain's. A flake half a metre from the lens is a soft white disc
		// across a chunk of the frame and is also, physically, far inside the near focus.
		const viewDistance = modelViewMatrix.mul(vec4(x, y, z, 1)).xyz.length();
		const nearFade = smoothstep(float(NEAR_FADE_START), float(NEAR_FADE_END), viewDistance);

		material.colorNode = uFlakeTint;
		material.opacityNode = opacity
			.mul(speck)
			.mul(aBright)
			.mul(twinkle)
			.mul(settle)
			.mul(wrapFade)
			.mul(nearFade)
			.mul(alive);

		return { geometry: instancedQuad(count), material };
	};

	const { geometry, material } = build();

	// The wind accumulator's rate, world units per second at full wind channel.
	let driftX = 0;
	let driftZ = 0;
	const WIND_RATE = 1.1;

	/** How deeply a full-strength gust cuts into the density. Gentler than Rain's 0.45. */
	const SHEET_STRENGTH = 0.35;
	/** Flurry phase rate, rad/s: a slow breathing base plus the wind's own drive. */
	const GUST_RATE = 0.05;
	const GUST_RATE_WIND = 0.8;

	useTask(
		(delta) => {
			const w = descriptor.weather;
			// The complement of Rain's share, from the same `precipitationType` channel and
			// the same shared definition -- no second copy of the gate constants to drift.
			const snow = snowAmount(w);

			// Intensity, split the way Rain's is: `presence` only takes the layer cleanly to
			// zero, and DENSITY carries the difference between flurries and a whiteout.
			const presence = Math.min(1, snow * 4);
			opacity.value = Math.min(0.95, presence * (0.35 + w.cloudCover * 0.65));
			uDensity.value = clamp01(0.08 + 0.92 * snow);
			// Size is the third knob, alongside presence and density: a flurry is made of
			// smaller flakes as well as fewer.
			uSizeScale.value = 0.75 + 0.4 * snow;

			// Heavier snow falls faster, through the accumulator (see `uFallTime`).
			uFallTime.value += delta * (0.7 + 0.3 * snow);

			// Advance the accumulated wind travel ALONG THE BEARING (see `uWindDrift`):
			// accumulating means a change of strength OR direction only bends the path from
			// here on, which is what a shifting wind does. Strength is a 0..1 INTENSITY.
			const wind = clamp01(w.wind);
			const dirX = windAxisX(w);
			const dirZ = windAxisZ(w);
			const travel = wind * WIND_RATE * delta;
			driftX += dirX * travel;
			driftZ += dirZ * travel;
			uWindDrift.value.set(driftX, driftZ);

			// The bare bearing goes out alongside the accumulated travel, for the flurry
			// bands -- they need an axis even where the strength scaling it is small.
			uWindDir.value.set(dirX, dirZ);
			uSheet.value = wind * SHEET_STRENGTH;
			uGustTime.value += delta * (GUST_RATE + wind * GUST_RATE_WIND);

			// Flakes are diffuse reflectors: ride the light hints so a night snowfall is
			// faint and cool, a daytime one near-white. The floor keeps a whiteout from
			// going fully invisible at midnight.
			const { ambient, intensity } = descriptor.light;
			const lit = Math.min(1.05, Math.max(0.15, 0.18 + ambient * 0.45 + intensity * 0.08));
			// ...and COOL, not merely dim. Snow has no colour of its own; what it shows is
			// the light falling on it, and at night that is sky. Holding blue up while red
			// falls away is the whole of the difference between night snow and grey dust.
			const warm = Math.min(1, lit);
			uFlakeTint.value.set(lit * (0.78 + warm * 0.22), lit * (0.86 + warm * 0.14), lit);

			const visible = opacity.value > 0.01;
			if (mesh) {
				mesh.visible = visible;
				mesh.position.copy(camera.current.position);
			}
			// Animates off the TSL `time` node while it is snowing, and not at all
			// otherwise. See Skybox.svelte on renderMode.
			if (visible) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});

	// Keep 11 000 instances out of the cube captures, which render the whole scene six
	// times each. The floor reflector still gets them — its virtual camera is a clone of
	// the active one, so it inherits the bit. See PRECIPITATION_LAYER in skyLayer.ts.
	$effect(() => {
		mesh?.layers.set(PRECIPITATION_LAYER);
	});

	$effect(() => camera.subscribe((cam) => cam.layers.enable(PRECIPITATION_LAYER)));
</script>

<!-- renderOrder 3, as Rain: a near-camera layer drawing over the sky (1-2.6) and under
     the lightning wash (4). Never depth-pinned -- flakes have honest depth and must
     be occluded by the world. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={3}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
