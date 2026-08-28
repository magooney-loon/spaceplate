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
		fract,
		mix,
		modelViewMatrix,
		positionLocal,
		positionWorld,
		pow,
		sin,
		smoothstep,
		time,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { descriptor } from './model';
	import { MILKY_WAY_NORMAL as MW, MILKY_WAY_SIGMA } from './milkyWay';

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
		/** 0 = steady; higher = deeper irregular flicker. */
		twinkle?: number;
		twinkleSpeed?: number;
		/** Changing this reshuffles the sky; the field is otherwise identical every boot. */
		seed?: number;
	}

	let {
		count = 3000,
		radius = 1000,
		minSizeDeg = 0.16,
		maxSizeDeg = 0.42,
		twinkle = 0.55,
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

	// Two ends of the stellar-colour ramp: hot blue-white to cool amber. The ends are
	// more saturated than naked-eye reality, but only the population tails land on them
	// (see the warmth roll below) -- the bulk stays near-white with colourful accents,
	// which is how a real night sky actually reads.
	const COOL: [number, number, number] = [1, 0.55, 0.28];
	const HOT: [number, number, number] = [0.58, 0.72, 1];

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
			// Direction, rejection-sampled against the Milky Way profile (see milkyWay.ts):
			// acceptance runs from ~12% far off the band to ~100% inside it, so the star
			// budget pools into a river instead of spreading as uniform static. The count
			// is higher than the pre-band 2200 because the off-band sky pays for the river.
			//
			// The underlying sample is still uniform-on-sphere (uniform cos(theta)), so the
			// band is the only anisotropy -- rejection sampling on top of a biased sample
			// would compound the bias.
			let dx = 0;
			let dy = 0;
			let dz = 0;
			let band = 0;
			for (let tries = 0; tries < 64; tries++) {
				const cosTheta = rng() * 2 - 1;
				const phi = rng() * Math.PI * 2;
				const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
				dx = sinTheta * Math.cos(phi);
				dy = cosTheta;
				dz = sinTheta * Math.sin(phi);
				const offPlane = dx * MW[0] + dy * MW[1] + dz * MW[2];
				band = Math.exp(-(offPlane * offPlane) / (2 * MILKY_WAY_SIGMA * MILKY_WAY_SIGMA));
				if (rng() < 0.12 + 0.88 * band) break;
			}
			dx *= radius;
			dy *= radius;
			dz *= radius;

			// Magnitude, cubed so the sky is mostly faint stars with a few bright ones --
			// a flat distribution reads as television static. Band stars are pulled
			// fainter still: the real Milky Way is overwhelmingly an unresolved wash with
			// a handful of field giants on top.
			const mag = Math.pow(rng(), 3) * (1 - 0.45 * band);
			const halfAngle = (minSizeDeg + (maxSizeDeg - minSizeDeg) * mag) * 0.5 * DEG;
			// View-space half-extent that subtends `halfAngle` at `radius`. Because every
			// star sits at the same radius, a fixed view-space offset is a fixed angular
			// size, so no per-vertex distance maths is needed in the shader.
			const halfSize = radius * Math.tan(halfAngle);

			// Brightness is folded into the colour: the material is additive, so a dim
			// star is simply a dim colour and no extra attribute is needed. The floor is
			// slightly generous -- the twinkle beats average below 1, and the sky should
			// feel alive rather than dim.
			const brightness = 0.28 + 0.82 * mag;

			// Three rough stellar populations rather than a flat ramp, which tints every
			// star the same lukewarm white: a hot blue-white tail, an amber-to-ember tail,
			// and a mostly-white middle. The tails are what make a sky read 'colourful'
			// while the middle keeps it from turning into a circus.
			const roll = rng();
			let warmth: number;
			if (roll < 0.2) {
				warmth = rng() * 0.28; // Rigel: icy blue-white
			} else if (roll < 0.48) {
				warmth = 0.72 + rng() * 0.28; // Betelgeuse: amber to ember
			} else {
				warmth = 0.36 + rng() * 0.32; // Sirius: near-white
			}
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

		// Fade out below the horizon. Scenes without a ground plane would otherwise show
		// a full sphere of stars underfoot; scenes with one occlude them by depth anyway.
		// Defined before the twinkle because scintillation keys off it too.
		const horizon = smoothstep(float(-0.06), float(0.1), positionWorld.y.div(float(radius)));

		// Twinkle. A single sine at a single frequency reads as a disco ball no matter
		// the phase offsets; real scintillation is irregular, and every star has its own
		// rhythm and depth. The extra per-star randoms are derived from the seed
		// attribute rather than shipping more vertex data.
		const rndA = fract(aSeed.mul(7.31));
		const rndB = fract(aSeed.mul(5.19));
		const rndC = fract(aSeed.mul(3.73));
		const slow = sin(
			time
				.mul(float(twinkleSpeed * 0.5).add(rndA.mul(twinkleSpeed * 1.8)))
				.add(aSeed.mul(Math.PI * 2))
		)
			.mul(0.5)
			.add(0.5);
		const fast = sin(
			time.mul(float(twinkleSpeed * 3).add(rndB.mul(twinkleSpeed * 6))).add(rndB.mul(Math.PI * 2))
		)
			.mul(0.5)
			.add(0.5);
		// Product of two sines at incommensurate rates: quasi-random beats with rare
		// coincident peaks -- the glints.
		const beat = slow.mul(fast);
		// Skewed so most stars barely breathe and a few flash hard, like a real sky --
		// and deepened near the horizon, where the light crosses the most air. That is
		// the strongest single cue that the sky has ATMOSPHERE: watch a star sitting
		// low and it thrashes; look up and the zenith is steady.
		const depth = float(twinkle)
			.mul(float(0.15).add(pow(rndC, float(1.6)).mul(0.85)))
			.mul(float(1).add(horizon.oneMinus().mul(1.4)))
			.min(0.9);
		const flicker = beat.oneMinus().mul(depth).oneMinus();
		// Saturation rides the beat: dim moments go pale, glints go vivid.
		const lum = dot(aColor, vec3(0.299, 0.587, 0.114));

		// Atmospheric extinction: a star near the horizon shines through several times
		// more air than at the zenith, which dims it and reddens it noticeably before
		// the hard horizon fade below ever kicks in. The band spans tens of degrees,
		// unlike the fade -- extinction is gradual, occlusion is not.
		const elevation = smoothstep(float(0.02), float(0.45), positionWorld.y.div(float(radius)));
		const extinction = mix(vec3(1, 0.66, 0.42), vec3(1), elevation);

		material.colorNode = mix(vec3(lum), aColor, beat.mul(0.55).add(0.75)).mul(extinction);
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
