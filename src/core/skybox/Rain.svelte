<script lang="ts">
	// WebGPU-safe rain layer.
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
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import { float, fract, positionLocal, pow, smoothstep, time, uniform, vec3 } from 'three/tsl';
	import { clamp01, descriptor, mulberry32, smooth01 } from './model';
	import {
		instancedQuad,
		instancedVec3,
		instancedVec4,
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
		seed = 20260831
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

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
	 * Builds the field and its material together, once. One closure because every input
	 * is a BUILD-TIME prop -- see the same note in Stars.svelte.
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

		const material = skyLayerMaterial({ side: THREE.DoubleSide });

		const aCenter = instancedVec3(centers);
		const aParams = instancedVec4(params);
		const aSpeed = aParams.x;
		const aLength = aParams.y;
		const aWidth = aParams.z;
		const aPhase = aParams.w;

		// Head-anchored quad: x is the cross-axis corner, y walks head (0) to tail (1).
		const corner = positionLocal.xy;
		const across = corner.x;
		const along = corner.y;

		const halfWidth = float(width * 0.5);
		const halfHeight = float(height * 0.5);
		const halfDepth = float(depth * 0.5);
		const boxWidth = float(width);
		const boxHeight = float(height);
		const boxDepth = float(depth);

		const fall = time.mul(aSpeed).add(aPhase.mul(boxHeight));
		const x = fract(aCenter.x.add(halfWidth).add(fall.mul(wind).mul(0.16)).div(boxWidth))
			.mul(boxWidth)
			.sub(halfWidth);
		const y = fract(aCenter.y.add(halfHeight).sub(fall).div(boxHeight))
			.mul(boxHeight)
			.sub(halfHeight);
		const z = fract(aCenter.z.add(halfDepth).add(fall.mul(wind).mul(0.07)).div(boxDepth))
			.mul(boxDepth)
			.sub(halfDepth);

		const head = vec3(x, y, z);
		const tail = vec3(
			x.sub(wind.mul(aLength).mul(0.35)),
			y.add(aLength),
			z.sub(wind.mul(aLength).mul(0.15))
		);
		// Deliberately NOT depth-pinned, unlike the dome layers: a drop is near the camera
		// and must be occluded by scene geometry, so it keeps its honest depth.
		material.vertexNode = streakClip(head, tail, along, across, aWidth);

		const alongFade = smoothstep(float(0), float(0.18), along).mul(
			smoothstep(float(0.55), float(1), along).oneMinus()
		);
		const edgeFade = pow(across.abs().oneMinus(), float(0.7));

		material.colorNode = vec3(0.55, 0.66, 0.78);
		material.opacityNode = opacity.mul(alongFade).mul(edgeFade);

		return { geometry: instancedQuad(count, HEAD_ANCHORED_QUAD), material };
	};

	const { geometry, material } = build();

	useTask(
		() => {
			// Until the descriptor grows an explicit precipitation type, the shipped
			// weather library distinguishes rain/storm from snow through cloudType.
			const rainType = smooth01(0.45, 0.6, descriptor.weather.cloudType);
			const rain = descriptor.weather.precipitation * rainType;
			opacity.value = Math.min(0.62, rain * (0.2 + descriptor.weather.cloudCover * 0.8));
			wind.value = clamp01(descriptor.weather.wind);

			const visible = opacity.value > 0.01;
			if (mesh) {
				mesh.visible = visible;
				mesh.position.copy(camera.current.position);
			}
			// The fall runs off the TSL `time` node, so it animates every frame while it
			// is raining -- and not at all when it is not. See Skybox.svelte on renderMode.
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

<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={3}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
