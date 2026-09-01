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
	import { descriptor, mulberry32 } from '../../model';
	import {
		altitudeOf,
		billboardClip,
		instancedFloat,
		instancedQuad,
		instancedVec3,
		pinFarPlane,
		skyLayerMaterial,
		SKY_LAYER_USERDATA
	} from '../skyLayer';
	import { MILKY_WAY_NORMAL as MW, MILKY_WAY_SIGMA } from './milkyWay';

	interface Props {
		/**
		 * Total stars. Pair-tuned with the nest acceptance below: 6000 keeps the
		 * band's river dense while the surplus populates the off-band knots, and it
		 * rose again with the size cut -- smaller quads cover less sky, and a deep
		 * field needs the count to pay for it.
		 */
		count?: number;
		/** Distance the field is placed at. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/**
		 * Apparent diameter of the faintest and brightest stars, in degrees.
		 *
		 * `minSizeDeg` sits just under the old shimmer floor (0.22 deg, which held the
		 * core above ~1.8 px at 1080p / fov 60), and that is deliberate: the shimmer the
		 * floor guarded against belonged to the OLD brightness floor of 0.28, where a
		 * faint star was a plainly visible dot popping in and out of pixels as the camera
		 * turned. Faint stars are ~7x dimmer now, sub-pixel flicker in a near-invisible
		 * dot is nothing anyone can see, and the post-processing AA catches the rest.
		 * 0.18 deg is a 3.2 px quad -- a point, not a blob. `maxSizeDeg` shrank with it
		 * (0.5 -> 0.34): the brightest stars are tight glints now, and glints instead of
		 * cushions are most of what sells the field as far away.
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
		count = 6000,
		radius = 1000,
		minSizeDeg = 0.18,
		maxSizeDeg = 0.34,
		twinkle = 0.8,
		twinkleSpeed = 2.4,
		seed = 20260828
	}: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<THREE.Mesh>();

	// Two ends of the stellar-colour ramp: hot blue-white to cool amber.
	//
	// These used to be [1, 0.55, 0.28] and [0.58, 0.72, 1] -- a deep ember and a frank
	// blue -- and the field read as confetti, because the tails are half the sky by the
	// warmth roll below AND every star used to carry its tint at full strength. The
	// ends were pulled in on the theory that only the population tails should reach
	// them, but the coupling that actually stopped the confetti was SATURATION RIDING
	// MAGNITUDE (see `sat` below): scotopic vision is nearly colourblind, so only the
	// bright population may show colour. With that gate holding, the ends can sit a
	// little deeper again -- only stars the eye actually lands on ever reach them,
	// and a sky whose brightest stars are all lukewarm white reads as monochrome.
	const COOL: [number, number, number] = [1, 0.7, 0.42];
	const HOT: [number, number, number] = [0.68, 0.79, 1];

	const DEG = Math.PI / 180;

	// ── The star-nest field: a build-time placement oracle ───────────────────────
	//
	// Ported from the Shadertoy "Star Nest" demo (p = abs(p)/dot(p,p) - formuparam,
	// the accumulated orbit drift as brightness) because what that demo sells is
	// CLUMPING: stars in filaments, knots and star clouds with honestly empty
	// stretches between them. That was the ingredient this field lacked -- measure
	// the old sky's off-band neighbour dispersion and it sits at ~1.1, a Poisson
	// process, television static. The band concentrated the static into a river,
	// but the river itself accepted ~100% along its whole length: an evenly bright
	// stripe, which is its own generated-sky tell.
	//
	// The demo buys its look with a volumetric raymarch -- 20 steps x 17 iterations
	// per pixel per frame, roughly 8x the Nebula's fragment cost (already the most
	// expensive shader in the sky, see layers/CLAUDE.md). That is a non-starter on
	// the dome; every point would clamp to 1 px on WebGPU anyway (header note), and
	// none of it would twinkle. So the same march runs ONCE, on the CPU, at build
	// time, over candidate directions: same field, same clumping, zero per-frame
	// cost, and the stars stay the sized, twinkling, airmass-extincted quads they
	// already are. The overlapping additive halos of a knot's members supply the
	// demo's characteristic glow for free.
	const NEST_TILE = 0.85;
	const NEST_FORMUPARAM = 0.53;
	const NEST_VOLSTEPS = 20;
	const NEST_STEPSIZE = 0.1;
	const NEST_ITERATIONS = 17;
	// The demo's camera at time 0.25 with its endless fly-through frozen: one
	// static slice, which is all a fixed sky may ever show.
	const NEST_FROM: [number, number, number] = [1.5, 0.75, 0];
	// The raw march output spans decades (p10 8e3 .. p99 6e4 over the sky, spikes
	// far beyond), so it is soft-saturated (x/(x+K)) into a 0.45..0.85 band and
	// then stretched over the full range. Measured on 8k directions the pair lands
	// at p10 0.08 / p50 0.38 / p90 0.71: voids that are actually sparse, knots that
	// actually pop. The three numbers below are a set; retune together or not at all.
	const NEST_SATURATION = 10_000;
	const NEST_REMAP_LO = 0.35;
	const NEST_REMAP_HI = 0.95;

	/** GLSL mod(): JS % returns negatives for negative operands, which would mirror
	 *  half of the folded field. */
	const glslMod = (x: number, m: number) => x - Math.floor(x / m) * m;

	/** Nest density for one direction: the full march, clamped to 0..1. */
	const nestDensity = (dx: number, dy: number, dz: number): number => {
		let v = 0;
		let fade = 1;
		let s = 0.1;
		for (let r = 0; r < NEST_VOLSTEPS; r++) {
			// The tiling fold, abs(tile - mod(p, 2*tile)), exactly as demoed.
			let px = Math.abs(NEST_TILE - glslMod(NEST_FROM[0] + s * dx * 0.5, NEST_TILE * 2));
			let py = Math.abs(NEST_TILE - glslMod(NEST_FROM[1] + s * dy * 0.5, NEST_TILE * 2));
			let pz = Math.abs(NEST_TILE - glslMod(NEST_FROM[2] + s * dz * 0.5, NEST_TILE * 2));
			let a = 0;
			let pa = 0;
			for (let i = 0; i < NEST_ITERATIONS; i++) {
				const d = px * px + py * py + pz * pz;
				px = Math.abs(px) / d - NEST_FORMUPARAM;
				py = Math.abs(py) / d - NEST_FORMUPARAM;
				pz = Math.abs(pz) / d - NEST_FORMUPARAM;
				const len = Math.sqrt(px * px + py * py + pz * pz);
				a += Math.abs(len - pa);
				pa = len;
			}
			v += a * a * a * fade; // cubed for contrast, faded with depth -- as demoed
			fade *= 0.73;
			s += NEST_STEPSIZE;
		}
		const sat = v / (v + NEST_SATURATION);
		const t = Math.min(1, Math.max(0, (sat - NEST_REMAP_LO) / (NEST_REMAP_HI - NEST_REMAP_LO)));
		return t * t * (3 - 2 * t);
	};

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
			// Direction, rejection-sampled against the Milky Way profile (see
			// milkyWay.ts) AND the star-nest field above. The two modulate each other:
			// the nest carves the band's river into star clouds with gaps between them
			// (Sagittarius vs Aquila -- an evenly bright river is a generated-sky tell),
			// and off-band it supplies the clusters, filaments and empty stretches the
			// real sky keeps beyond the galactic plane. Acceptance runs from 3% in a nest
			// void to 100% inside a knot; after 64 failed tries the star keeps the last
			// candidate, so the voids keep a thin uniform floor -- a literally starless
			// patch reads as a culling bug, not as wilderness.
			//
			// The underlying sample is still uniform-on-sphere (uniform cos(theta)), so
			// band and nest are the only anisotropy -- rejection sampling on top of a
			// biased sample would compound the bias.
			let dx = 0;
			let dy = 0;
			let dz = 0;
			let band = 0;
			let nest = 0;
			for (let tries = 0; tries < 64; tries++) {
				const cosTheta = rng() * 2 - 1;
				const phi = rng() * Math.PI * 2;
				const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
				dx = sinTheta * Math.cos(phi);
				dy = cosTheta;
				dz = sinTheta * Math.sin(phi);
				const offPlane = dx * MW[0] + dy * MW[1] + dz * MW[2];
				band = Math.exp(-(offPlane * offPlane) / (2 * MILKY_WAY_SIGMA * MILKY_WAY_SIGMA));
				nest = nestDensity(dx, dy, dz);
				const river = band * (0.55 + 0.35 * nest); // the band, carved into clouds
				const lone = nest * (1 - band); // off-band filaments, knots, voids
				if (rng() < Math.min(1, 0.03 + 1.75 * river + 0.95 * lone)) break;
			}
			// Stored at the dome's radius. `altitudeOf` divides by `radius` to recover the
			// altitude sine, so this scaling is part of that contract -- see skyLayer.ts.
			centers[i * 3] = dx * radius;
			centers[i * 3 + 1] = dy * radius;
			centers[i * 3 + 2] = dz * radius;

			// Magnitude, cubed so the sky is mostly faint stars with a few bright ones --
			// a flat distribution reads as television static. Band stars are pulled
			// fainter still: the real Milky Way is overwhelmingly an unresolved wash with
			// a handful of field giants on top. Nest stars are pushed the other way --
			// open clusters are where the naked-eye sky keeps its luminous young giants
			// -- and the boost rides the one magnitude attribute, so size, halo,
			// saturation and flicker depth all track it without another buffer.
			const mag = Math.min(1, Math.pow(rng(), 3) * (1 - 0.45 * band) * (0.72 + 0.62 * nest));
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
			// a haze of barely-there ones. 0.04 to 1.44 is 36:1: not physical, but enough
			// that the faint majority sinks into suggestion and the eye gets somewhere to
			// land. The ceiling also pays for the size cut -- a bright star is a tight glint
			// now, and a glint has to be BRIGHT to read as one.
			const brightness = 0.04 + 1.4 * mag;

			// Three rough stellar populations rather than a flat ramp, which tints every
			// star the same lukewarm white: a hot blue-white tail, an amber tail, and a
			// mostly-white middle. Naked-eye skies skew blue -- hot stars are luminous
			// enough to be seen from much further away -- so the hot tail is the wider
			// one, and it widens further inside the nests: young open clusters are
			// blue-giant country.
			const roll = rng();
			let warmth: number;
			if (roll < 0.26 + 0.18 * nest) {
				warmth = rng() * 0.3; // Rigel: icy blue-white
			} else if (roll < 0.52) {
				warmth = 0.7 + rng() * 0.3; // Betelgeuse: amber
			} else {
				warmth = 0.34 + rng() * 0.34; // Sirius: near-white, leaning either way
			}

			// Saturation rides magnitude. Below about magnitude 3 the rods are doing all
			// the work and colour vision is simply not available, so the faint population
			// has to render white no matter what class it nominally belongs to. But the
			// first cut of this over-applied the principle: mag^1.2 left the MEDIAN star at
			// 88% white and the whole field read monochrome. Rods saturate too -- the
			// brighter half of a real sky shows obvious golds and blues (Betelgeuse is not
			// a white star). mag^0.45 with a 0.16 floor keeps the faint haze white and lets
			// everything the eye lands on carry its tint: median ~46%, mag 0.5 at ~78%.
			const sat = 0.16 + 0.84 * Math.pow(mag, 0.45);
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
		// The halo's weight scales with magnitude instead of sitting at a flat 0.22: a
		// halo is what makes a star read as BRIGHT -- it is the eye's own scatter -- so
		// giving one to every star just fogs the field. Faint stars get 0.04 (a clean
		// point), the brightest 0.26.
		// The halo was rebuilt when the field went small (see minSizeDeg): disc^2 at up
		// to 0.35 weight put a soft six-pixel cushion under every bright star, and a
		// field of cushions reads as a dome NEARBY -- planetarium, not sky. disc^3 at a
		// lower weight keeps the glint tight; what the nests lose in individual halo
		// they keep in overlap, which is the part that makes a knot glow.
		const dist2 = dot(corner, corner);
		const disc = smoothstep(float(0), float(1), dist2).oneMinus();
		const shape = pow(disc, float(7)).add(pow(disc, float(3)).mul(aMag.mul(0.22).add(0.04)));

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
		// airmass, and magnitude. The magnitude term matters -- a faint star flickering
		// hard is indistinguishable from sampling noise, and there are thousands of them.
		//
		// THE FLOORS ROSE when the field was first judged DEAD rather than calm: with
		// the old 0.55 / 0.15-1.0 / 0.3-1.2 / 0.4-1.0 stack, the median mid-sky star
		// landed at a ~6% brightness wobble -- physically defensible, visually nothing.
		// Now the median mid-sky star swings ~20%, a bright star near the horizon
		// flashes past 50%, and only the zenith keeps its slow breath. Alive, layered.
		const depth = float(twinkle)
			.mul(float(0.3).add(pow(rndC, float(1.6)).mul(0.7)))
			.mul(float(0.55).add(airmass.mul(0.65)))
			.mul(float(0.45).add(aMag.mul(0.55)))
			.min(0.9);
		const flicker = beat.oneMinus().mul(depth).oneMinus();
		// Saturation rides the beat: dim moments go pale, glints go vivid. The range is
		// 0.85-1.30, and anything past 1 EXTRAPOLATES beyond the authored colour. That
		// is deliberate now: the ramps were pulled in precisely so glints could be
		// pushed past them -- a glint that flashes COLOUR is half of what makes a bright
		// star read as alive (the prismatic term below is the other half).
		const lum = dot(aColor, vec3(0.299, 0.587, 0.114));

		// Atmospheric extinction. Same airmass, doing the other half of its job: light
		// that crosses more air is both reddened and dimmed. The dimming is the part that
		// was missing -- the old term only tinted, mixing toward vec3(1, 0.66, 0.42),
		// which holds red at full strength and therefore SATURATES a low star instead of
		// fading it. Dimming goes through opacity so it cannot fight the saturation above.
		const extinction = mix(vec3(1), vec3(1, 0.84, 0.68), airmass);
		const airmassDim = mix(float(1), float(0.55), airmass);

		// PRISMATIC SCINTILLATION, the colour half of the horizon flutter: the same
		// turbulence that flashes a low star also splits its colours -- horizon stars
		// visibly flash warm and cool as the air disperses the beam. Keyed off the FAST
		// lobe (so it flutters, it does not tint) and killed above ~17 deg by the same
		// airmass gate, because dispersion needs the long path exactly as scintillation
		// does. +-9% R / +-11% B at the horizon, 0 at the zenith.
		const prismatic = fast.sub(0.5).mul(airmass).mul(0.5);
		const chroma = vec3(1).add(prismatic.mul(vec3(0.35, 0.02, -0.42)));

		material.colorNode = mix(vec3(lum), aColor, beat.mul(0.45).add(0.85))
			.mul(extinction)
			.mul(chroma);
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
