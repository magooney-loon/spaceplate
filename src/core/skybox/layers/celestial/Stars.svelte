<script lang="ts">
	// The star field. A descriptor consumer, driven by `descriptor.sky.starVisibility`.
	// Camera-facing INSTANCED quads, billboarded in TSL -- never THREE.Points, which
	// clamps to 1px and silently ignores sizeNode on WebGPU (DOCS/webgpu-notes.md §1.1,
	// ../CLAUDE.md). One four-vertex quad drawn `count` times, with each star's centre,
	// colour, size, seed and magnitude as per-instance attributes.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		dot,
		float,
		fract,
		mix,
		positionLocal,
		sin,
		smoothstep,
		time,
		uniform,
		varying,
		vec2,
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
		 * Total stars, ALL OF THEM VISIBLE -- see `HORIZON_MIN` / ../CLAUDE.md for why the
		 * field is sampled on the visible cap rather than the whole sphere. Pair-tuned with
		 * the nest acceptance below: keeps the band's river dense while the surplus
		 * populates the off-band knots. Retune against what you SEE, which is what the
		 * number means.
		 */
		count?: number;
		/** Distance the field is placed at. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/**
		 * Apparent diameter of the faintest and brightest stars, in degrees. `minSizeDeg`
		 * (0.18, ~3.2px quad) reads as a point, not a blob; `maxSizeDeg` (0.34) keeps the
		 * brightest stars as tight glints rather than cushions, which is most of what
		 * sells the field as far away.
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
		count = 2900,
		radius = 1000,
		minSizeDeg = 0.18,
		maxSizeDeg = 0.34,
		twinkle = 0.8,
		twinkleSpeed = 2.4,
		seed = 20260828
	}: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<THREE.Mesh>();

	// Two ends of the stellar-colour ramp: hot blue-white to cool amber. Deeper tails than
	// you'd expect work only because saturation rides magnitude (see `sat` below) --
	// scotopic vision is nearly colourblind, so only the bright population shows colour;
	// without that gate these ends read as confetti.
	const COOL: [number, number, number] = [1, 0.7, 0.42];
	const HOT: [number, number, number] = [0.68, 0.79, 1];

	const DEG = Math.PI / 180;

	/**
	 * Altitude sine at which the horizon fade reaches ZERO, and therefore the floor of the
	 * spherical cap the field is sampled on rather than the whole sphere (see ../CLAUDE.md
	 * -- the field does not rotate, so anything below this line is invisible for the whole
	 * session, not just currently). Uniform in cos(theta) over this restricted range is
	 * still uniform by area, so the "band and nest are the only anisotropy" contract below
	 * holds exactly as it did over the sphere. The shader's `horizon` smoothstep reads the
	 * same constant, so the two cannot drift. Give this layer a diurnal rotation one day
	 * and the cap has to go with it.
	 */
	const HORIZON_MIN = -0.06;

	// The star-nest field: a build-time placement oracle, ported from the Shadertoy "Star
	// Nest" demo (see ../CLAUDE.md) for its CLUMPING -- filaments, knots and star clouds
	// with genuinely empty stretches between them, which a flat rejection-sampled band
	// lacks. The demo's raymarch is ~8x the Nebula's fragment cost, so it runs ONCE on the
	// CPU at build time over candidate directions instead: same clumping, zero per-frame
	// cost. The overlapping additive halos of a knot's members supply the demo's
	// characteristic glow for free.
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
	 * Builds the field and its material together, once. ONE CLOSURE because every input
	 * here is a BUILD-TIME prop: change one and re-mount, exactly as Sky.svelte treats its
	 * SkyMesh. A `$derived` would be worse than useless -- it would hand the teardown
	 * effect the NEW geometry to dispose while the old one leaked.
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
			// Direction, rejection-sampled against the Milky Way profile AND the star-nest
			// field above (../CLAUDE.md). Acceptance runs 3% in a nest void to 100% in a
			// knot; after 64 failed tries the star keeps the last candidate, so voids keep
			// a thin uniform floor rather than reading as a culling bug. Still uniform-by-
			// area over the VISIBLE CAP (see HORIZON_MIN), so band and nest are the only
			// anisotropy.
			let dx = 0;
			let dy = 0;
			let dz = 0;
			let band = 0;
			let nest = 0;
			for (let tries = 0; tries < 64; tries++) {
				const cosTheta = HORIZON_MIN + rng() * (1 - HORIZON_MIN);
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

			// Brightness folded into the colour (additive material, so a dim star is just a
			// dim colour). Range is 0.04-1.44, 36:1 -- not physical, but enough that the
			// faint majority sinks into suggestion instead of reading as television static.
			const brightness = 0.04 + 1.4 * mag;

			// Three rough stellar populations rather than a flat ramp: hot blue-white tail,
			// amber tail, mostly-white middle. Hot tail is wider (naked-eye skies skew
			// blue) and widens further inside nests (young open clusters are blue-giant
			// country).
			const roll = rng();
			let warmth: number;
			if (roll < 0.26 + 0.18 * nest) {
				warmth = rng() * 0.3; // Rigel: icy blue-white
			} else if (roll < 0.52) {
				warmth = 0.7 + rng() * 0.3; // Betelgeuse: amber
			} else {
				warmth = 0.34 + rng() * 0.34; // Sirius: near-white, leaning either way
			}

			// Saturation rides magnitude: scotopic (rod) vision is nearly colourblind, so
			// the faint population renders white regardless of nominal class. mag^0.45 with
			// a 0.16 floor keeps the faint haze white while letting everything the eye
			// lands on carry its tint (median ~46%, mag 0.5 at ~78%).
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
		// geometry's `position` IS the corner.
		const corner = positionLocal.xy;

		// Billboarded in view space and pinned to the far plane (skyLayer.ts).
		material.vertexNode = pinFarPlane(billboardClip(aCenter, corner.mul(aSize)));

		// Round falloff from the quad's centre, two lobes (tight core + wide weak glow) so
		// a star reads as a point with a halo. Squared distance saves the sqrt. `oneMinus()`
		// rather than descending smoothstep(1, 0, d) -- both GLSL and WGSL leave smoothstep
		// UNDEFINED when edge0 >= edge1. Halo weight scales with magnitude (0.04 faint /
		// 0.26 brightest, disc^3 not disc^2) so it reads as the eye's own scatter around a
		// bright point rather than fogging the whole field with soft cushions. Written as
		// MULTIPLIES, not `pow()` -- the one genuinely per-fragment term, and `pow(x,n)` is
		// two transcendentals against four multiplies for disc^3 and disc^7 together
		// (../CLAUDE.md).
		const dist2 = dot(corner, corner);
		const disc = smoothstep(float(0), float(1), dist2).oneMinus();
		const disc3 = disc.mul(disc).mul(disc);
		const disc7 = disc3.mul(disc3).mul(disc);

		// Fade out below the horizon (ramps between HORIZON_MIN and 0.1; nothing below
		// HORIZON_MIN because the field is sampled on that cap -- see the constant).
		// Defined before twinkle because scintillation keys off it too. Read from the
		// instanced CENTRE, never `positionWorld` (that's the +/-1 quad corner -- see
		// `altitudeOf` in skyLayer.ts).
		const altitude = altitudeOf(aCenter, radius);
		const horizon = smoothstep(float(HORIZON_MIN), float(0.1), altitude);

		// Airmass: 1 at the horizon, 0 above ~17deg. Scintillation, reddening and dimming
		// all hang off it (how much air the light crossed). Ascending form with
		// `.oneMinus()`, never a descending smoothstep -- undefined when edge0 >= edge1.
		const airmass = smoothstep(float(0.02), float(0.3), altitude).oneMinus();

		// Twinkle: irregular, with per-star rhythm and depth (a single sine reads as a
		// disco ball). Extra randoms derived from the seed attribute rather than shipping
		// more vertex data.
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
		// The fast lobe is mixed in BY AIRMASS, not applied everywhere: scintillation is
		// refraction through moving air, so a zenith star only breathes (slow lobe alone)
		// while a low one thrashes -- that difference is the strongest cue the sky has
		// atmosphere rather than a flat shimmer pass.
		const beat = mix(slow, slow.mul(fast), airmass);
		// Skewed three ways: per-star character, airmass, and magnitude (a faint star
		// flickering hard is indistinguishable from sampling noise).
		const depth = float(twinkle)
			.mul(float(0.3).add(rndC.pow(1.6).mul(0.7)))
			.mul(float(0.55).add(airmass.mul(0.65)))
			.mul(float(0.45).add(aMag.mul(0.55)))
			.min(0.9);
		const flicker = beat.oneMinus().mul(depth).oneMinus();
		// Saturation rides the beat: dim moments go pale, glints go vivid. Range is
		// 0.85-1.30 -- past 1 deliberately EXTRAPOLATES beyond the authored colour, since a
		// glint that flashes colour is half of what makes a bright star read as alive (the
		// prismatic term below is the other half).
		const lum = dot(aColor, vec3(0.299, 0.587, 0.114));

		// Atmospheric extinction: light crossing more air is both reddened and dimmed.
		// Dimming goes through opacity so it cannot fight the saturation above.
		const extinction = mix(vec3(1), vec3(1, 0.84, 0.68), airmass);
		const airmassDim = mix(float(1), float(0.55), airmass);

		// Prismatic scintillation, the colour half of the horizon flutter: keyed off the
		// FAST lobe (so it flutters, not tints) and killed above ~17deg by the same
		// airmass gate. +-9% R / +-11% B at the horizon, 0 at the zenith.
		const prismatic = fast.sub(0.5).mul(airmass).mul(0.5);
		const chroma = vec3(1).add(prismatic.mul(vec3(0.35, 0.02, -0.42)));

		// Everything above is CONSTANT across a star's quad (functions of the star's
		// attributes and `time`, not corner position), so it is lifted into two
		// `varying()`s rather than re-evaluated per fragment -- same fix as Snow's
		// `flakeAlpha`, smaller win here since a star is only ~25 shaded fragments
		// (see ../CLAUDE.md).
		const vStarColor = varying(
			mix(vec3(lum), aColor, beat.mul(0.45).add(0.85)).mul(extinction).mul(chroma),
			'vStarColor'
		);
		/** (alpha everything-but-shape, halo weight) -- the two scalars the shape needs. */
		const vStarShape = varying(
			vec2(flicker.mul(horizon).mul(airmassDim).mul(visibility), aMag.mul(0.22).add(0.04)),
			'vStarShape'
		);

		material.colorNode = vStarColor;
		material.opacityNode = disc7.add(disc3.mul(vStarShape.y)).mul(vStarShape.x);

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
