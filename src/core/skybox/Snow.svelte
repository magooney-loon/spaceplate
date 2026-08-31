<script lang="ts">
	// WebGPU snow layer -- the precipitation counterpart to Rain.svelte.
	//
	// THE GATE. The descriptor has one `precipitation` channel and no explicit type, so
	// the two layers split on `cloudType` (the temporary convention, see weatherMixer):
	// Rain renders above ~0.5, snow below. `snow` targets cloudType 0.35, `rain`/`storm`
	// 0.6/1.0, so exactly one layer is live per weather -- and during a blend across the
	// gate both run briefly, which reads as sleet rather than as a pop.
	//
	// THE LOOK, ported from a reference shader (the Journey-style point snow):
	//   - SPECKS, not blobs. The sprite is an inverse-distance falloff
	//     (0.5/d - 1, clamped): a tight bright core that fades fast, so a flake reads
	//     as a tiny point of light with a faint halo -- not as a soft disc. A soft disc
	//     at snow scale reads as styrofoam; this reads as snow.
	//   - SMALL. Median radius ~0.05 world units with modest variance. The reference
	//     perspective-scales its point size (uSize * 1/-z); world-unit billboards do
	//     that for free.
	//   - COHERENT SWAY. The horizontal wander is phased by POSITION, not by a random
	//     per-flake seed: sin(t + x*k) drives z, cos(t + z*k) drives x, exactly as the
	//     reference. Neighbours share phase, so the field shears and swirls like one
	//     wind field instead of jittering independently -- that coherence, more than
	//     anything else, is what makes it read as weather rather than as particles.
	//     The sway sits INSIDE the wrap, as in the reference: a flake pushed past the
	//     box edge re-enters on the far side, indistinguishable among thousands.
	//
	// THE MOTION is all in the vertex node -- zero CPU work per frame per flake, exactly
	// as Rain: slow fall (fractions of rain's speed), fract-wrapped through the box, plus
	// an accumulated wind-drift term. Flakes are diffuse reflectors, so brightness rides
	// the descriptor's light hints -- near-white in day sun, faint grey-blue under a
	// night deck. Rain hardcodes its colour; snow cannot afford to, a white flake at
	// midnight would read as a spark.
	//
	// The mesh is recentered on the active camera every frame, as Rain is, so the box
	// follows the player without needing a world-sized particle system. The quad is
	// instanced for the same reason Rain's is: this layer's per-flake data was the
	// heaviest in the subsystem at 2.20 MB, against 0.40 MB now.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		cos,
		float,
		fract,
		mix,
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
	import { clamp01, descriptor, mulberry32, smooth01 } from './model';
	import { sampleHeightField } from './heightField';
	import {
		billboardClip,
		instancedQuad,
		instancedVec2,
		instancedVec3,
		instancedVec4,
		skyLayerMaterial,
		SKY_LAYER_USERDATA
	} from './skyLayer';

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
	 * Accumulated wind travel, in world units -- NOT `time * wind`. Snow falls slowly
	 * enough to track a flake, so the §15.7 teleport matters here: a time-multiplied
	 * wind term kicks the whole field sideways by `elapsed x delta_wind` the moment the
	 * channel blends, and the kick grows the longer the session runs. Rain tolerates
	 * that (its streaks reshuffle constantly anyway); this layer accumulates the offset
	 * on the CPU, exactly as CloudDeck.svelte does, so wind changes only alter the rate.
	 */
	const uWindDrift = uniform(0);
	/** Flake brightness, derived from the light hints. White in day, grey-blue at night. */
	const uLight = uniform(0.3);

	/**
	 * Builds the field and its material together, once. One closure because every input
	 * is a BUILD-TIME prop -- see the same note in Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Per-flake data: box position, (speed, size, phase, swayAmp), (windMul, bright).
		const centers = new Float32Array(count * 3);
		const params = new Float32Array(count * 4);
		const params2 = new Float32Array(count * 2);

		for (let i = 0; i < count; i++) {
			centers[i * 3] = (rng() - 0.5) * width;
			centers[i * 3 + 1] = (rng() - 0.5) * height;
			centers[i * 3 + 2] = (rng() - 0.5) * depth;
			params[i * 4] = minSpeed + rng() * (maxSpeed - minSpeed);
			params[i * 4 + 1] = sizeWorld * (0.4 + rng() * 0.9);
			params[i * 4 + 2] = rng();
			params[i * 4 + 3] = swayAmp * (0.4 + rng() * 0.6);
			params2[i * 2] = 0.5 + rng() * 0.8; // windMul
			params2[i * 2 + 1] = 0.75 + rng() * 0.25; // bright
		}

		const material = skyLayerMaterial();

		const aCenter = instancedVec3(centers);
		const aParams = instancedVec4(params);
		const aParams2 = instancedVec2(params2);
		const aSpeed = aParams.x;
		const aSize = aParams.y;
		const aPhase = aParams.z;
		const aSwayAmp = aParams.w;
		const aWindMul = aParams2.x;
		const aBright = aParams2.y;

		const corner = positionLocal.xy;

		const halfWidth = float(width * 0.5);
		const halfHeight = float(height * 0.5);
		const halfDepth = float(depth * 0.5);
		const boxWidth = float(width);
		const boxHeight = float(height);
		const boxDepth = float(depth);

		// FALL + WRAP. Identical construction to Rain's Y: travel accumulates with time
		// (seeded by a per-flake phase so the population starts spread through the box),
		// and fract() recycles flakes through the box forever.
		const fall = time.mul(aSpeed).add(aPhase.mul(boxHeight));
		const y = fract(aCenter.y.add(halfHeight).sub(fall).div(boxHeight))
			.mul(boxHeight)
			.sub(halfHeight);

		// THE SWIRL, as the reference: sway phased by POSITION (z's phase comes from x,
		// x's phase from the already-swayed z -- sequential, exactly like the shader it
		// was ported from), so neighbours move together and the field shears like one
		// wind field. Both sway terms sit INSIDE the wrap. The spatial rate (0.12)
		// tunes the coherence: ~1.5 swirl cells across the box -- fully shared phase
		// would move the field as one rigid sheet, fully independent phase reads as
		// jitter. The 0.5 temporal rate is the reference's lazy meander.
		const xBase = aCenter.x.add(halfWidth).add(uWindDrift.mul(aWindMul));
		const zBase = aCenter.z.add(halfDepth).add(uWindDrift.mul(aWindMul).mul(0.55));

		const swayZ = sin(time.mul(0.5).add(xBase.mul(0.12)))
			.mul(aSwayAmp)
			.mul(0.8);
		const z = fract(zBase.add(swayZ).div(boxDepth)).mul(boxDepth).sub(halfDepth);

		const swayX = cos(time.mul(0.5).add(z.mul(0.12))).mul(aSwayAmp);
		const x = fract(xBase.add(swayX).div(boxWidth)).mul(boxWidth).sub(halfWidth);

		// Camera-facing billboard, as Rain/Stars. Deliberately NOT depth-pinned: flakes
		// have honest depth and must be occluded by the world.
		material.vertexNode = billboardClip(vec3(x, y, z), corner.mul(aSize));

		// SETTLING. The same height field Rain collides against (heightField.ts), read the
		// same way: the mesh is camera-anchored with no rotation or scale, so the flake's
		// world position is just the local one through the model matrix.
		//
		// Snow does NOT splash -- a flake that reaches a surface has landed, so it fades
		// out over the last few centimetres of its fall rather than vanishing on a step.
		// That soft edge matters more here than it does for rain: flakes are slow enough to
		// watch individually, and a hard cut reads as popping.
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

		material.colorNode = vec3(uLight);
		material.opacityNode = opacity.mul(speck).mul(aBright).mul(settle);

		return { geometry: instancedQuad(count), material };
	};

	const { geometry, material } = build();

	// The wind accumulator's rate, world units per second at full wind channel.
	let windDrift = 0;
	const WIND_RATE = 1.1;

	useTask(
		(delta) => {
			const w = descriptor.weather;
			// The complement of Rain's gate: snow below the cloudType band.
			const snowType = 1 - smooth01(0.45, 0.6, w.cloudType);
			const snow = w.precipitation * snowType;
			opacity.value = Math.min(0.95, snow * (0.35 + w.cloudCover * 0.65));

			// Advance the accumulated wind travel. A 0..1 INTENSITY along a fixed axis,
			// matching the channel's documented meaning and CloudDeck's reading of it.
			// This used to be `(w.wind * 2 - 1)`, treating 0.5 as neutral -- so the boot
			// default (0.1) drifted flakes at 0.88 units/s in still air, twice as fast as
			// the `snow` weather's own 0.3 and in the opposite direction.
			windDrift += clamp01(w.wind) * WIND_RATE * delta;
			uWindDrift.value = windDrift;

			// Flakes are diffuse reflectors: ride the light hints so a night snowfall is
			// faint and cool, a daytime one near-white. The floor keeps a whiteout from
			// going fully invisible at midnight.
			const { ambient, intensity } = descriptor.light;
			uLight.value = Math.min(1.05, Math.max(0.15, 0.18 + ambient * 0.45 + intensity * 0.08));

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
