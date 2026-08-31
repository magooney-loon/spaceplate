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
	// follows the player without needing a world-sized particle system.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		attribute,
		cameraProjectionMatrix,
		float,
		fract,
		modelViewMatrix,
		positionLocal,
		sin,
		cos,
		sqrt,
		time,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { descriptor } from './model';

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

	const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
	const smooth01 = (edge0: number, edge1: number, v: number) => {
		const k = clamp01((v - edge0) / (edge1 - edge0));
		return k * k * (3 - 2 * k);
	};

	const mulberry32 = (a: number) => () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const buildGeometry = (): THREE.BufferGeometry => {
		const rng = mulberry32(seed);
		const geometry = new THREE.BufferGeometry();

		const positions = new Float32Array(count * 4 * 3);
		const corners = new Float32Array(count * 4 * 2);
		const params = new Float32Array(count * 4 * 4); // speed, size, phase, swayAmp
		const params2 = new Float32Array(count * 4 * 2); // windMul, bright
		const indices = new Uint32Array(count * 6);
		const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

		for (let i = 0; i < count; i++) {
			const x = (rng() - 0.5) * width;
			const y = (rng() - 0.5) * height;
			const z = (rng() - 0.5) * depth;
			const speed = minSpeed + rng() * (maxSpeed - minSpeed);
			const size = sizeWorld * (0.4 + rng() * 0.9);
			const phase = rng();
			const amp = swayAmp * (0.4 + rng() * 0.6);
			const windMul = 0.5 + rng() * 0.8;
			const bright = 0.75 + rng() * 0.25;

			for (let v = 0; v < 4; v++) {
				const p = i * 4 + v;
				positions[p * 3] = x;
				positions[p * 3 + 1] = y;
				positions[p * 3 + 2] = z;
				corners[p * 2] = CORNERS[v * 2];
				corners[p * 2 + 1] = CORNERS[v * 2 + 1];
				params[p * 4] = speed;
				params[p * 4 + 1] = size;
				params[p * 4 + 2] = phase;
				params[p * 4 + 3] = amp;
				params2[p * 2] = windMul;
				params2[p * 2 + 1] = bright;
			}

			const base = i * 4;
			const tri = i * 6;
			indices[tri] = base;
			indices[tri + 1] = base + 1;
			indices[tri + 2] = base + 2;
			indices[tri + 3] = base;
			indices[tri + 4] = base + 2;
			indices[tri + 5] = base + 3;
		}

		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
		geometry.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
		geometry.setAttribute('aParams2', new THREE.BufferAttribute(params2, 2));
		geometry.setIndex(new THREE.BufferAttribute(indices, 1));
		return geometry;
	};

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = new THREE.MeshBasicNodeMaterial();
		material.transparent = true;
		material.depthWrite = false;
		material.depthTest = true;
		material.blending = THREE.NormalBlending;
		material.toneMapped = false;
		// As Rain: the box hugs the camera well inside the fog band, and fogging a
		// NormalBlended sprite mixes it toward the fog colour rather than hiding it.
		material.fog = false;

		// The explicit generic is required -- see Stars.svelte.
		const aCorner = attribute<'vec2'>('aCorner', 'vec2');
		const aParams = attribute<'vec4'>('aParams', 'vec4');
		const aParams2 = attribute<'vec2'>('aParams2', 'vec2');
		const aSpeed = aParams.x;
		const aSize = aParams.y;
		const aPhase = aParams.z;
		const aSwayAmp = aParams.w;
		const aWindMul = aParams2.x;
		const aBright = aParams2.y;

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
		const y = fract(positionLocal.y.add(halfHeight).sub(fall).div(boxHeight))
			.mul(boxHeight)
			.sub(halfHeight);

		// THE SWIRL, as the reference: sway phased by POSITION (z's phase comes from x,
		// x's phase from the already-swayed z -- sequential, exactly like the shader it
		// was ported from), so neighbours move together and the field shears like one
		// wind field. Both sway terms sit INSIDE the wrap. The spatial rate (0.12)
		// tunes the coherence: ~1.5 swirl cells across the box -- fully shared phase
		// would move the field as one rigid sheet, fully independent phase reads as
		// jitter. The 0.5 temporal rate is the reference's lazy meander.
		const xBase = positionLocal.x.add(halfWidth).add(uWindDrift.mul(aWindMul));
		const zBase = positionLocal.z.add(halfDepth).add(uWindDrift.mul(aWindMul).mul(0.55));

		const swayZ = sin(time.mul(0.5).add(xBase.mul(0.12)))
			.mul(aSwayAmp)
			.mul(0.8);
		const z = fract(zBase.add(swayZ).div(boxDepth)).mul(boxDepth).sub(halfDepth);

		const swayX = cos(time.mul(0.5).add(z.mul(0.12))).mul(aSwayAmp);
		const x = fract(xBase.add(swayX).div(boxWidth)).mul(boxWidth).sub(halfWidth);

		// Camera-facing billboard, as Rain/Stars: offset the corner AFTER the
		// model-view transform. One pure expression, no Fn stack needed (see Stars).
		const mv = modelViewMatrix.mul(vec4(x, y, z, 1));
		const offset = aCorner.mul(aSize);
		material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.z, mv.w));

		// THE SPECK: inverse-distance falloff, ported from the reference's
		// 0.5/distance - 1. The quad's corners are +/-1, so distance to centre is
		// length(corner) * 0.5 with the quad's edge at 0.5 -- the exact normalisation
		// gl_PointCoord gives point sprites. Bright core at a quarter of the radius,
		// gone at the edge; the epsilon guards the divide at the exact centre.
		const dist = sqrt(aCorner.x.mul(aCorner.x).add(aCorner.y.mul(aCorner.y))).mul(0.5);
		const speck = float(0.5).div(dist.max(1e-3)).sub(1).clamp(0, 1);

		material.colorNode = vec3(uLight);
		material.opacityNode = opacity.mul(speck).mul(aBright);
		return material;
	};

	// Built once, not $derived -- authored constants in; change a prop and remount.
	const geometry = buildGeometry();
	const material = buildMaterial();

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

			// Advance the accumulated wind travel. Signed: the channel maps to [-1, 1].
			windDrift += (w.wind * 2 - 1) * WIND_RATE * delta;
			uWindDrift.value = windDrift;

			// Flakes are diffuse reflectors: ride the light hints so a night snowfall is
			// faint and cool, a daytime one near-white. The floor keeps a whiteout from
			// going fully invisible at midnight.
			const { ambient, intensity } = descriptor.light;
			uLight.value = Math.min(1.05, Math.max(0.15, 0.18 + ambient * 0.45 + intensity * 0.08));

			if (mesh) {
				mesh.visible = opacity.value > 0.01;
				mesh.position.copy(camera.current.position);
			}
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

<!-- renderOrder 3, as Rain: a near-camera layer drawing over the sky (1-2.6) and under
     the lightning wash (4). Never depth-pinned -- flakes have honest depth and must
     be occluded by the world. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={3}
	frustumCulled={false}
	userData={{ hideInTree: true, selectable: false }}
/>
