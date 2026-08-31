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
	//
	// The quad is INSTANCED (skyLayer.ts): one four-vertex quad drawn `count` times,
	// with each star's centre, colour, size, seed and magnitude as per-instance
	// attributes. It used to write all six of those into four vertices apiece.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		dot,
		float,
		fract,
		mix,
		positionLocal,
		pow,
		sin,
		smoothstep,
		time,
		uniform,
		vec3
	} from 'three/tsl';
	import { descriptor, mulberry32 } from './model';
	import {
		altitudeOf,
		billboardClip,
		instancedFloat,
		instancedQuad,
		instancedVec3,
		pinFarPlane,
		skyLayerMaterial,
		SKY_LAYER_USERDATA
	} from './skyLayer';
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

	let mesh = $state.raw<THREE.Mesh>();

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

	const visibility = uniform(0);

	/**
	 * Builds the field and its material together, once.
	 *
	 * ONE CLOSURE because every input here is a BUILD-TIME prop. Reading `count`, `seed`
	 * or `radius` at the top level would capture only their initial value anyway, which
	 * is what Svelte's `state_referenced_locally` warning is for -- and it is what we
	 * want: change one and re-mount, exactly as Sky.svelte treats its SkyMesh. A
	 * `$derived` would be worse than useless, since it would hand the teardown effect
	 * the NEW geometry to dispose while the old one leaked.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Per-instance data, one entry per star rather than one per quad vertex.
		const centers = new Float32Array(count * 3);
		const colors = new Float32Array(count * 3);
		const sizes = new Float32Array(count);
		const seeds = new Float32Array(count);
		// Normalised magnitude, kept as its own attribute rather than recovered from
		// aColor's luminance: three separate shader terms (halo width, twinkle depth,
		// saturation) key off "how bright is this star", and luminance is contaminated by
		// the star's colour, so a red giant would read as fainter than it is.
		const mags = new Float32Array(count);

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
			// Stored at the dome's radius. `altitudeOf` divides by `radius` to recover the
			// altitude sine, so this scaling is part of that contract -- see skyLayer.ts.
			centers[i * 3] = dx * radius;
			centers[i * 3 + 1] = dy * radius;
			centers[i * 3 + 2] = dz * radius;

			// Magnitude, cubed so the sky is mostly faint stars with a few bright ones --
			// a flat distribution reads as television static. Band stars are pulled
			// fainter still: the real Milky Way is overwhelmingly an unresolved wash with
			// a handful of field giants on top.
			const mag = Math.pow(rng(), 3) * (1 - 0.45 * band);
			const halfAngle = (minSizeDeg + (maxSizeDeg - minSizeDeg) * mag) * 0.5 * DEG;
			// View-space half-extent that subtends `halfAngle` at `radius`. Because every
			// star sits at the same radius, a fixed view-space offset is a fixed angular
			// size, so no per-vertex distance maths is needed in the shader.
			sizes[i] = radius * Math.tan(halfAngle);

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
			colors[i * 3] = (1 + (tintR - 1) * sat) * brightness;
			colors[i * 3 + 1] = (1 + (tintG - 1) * sat) * brightness;
			colors[i * 3 + 2] = (1 + (tintB - 1) * sat) * brightness;

			seeds[i] = rng();
			mags[i] = mag;
		}

		// Stars are their own light source; tone mapping them at night's 0.62 exposure
		// would dim the one thing that is supposed to be bright in a dark frame.
		const material = skyLayerMaterial({ blending: THREE.AdditiveBlending });

		const aCenter = instancedVec3(centers);
		const aColor = instancedVec3(colors);
		const aSize = instancedFloat(sizes);
		const aSeed = instancedFloat(seeds);
		const aMag = instancedFloat(mags);

		// The quad corner. With the star's centre in an instanced attribute, the base
		// geometry's `position` IS the corner -- so `positionLocal.xy` reads exactly where
		// the old per-vertex `aCorner` attribute did.
		const corner = positionLocal.xy;

		// Billboarded in view space and pinned to the far plane. Both are load-bearing;
		// see skyLayer.ts for why neither may be skipped or written with assignments.
		material.vertexNode = pinFarPlane(billboardClip(aCenter, corner.mul(aSize)));

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
		const dist2 = dot(corner, corner);
		const disc = smoothstep(float(0), float(1), dist2).oneMinus();
		const shape = pow(disc, float(7)).add(pow(disc, float(2)).mul(aMag.mul(0.3).add(0.05)));

		// Fade out below the horizon. Scenes without a ground plane would otherwise show
		// a full sphere of stars underfoot; scenes with one occlude them by depth anyway.
		// Defined before the twinkle because scintillation keys off it too.
		//
		// Read from the instanced CENTRE, never from `positionWorld` -- that is now the
		// +/-1 quad corner. See `altitudeOf` for the bug the old form caused in Meteors.
		const altitude = altitudeOf(aCenter, radius);
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

		return { geometry: instancedQuad(count), material };
	};

	const { geometry, material } = build();

	useTask(
		() => {
			// starVisibility is a day-curve output: 1 at solar midnight, 0 by mid-morning.
			const visible = descriptor.sky.starVisibility;
			visibility.value = visible;

			// Skip the draw outright by day rather than submitting 3200 instances that
			// resolve to zero opacity.
			if (mesh) mesh.visible = visible > 0.002;

			// Invalidate only while the field is actually on screen. The twinkle runs off
			// the TSL `time` node, so it genuinely animates every frame and cannot be
			// gated on the descriptor -- but by day there is nothing to animate, and
			// Threlte's renderMode defaults to 'on-demand'. See Skybox.svelte.
			if (visible > 0.002) invalidate();
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
	renderOrder={1}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
