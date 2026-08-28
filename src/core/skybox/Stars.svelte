<script lang="ts">
	// The star field. A descriptor consumer, driven by `descriptor.sky.starVisibility`.
	//
	// WHY QUADS AND NOT POINTS. The obvious implementation is THREE.Points with
	// PointsNodeMaterial.sizeNode. It does not work here, and it fails silently. From
	// three's own source (PointsNodeMaterial, 0.185.1):
	//
	//   "WebGPU only supports point primitives with 1 pixel size. Consequently, this
	//    node has no effect when the material is used with Points and a WebGPU backend."
	//
	// So every star would be exactly one pixel, with sizeNode quietly ignored. This
	// builds camera-facing quads instead and billboards them in TSL -- two triangles per
	// star, one draw call, full control over size and falloff. That is also why
	// @threlte/extras' <Stars> was dropped: it is a raw ShaderMaterial, which WebGPU
	// silently replaces with a blank NodeMaterial (DOCS/webgpu-notes.md §1).
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		attribute,
		cameraProjectionMatrix,
		dot,
		float,
		modelViewMatrix,
		positionLocal,
		positionWorld,
		pow,
		sin,
		smoothstep,
		time,
		uniform,
		vec4
	} from 'three/tsl';
	import { descriptor } from './model';

	interface Props {
		count?: number;
		/** Distance the field is placed at. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/**
		 * Apparent diameter of the faintest and brightest stars, in degrees.
		 *
		 * `minSizeDeg` has a floor worth respecting. The bright core is roughly 44% of the
		 * quad's half-width, so at 0.10 deg (1.8 px at 1080p / fov 60) the core lands at
		 * ~0.35 px -- under one pixel, sampled erratically frame to frame, which reads as
		 * harsh flicker rather than as stars. 0.16 deg puts it just over a pixel.
		 */
		minSizeDeg?: number;
		maxSizeDeg?: number;
		/** 0 = steady, 1 = stars fully blink out at the trough. */
		twinkle?: number;
		twinkleSpeed?: number;
		/** Changing this reshuffles the sky; the field is otherwise identical every boot. */
		seed?: number;
	}

	let {
		count = 2200,
		radius = 1000,
		minSizeDeg = 0.16,
		maxSizeDeg = 0.42,
		twinkle = 0.35,
		twinkleSpeed = 1.6,
		seed = 20260828
	}: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	/** Deterministic PRNG -- the same seed must give the same sky on every reload. */
	const mulberry32 = (a: number) => () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	// Two ends of a rough stellar-colour ramp: hot blue-white to cool orange. Real star
	// colours are far more desaturated than people expect, hence the narrow spread.
	const COOL: [number, number, number] = [1, 0.82, 0.66];
	const HOT: [number, number, number] = [0.75, 0.83, 1];

	const DEG = Math.PI / 180;

	const buildGeometry = (): THREE.BufferGeometry => {
		const rng = mulberry32(seed);
		const geometry = new THREE.BufferGeometry();

		const positions = new Float32Array(count * 4 * 3);
		const corners = new Float32Array(count * 4 * 2);
		const colors = new Float32Array(count * 4 * 3);
		const sizes = new Float32Array(count * 4);
		const seeds = new Float32Array(count * 4);
		const indices = new Uint32Array(count * 6);

		// The four corners of the billboard, in units of half-size.
		const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

		for (let i = 0; i < count; i++) {
			// Uniform on the sphere: cos(theta) must be uniform, not theta itself, or the
			// stars bunch at the poles.
			const cosTheta = rng() * 2 - 1;
			const phi = rng() * Math.PI * 2;
			const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
			const dx = sinTheta * Math.cos(phi) * radius;
			const dy = cosTheta * radius;
			const dz = sinTheta * Math.sin(phi) * radius;

			// Magnitude, cubed so the sky is mostly faint stars with a few bright ones --
			// a flat distribution reads as television static.
			const mag = Math.pow(rng(), 3);
			const halfAngle = (minSizeDeg + (maxSizeDeg - minSizeDeg) * mag) * 0.5 * DEG;
			// View-space half-extent that subtends `halfAngle` at `radius`. Because every
			// star sits at the same radius, a fixed view-space offset is a fixed angular
			// size, so no per-vertex distance maths is needed in the shader.
			const halfSize = radius * Math.tan(halfAngle);

			// Brightness is folded into the colour: the material is additive, so a dim
			// star is simply a dim colour and no extra attribute is needed.
			const brightness = 0.22 + 0.78 * mag;
			const warmth = rng();
			const r = (HOT[0] + (COOL[0] - HOT[0]) * warmth) * brightness;
			const g = (HOT[1] + (COOL[1] - HOT[1]) * warmth) * brightness;
			const b = (HOT[2] + (COOL[2] - HOT[2]) * warmth) * brightness;

			const twinklePhase = rng();

			for (let v = 0; v < 4; v++) {
				const p = i * 4 + v;
				positions[p * 3] = dx;
				positions[p * 3 + 1] = dy;
				positions[p * 3 + 2] = dz;
				corners[p * 2] = CORNERS[v * 2];
				corners[p * 2 + 1] = CORNERS[v * 2 + 1];
				colors[p * 3] = r;
				colors[p * 3 + 1] = g;
				colors[p * 3 + 2] = b;
				sizes[p] = halfSize;
				seeds[p] = twinklePhase;
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
		geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
		geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
		geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
		geometry.setIndex(new THREE.BufferAttribute(indices, 1));
		return geometry;
	};

	const visibility = uniform(0);

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = new THREE.MeshBasicNodeMaterial();
		material.transparent = true;
		material.depthWrite = false;
		material.blending = THREE.AdditiveBlending;
		// Stars are their own light source; tone mapping them at night's 0.62 exposure
		// would dim the one thing that is supposed to be bright in a dark frame.
		material.toneMapped = false;

		// The explicit generic is required: `attribute` infers its node type from the
		// argument's *value*, so a bare 'vec2' widens to `string` and every downstream
		// node method disappears.
		const aCorner = attribute<'vec2'>('aCorner', 'vec2');
		const aColor = attribute<'vec3'>('aColor', 'vec3');
		const aSize = attribute<'float'>('aSize', 'float');
		const aSeed = attribute<'float'>('aSeed', 'float');

		// Billboard in view space: offset the corner AFTER the model-view transform, so
		// the quad always faces the camera without any per-star rotation.
		//
		// Built as ONE PURE EXPRESSION, with no .toVar() and no assignment. That is not a
		// style preference. TSL's assignment operators need a Fn() stack to record into,
		// and outside one they fail with "No stack defined for assign operation" -- a
		// console warning, not a throw. The first version of this used
		// `mv.xy.addAssign(...)`, the call was dropped, every quad's four vertices stayed
		// on the same point, and 2200 zero-area triangles rendered precisely nothing.
		// Either wrap the whole vertex node in Fn() (as SkyMesh does) or, as here, never
		// mutate: reassembling the vec4 from parts needs no stack at all.
		const mv = modelViewMatrix.mul(vec4(positionLocal, 1));
		const offset = aCorner.mul(aSize);
		const clip = cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.z, mv.w));
		// Depth pinned to the far plane, as SkyMesh does. Load-bearing: the camera's far
		// plane is 144 and the field sits at radius 1000, so honest projection would clip
		// every star. Pinning also puts the field behind all scene geometry.
		material.vertexNode = vec4(clip.xy, clip.w, clip.w);

		// Round falloff from the quad's centre. Two lobes -- a tight core plus a wide,
		// weak glow -- so a star reads as a point with a halo rather than a fuzzy blob.
		// Squared distance, which saves the sqrt and rounds the profile off nicely.
		//
		// Note the oneMinus() rather than smoothstep(1, 0, d): both GLSL and WGSL leave
		// smoothstep UNDEFINED when edge0 >= edge1, so the descending form is a portability
		// trap that happens to work on some drivers.
		const dist2 = dot(aCorner, aCorner);
		const disc = smoothstep(float(0), float(1), dist2).oneMinus();
		const shape = pow(disc, float(7)).add(pow(disc, float(2)).mul(0.22));

		// Per-star phase offset, otherwise the whole sky pulses in unison.
		const flicker = sin(time.mul(twinkleSpeed).add(aSeed.mul(Math.PI * 2)))
			.mul(0.5)
			.add(0.5)
			.mul(twinkle)
			.add(1 - twinkle);

		// Fade out below the horizon. Scenes without a ground plane would otherwise show
		// a full sphere of stars underfoot; scenes with one occlude them by depth anyway.
		const horizon = smoothstep(float(-0.06), float(0.1), positionWorld.y.div(float(radius)));

		material.colorNode = aColor;
		material.opacityNode = shape.mul(flicker).mul(horizon).mul(visibility);
		return material;
	};

	// Built once, deliberately NOT `$derived`. The field's inputs (count, seed, radius)
	// are authored constants, and a derived would hand the teardown effect the *new*
	// geometry to dispose while the old one leaked. Change a prop and remount, exactly
	// as Sky.svelte treats its SkyMesh.
	const geometry = buildGeometry();
	const material = buildMaterial();

	useTask(
		() => {
			// starVisibility is a day-curve output: 1 at solar midnight, 0 by mid-morning.
			visibility.value = descriptor.sky.starVisibility;
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
	{geometry}
	{material}
	renderOrder={1}
	frustumCulled={false}
	userData={{ hideInTree: true, selectable: false }}
/>
