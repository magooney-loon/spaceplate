<script lang="ts">
	// WebGPU-safe rain layer: falling streaks that STOP at the world's surfaces, plus the
	// two impact layers -- an expanding ground ring and a small upward burst.
	//
	// The reference implementation used LineSegments + LineBasicMaterial.onBeforeCompile.
	// That is a WebGL shader-patching path, so this version uses TSL-driven quads:
	// each drop is a tiny billboarded rectangle animated in the vertex node. The mesh is
	// recentered on the active camera every frame, so games can change level scale or
	// camera far range without needing a world-sized particle system.
	//
	// The quad is INSTANCED (skyLayer.ts): one head-anchored four-vertex quad drawn
	// `count` times. Each drop's box position and parameters used to be written into
	// four vertices apiece -- 1.52 MB of buffers for the shipped count, against 0.25 MB
	// now, allocated whether or not it is ever raining.
	//
	// ── COLLISION, AND WHY IT COSTS NOTHING PER DROP ──────────────────────────────────
	//
	// The fall is a deterministic sawtooth: `u = fract((y0 + halfH - t*speed) / boxH)` walks
	// 1 -> 0 and wraps. That determinism is the whole trick. Sampling the height field
	// (heightField.ts) gives the surface height under a drop, which converts to the sawtooth
	// phase `uImpact` at which that drop reaches it -- so "has it landed?" is `u <= uImpact`
	// and "how long ago?" is `(uImpact - u) * boxH / speed`, both closed-form in the vertex
	// stage. No CPU clock, no collision events, no per-drop state, and the splash layers can
	// reuse the drops' own instance buffers to find their impact points.
	//
	// Where the height field has no data -- outside its footprint, or before its first pass
	// -- `valid` is 0, `uImpact` is forced below the box, and drops fall straight through
	// exactly as they did before this existed. The failure mode is the old behaviour, never
	// drops frozen in mid-air.
	//
	// A consequence worth knowing: the field records only the TOPMOST surface per column, so
	// rain stops on a roof and does not reach the floor beneath it. Outdoors that is the
	// correct answer and gives sheltered spots for free; inside a multi-storey interior it
	// is not, and that geometry would need a different approach.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		float,
		fract,
		mix,
		modelWorldMatrix,
		positionLocal,
		pow,
		smoothstep,
		sqrt,
		step,
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
		instancedVec3,
		instancedVec4,
		projectClip,
		skyLayerMaterial,
		streakClip,
		HEAD_ANCHORED_QUAD,
		SKY_LAYER_USERDATA
	} from './skyLayer';

	interface Props {
		count?: number;
		/** Local box around the camera. Keep it inside the camera far plane. */
		width?: number;
		height?: number;
		depth?: number;
		length?: number;
		minSpeed?: number;
		maxSpeed?: number;
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
		length = 1.3,
		minSpeed = 16,
		maxSpeed = 28,
		widthWorld = 0.025,
		splashCount = 1500,
		ringDuration = 0.5,
		ringRadius = 0.28,
		burstDuration = 0.32,
		seed = 20260831
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let streaks = $state.raw<Mesh>();
	let rings = $state.raw<Mesh>();
	let bursts = $state.raw<Mesh>();

	const opacity = uniform(0);
	/**
	 * Wind as a 0..1 INTENSITY, matching the channel's documented meaning and every other
	 * consumer (CloudDeck reads it as a scroll magnitude, `clear` targets 0.08, `storm`
	 * 0.85). It used to be remapped to [-1, 1] with `wind * 2 - 1`, which made 0.5 the
	 * neutral point -- so `clear` weather (0.08) slanted the rain at -0.84 while `storm`
	 * (0.85) managed +0.70. Calm air produced a HARDER slant than a storm, mirrored.
	 * At 0 the drops now fall straight down, which is what no wind looks like.
	 */
	const wind = uniform(0);
	/**
	 * Splash brightness from the light hints, as Snow does for its flakes. Water is a
	 * reflector, so a ring at midnight must not glow at its noon brightness.
	 */
	const uLight = uniform(0.4);

	/** Droplets kicked up per impact. Each is one more instance in the burst layer. */
	const BURST_PER_IMPACT = 3;

	/**
	 * Builds every layer, once. One closure because all of it is BUILD-TIME props -- see
	 * the same note in Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Per-drop data: box position, and (speed, length, width, phase) packed as a vec4.
		const centers = new Float32Array(count * 3);
		const params = new Float32Array(count * 4);

		for (let i = 0; i < count; i++) {
			centers[i * 3] = (rng() - 0.5) * width;
			centers[i * 3 + 1] = (rng() - 0.5) * height;
			centers[i * 3 + 2] = (rng() - 0.5) * depth;
			params[i * 4] = minSpeed + rng() * (maxSpeed - minSpeed);
			params[i * 4 + 1] = length * (0.65 + rng() * 0.7);
			params[i * 4 + 2] = widthWorld * (0.65 + rng() * 0.9);
			params[i * 4 + 3] = rng();
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
		const motionOf = (aCenter: THREE.Node<'vec3'>, aParams: THREE.Node<'vec4'>) => {
			const aSpeed = aParams.x;
			const aPhase = aParams.w;

			const fall = time.mul(aSpeed).add(aPhase.mul(boxHeight));
			// The sawtooth, kept as its own value: everything below is expressed in it.
			const u = fract(aCenter.y.add(halfHeight).sub(fall).div(boxHeight));
			const localY = u.mul(boxHeight).sub(halfHeight);
			const x = fract(aCenter.x.add(halfWidth).add(fall.mul(wind).mul(0.16)).div(boxWidth))
				.mul(boxWidth)
				.sub(halfWidth);
			const z = fract(aCenter.z.add(halfDepth).add(fall.mul(wind).mul(0.07)).div(boxDepth))
				.mul(boxDepth)
				.sub(halfDepth);

			// The mesh is camera-anchored with no rotation or scale, so this is just a
			// translation -- but going through the matrix keeps it correct if that ever
			// changes.
			const world = modelWorldMatrix.mul(vec4(x, localY, z, 1)).xyz;
			const { height: surfaceWorldY, valid } = sampleHeightField(world);

			// The surface expressed in the box's local space: subtract the box origin,
			// which is `world.y - localY`.
			const surfaceLocalY = surfaceWorldY.sub(world.y).add(localY);
			// ...and the sawtooth phase at which the drop reaches it. Forced to -1 where the
			// field has no data, so `below` is 0 forever and the drop falls through.
			const uImpact = mix(float(-1), surfaceLocalY.add(halfHeight).div(boxHeight), valid);

			// 1 once the drop has reached the surface. Note a surface ABOVE the box top puts
			// uImpact past 1, so `below` is permanently 1 and no drop ever renders -- which
			// is exactly right: there is a roof overhead.
			const below = step(u, uImpact);
			// Seconds since impact. Only meaningful while `below` is 1.
			const secondsSinceImpact = uImpact.sub(u).mul(boxHeight).div(aSpeed);

			return { x, z, localY, surfaceLocalY, below, secondsSinceImpact, aParams };
		};

		// ── The streaks ──────────────────────────────────────────────────────────────
		const streakMaterial = skyLayerMaterial({ side: THREE.DoubleSide });
		{
			const aCenter = instancedVec3(centers);
			const aParams = instancedVec4(params);
			const aLength = aParams.y;
			const aWidth = aParams.z;
			const m = motionOf(aCenter, aParams);

			// Head-anchored quad: x is the cross-axis corner, y walks head (0) to tail (1).
			const corner = positionLocal.xy;
			const across = corner.x;
			const along = corner.y;

			const head = vec3(m.x, m.localY, m.z);
			const tail = vec3(
				m.x.sub(wind.mul(aLength).mul(0.35)),
				m.localY.add(aLength),
				m.z.sub(wind.mul(aLength).mul(0.15))
			);
			// Deliberately NOT depth-pinned, unlike the dome layers: a drop is near the
			// camera and must be occluded by scene geometry, so it keeps its honest depth.
			streakMaterial.vertexNode = streakClip(head, tail, along, across, aWidth);

			const alongFade = smoothstep(float(0), float(0.18), along).mul(
				smoothstep(float(0.55), float(1), along).oneMinus()
			);
			const edgeFade = pow(across.abs().oneMinus(), float(0.7));

			streakMaterial.colorNode = vec3(0.55, 0.66, 0.78);
			// `below.oneMinus()` is the collision: the streak stops existing the instant it
			// reaches the surface, and the ring and burst take over from the same solution.
			streakMaterial.opacityNode = opacity.mul(alongFade).mul(edgeFade).mul(m.below.oneMinus());
		}

		// The splash layers run over the first `splashCount` drops. `subarray` is a VIEW,
		// so this shares memory with the buffers above rather than copying them.
		const splashes = Math.max(0, Math.min(splashCount, count));
		const splashCenters = centers.subarray(0, splashes * 3);
		const splashParams = params.subarray(0, splashes * 4);

		// ── The impact ring ──────────────────────────────────────────────────────────
		// A ground-aligned quad at the impact point with an expanding, fading annulus.
		const ringMaterial = skyLayerMaterial();
		{
			const aCenter = instancedVec3(splashCenters);
			const aParams = instancedVec4(splashParams);
			const m = motionOf(aCenter, aParams);

			const corner = positionLocal.xy;
			const progress = m.secondsSinceImpact.div(ringDuration).clamp(0, 1);
			const active = m.below.mul(step(m.secondsSinceImpact, float(ringDuration)));

			// Laid flat in XZ at the surface, lifted a hair to stay off it: these share a
			// plane with the ground, and depth-testing coplanar geometry z-fights.
			const local = vec3(
				m.x.add(corner.x.mul(ringRadius)),
				m.surfaceLocalY.add(0.015),
				m.z.add(corner.y.mul(ringRadius))
			);
			// Honest projection, not depth-pinned: a ring lies on the world and must be
			// occluded by anything in front of it.
			ringMaterial.vertexNode = projectClip(local);

			// The ripple: a band at radius `progress`, thinning and fading as it expands.
			const r = sqrt(corner.x.mul(corner.x).add(corner.y.mul(corner.y)));
			const band = smoothstep(float(0), float(0.34), r.sub(progress).abs()).oneMinus();
			ringMaterial.colorNode = vec3(0.62, 0.72, 0.84).mul(uLight);
			ringMaterial.opacityNode = opacity.mul(active).mul(band).mul(progress.oneMinus()).mul(0.5);
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

					// Spread around the compass, jittered so the droplets are not a rosette.
					const angle = ((b + rng() * 0.7) / BURST_PER_IMPACT) * Math.PI * 2;
					burstShape[j * 4] = Math.cos(angle);
					burstShape[j * 4 + 1] = Math.sin(angle);
					burstShape[j * 4 + 2] = 0.06 + rng() * 0.1;
					burstShape[j * 4 + 3] = widthWorld * (1.4 + rng() * 1.6);
				}
			}

			const aCenter = instancedVec3(burstCenters);
			const aParams = instancedVec4(burstParams);
			const aShape = instancedVec4(burstShape);
			const m = motionOf(aCenter, aParams);

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
			burstMaterial.opacityNode = opacity.mul(active).mul(speck).mul(progress.oneMinus()).mul(0.7);
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

	useTask(
		() => {
			// Until the descriptor grows an explicit precipitation type, the shipped
			// weather library distinguishes rain/storm from snow through cloudType.
			const rainType = smooth01(0.45, 0.6, descriptor.weather.cloudType);
			const rain = descriptor.weather.precipitation * rainType;
			opacity.value = Math.min(0.62, rain * (0.2 + descriptor.weather.cloudCover * 0.8));
			wind.value = clamp01(descriptor.weather.wind);

			// Splashes are water catching the light, so they track the key and fill the
			// same way Snow's flakes do -- bright in daylight, faint under a night deck.
			const { ambient, intensity } = descriptor.light;
			uLight.value = Math.min(1.1, Math.max(0.2, 0.25 + ambient * 0.5 + intensity * 0.09));

			const visible = opacity.value > 0.01;
			const position = camera.current.position;
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
