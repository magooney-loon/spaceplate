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
		 * `minSizeDeg` has a floor worth respecting, and it is higher than it looks. The
		 * bright core is roughly 44% of the quad's half-width, so 0.16 deg (2.9 px at
		 * 1080p / fov 60) puts the core at ~1.3 px: still under two pixels, still sampled
		 * erratically as the camera turns, and the resulting shimmer gets blamed on the
		 * twinkle shader every time. 0.22 deg lands the core near 1.8 px. The faint stars
		 * that grow as a result are also much dimmer now (see `brightness` below), so they
		 * read as soft haze rather than as fat dots.
		 */
		minSizeDeg?: number;
		maxSizeDeg?: number;
		/** 0 = steady; higher = deeper irregular flicker. Gated by altitude -- see the twinkle block. */
		twinkle?: number;
		twinkleSpeed?: number;
		/** Changing this reshuffles the sky; the field is otherwise identical every boot. */
		seed?: number;
	}

	let {
		count = 3200,
		radius = 1000,
		minSizeDeg = 0.22,
		maxSizeDeg = 0.5,
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

	// Two ends of the stellar-colour ramp: hot blue-white to cool amber.
	//
	// These used to be [1, 0.55, 0.28] and [0.58, 0.72, 1] -- a deep ember and a frank
	// blue -- on the theory that only the population tails would reach them. They did
	// reach them, and the tails are half the sky (48% by the warmth roll below), so the
	// field read as confetti. Both ends are pulled in, and more importantly SATURATION IS
	// NOW COUPLED TO BRIGHTNESS: scotopic vision is very nearly colourblind, so a real
	// sky shows colour only in its handful of bright stars and renders the rest white.
	// That coupling, not the ramp ends, is what stops a star field looking like sprinkles.
	const COOL: [number, number, number] = [1, 0.74, 0.5];
	const HOT: [number, number, number] = [0.74, 0.83, 1];

	const DEG = Math.PI / 180;

	const buildGeometry = (): THREE.BufferGeometry => {
		const rng = mulberry32(seed);
		const geometry = new THREE.BufferGeometry();

		const positions = new Float32Array(count * 4 * 3);
		const corners = new Float32Array(count * 4 * 2);
		const colors = new Float32Array(count * 4 * 3);
		const sizes = new Float32Array(count * 4);
		const seeds = new Float32Array(count * 4);
		// Normalised magnitude, kept as its own attribute rather than recovered from
		// aColor's luminance: three separate shader terms (halo width, twinkle depth,
		// saturation) key off "how bright is this star", and luminance is contaminated by
		// the star's colour, so a red giant would read as fainter than it is.
		const mags = new Float32Array(count * 4);
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
			// star is simply a dim colour and no extra attribute is needed.
			//
			// THE FLOOR IS THE WHOLE BALLGAME. It used to be 0.28, against a ceiling of
			// 1.10 -- a 4:1 range, so all 3000 stars were plainly visible dots of roughly
			// equal weight, which is the definition of television static. A real sky spans
			// magnitude 1 to 6, about 100:1 in flux, and reads as a few obvious stars over
			// a haze of barely-there ones. 0.05 to 1.20 is 24:1: not physical, but enough
			// that the faint majority sinks into suggestion and the eye gets somewhere to
			// land. Mean brightness drops from 0.48 to ~0.27, which is why `count` went up.
			const brightness = 0.05 + 1.15 * mag;

			// Three rough stellar populations rather than a flat ramp, which tints every
			// star the same lukewarm white: a hot blue-white tail, an amber tail, and a
			// mostly-white middle. Naked-eye skies skew blue -- hot stars are luminous
			// enough to be seen from much further away -- so the hot tail is the wider one.
			const roll = rng();
			let warmth: number;
			if (roll < 0.26) {
				warmth = rng() * 0.3; // Rigel: icy blue-white
			} else if (roll < 0.46) {
				warmth = 0.7 + rng() * 0.3; // Betelgeuse: amber
			} else {
				warmth = 0.38 + rng() * 0.26; // Sirius: near-white
			}

			// Saturation rides magnitude. Below about magnitude 3 the rods are doing all
			// the work and colour vision is simply not available, so the faint population
			// has to render white no matter what class it nominally belongs to. The
			// exponent skews it further: at the median star (mag 0.125) this is 0.14, so
			// the bulk of the sky is 86% of the way to white.
			const sat = 0.06 + 0.94 * Math.pow(mag, 1.2);
			const tintR = HOT[0] + (COOL[0] - HOT[0]) * warmth;
			const tintG = HOT[1] + (COOL[1] - HOT[1]) * warmth;
			const tintB = HOT[2] + (COOL[2] - HOT[2]) * warmth;
			const r = (1 + (tintR - 1) * sat) * brightness;
			const g = (1 + (tintG - 1) * sat) * brightness;
			const b = (1 + (tintB - 1) * sat) * brightness;

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
				mags[p] = mag;
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
		geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
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
		const aMag = attribute<'float'>('aMag', 'float');

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
		// The halo's weight now scales with magnitude instead of sitting at a flat 0.22.
		// A halo is what makes a star read as BRIGHT -- it is the eye's own scatter -- so
		// giving one to every star just fogs the field. Faint stars get 0.05 (a clean
		// point), the brightest 0.35.
		const dist2 = dot(aCorner, aCorner);
		const disc = smoothstep(float(0), float(1), dist2).oneMinus();
		const shape = pow(disc, float(7)).add(pow(disc, float(2)).mul(aMag.mul(0.3).add(0.05)));

		// Fade out below the horizon. Scenes without a ground plane would otherwise show
		// a full sphere of stars underfoot; scenes with one occlude them by depth anyway.
		// Defined before the twinkle because scintillation keys off it too.
		const altitude = positionWorld.y.div(float(radius));
		const horizon = smoothstep(float(-0.06), float(0.1), altitude);

		// AIRMASS, the term this file was missing. 1 at the horizon, 0 above ~17 deg.
		// Everything atmospheric hangs off it: scintillation, reddening, and dimming are
		// all the same fact -- how much air the light crossed -- and they were previously
		// either applied uniformly or applied over a band so wide (27 deg, which is 55% of
		// the hemisphere by solid angle) that they read as a filter rather than as depth.
		//
		// Ascending form with .oneMinus(), never smoothstep(0.3, 0.02, x): both GLSL and
		// WGSL leave smoothstep UNDEFINED when edge0 >= edge1.
		const airmass = smoothstep(float(0.02), float(0.3), altitude).oneMinus();

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
		// THE FAST LOBE IS MIXED IN BY AIRMASS, not applied everywhere. This was the single
		// worst thing in the file: `slow.mul(fast)` ran across the entire sky, so 3000
		// stars strobed at 0.76-2.3 Hz with a mean of 0.25 -- every star dimmed most of
		// the time and flashing occasionally. That is television static, not a sky.
		// Scintillation is refraction through moving air, so it scales with the amount of
		// air crossed: at the zenith a star is nearly steady and only breathes (the slow
		// lobe alone, mean 0.5); low down it thrashes. Watching that difference is the
		// strongest cue the viewer gets that the sky has ATMOSPHERE rather than being a
		// backdrop with a shimmer pass on it.
		const beat = mix(slow, slow.mul(fast), airmass);
		// Skewed three ways: per-star character (some barely move, a few flash hard),
		// airmass, and magnitude. The magnitude term is new -- a faint star flickering
		// hard is indistinguishable from sampling noise, and there are thousands of them.
		const depth = float(twinkle)
			.mul(float(0.15).add(pow(rndC, float(1.6)).mul(0.85)))
			.mul(float(0.3).add(airmass.mul(0.9)))
			.mul(float(0.4).add(aMag.mul(0.6)))
			.min(0.85);
		const flicker = beat.oneMinus().mul(depth).oneMinus();
		// Saturation rides the beat: dim moments go pale, glints go vivid. The old range
		// was 0.75-1.30, and anything past 1 EXTRAPOLATES beyond the authored colour --
		// on an already-saturated palette that turned every glint into a coloured spark.
		const lum = dot(aColor, vec3(0.299, 0.587, 0.114));

		// Atmospheric extinction. Same airmass, doing the other half of its job: light
		// that crosses more air is both reddened and dimmed. The dimming is the part that
		// was missing -- the old term only tinted, mixing toward vec3(1, 0.66, 0.42),
		// which holds red at full strength and therefore SATURATES a low star instead of
		// fading it. Dimming goes through opacity so it cannot fight the saturation above.
		const extinction = mix(vec3(1), vec3(1, 0.84, 0.68), airmass);
		const airmassDim = mix(float(1), float(0.55), airmass);

		material.colorNode = mix(vec3(lum), aColor, beat.mul(0.3).add(0.82)).mul(extinction);
		material.opacityNode = shape.mul(flicker).mul(horizon).mul(airmassDim).mul(visibility);
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
