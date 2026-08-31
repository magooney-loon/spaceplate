<script lang="ts">
	// WebGPU-safe rain layer.
	//
	// The reference implementation used LineSegments + LineBasicMaterial.onBeforeCompile.
	// That is a WebGL shader-patching path, so this version uses TSL-driven quads:
	// each drop is a tiny billboarded rectangle animated in the vertex node. The mesh is
	// recentered on the active camera every frame, so games can change level scale or
	// camera far range without needing a world-sized particle system.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		attribute,
		cameraProjectionMatrix,
		float,
		fract,
		mix,
		modelViewMatrix,
		positionLocal,
		pow,
		smoothstep,
		time,
		uniform,
		vec2,
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
	const wind = uniform(0);

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
		const params = new Float32Array(count * 4 * 4);
		const indices = new Uint32Array(count * 6);
		const CORNERS = [-1, 0, 1, 0, 1, 1, -1, 1];

		for (let i = 0; i < count; i++) {
			const x = (rng() - 0.5) * width;
			const y = (rng() - 0.5) * height;
			const z = (rng() - 0.5) * depth;
			const speed = minSpeed + rng() * (maxSpeed - minSpeed);
			const dropLength = length * (0.65 + rng() * 0.7);
			const dropWidth = widthWorld * (0.65 + rng() * 0.9);
			const phase = rng();

			for (let v = 0; v < 4; v++) {
				const p = i * 4 + v;
				positions[p * 3] = x;
				positions[p * 3 + 1] = y;
				positions[p * 3 + 2] = z;
				corners[p * 2] = CORNERS[v * 2];
				corners[p * 2 + 1] = CORNERS[v * 2 + 1];
				params[p * 4] = speed;
				params[p * 4 + 1] = dropLength;
				params[p * 4 + 2] = dropWidth;
				params[p * 4 + 3] = phase;
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
		material.fog = false;
		material.side = THREE.DoubleSide;

		const aCorner = attribute<'vec2'>('aCorner', 'vec2');
		const aParams = attribute<'vec4'>('aParams', 'vec4');
		const aSpeed = aParams.x;
		const aLength = aParams.y;
		const aWidth = aParams.z;
		const aPhase = aParams.w;

		const halfWidth = float(width * 0.5);
		const halfHeight = float(height * 0.5);
		const halfDepth = float(depth * 0.5);
		const boxWidth = float(width);
		const boxHeight = float(height);
		const boxDepth = float(depth);

		const fall = time.mul(aSpeed).add(aPhase.mul(boxHeight));
		const x = fract(positionLocal.x.add(halfWidth).add(fall.mul(wind).mul(0.16)).div(boxWidth))
			.mul(boxWidth)
			.sub(halfWidth);
		const y = fract(positionLocal.y.add(halfHeight).sub(fall).div(boxHeight))
			.mul(boxHeight)
			.sub(halfHeight);
		const z = fract(positionLocal.z.add(halfDepth).add(fall.mul(wind).mul(0.07)).div(boxDepth))
			.mul(boxDepth)
			.sub(halfDepth);

		const head = vec3(x, y, z);
		const tail = vec3(x.sub(wind.mul(aLength).mul(0.35)), y.add(aLength), z.sub(wind.mul(aLength).mul(0.15)));
		const along = aCorner.y;

		const headVS = modelViewMatrix.mul(vec4(head, 1));
		const tailVS = modelViewMatrix.mul(vec4(tail, 1));
		const motion = tailVS.xy.sub(headVS.xy).add(vec2(1e-5, 1e-5)).normalize();
		const perpendicular = vec2(motion.y.negate(), motion.x);
		const spine = mix(headVS, tailVS, along);
		const offset = perpendicular.mul(aCorner.x.mul(aWidth));
		material.vertexNode = cameraProjectionMatrix.mul(vec4(spine.xy.add(offset), spine.z, spine.w));

		const alongFade = smoothstep(float(0), float(0.18), along).mul(
			smoothstep(float(0.55), float(1), along).oneMinus()
		);
		const edgeFade = pow(aCorner.x.abs().oneMinus(), float(0.7));

		material.colorNode = vec3(0.55, 0.66, 0.78);
		material.opacityNode = opacity.mul(alongFade).mul(edgeFade);
		return material;
	};

	const geometry = buildGeometry();
	const material = buildMaterial();

	useTask(
		() => {
			// Until the descriptor grows an explicit precipitation type, the shipped
			// weather library distinguishes rain/storm from snow through cloudType.
			const rainType = smooth01(0.45, 0.6, descriptor.weather.cloudType);
			const rain = descriptor.weather.precipitation * rainType;
			opacity.value = Math.min(0.62, rain * (0.2 + descriptor.weather.cloudCover * 0.8));
			wind.value = descriptor.weather.wind * 2 - 1;

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

<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={3}
	frustumCulled={false}
	userData={{ hideInTree: true, selectable: false }}
/>
