<script lang="ts">
	// FROST ON THE LENS -- the snow counterpart to RainLens.svelte, and deliberately not a
	// recolour of it. Water beads and runs; ice GROWS. So where RainLens is a field of drops
	// sliding down the glass, this is a front creeping inward from the edges of the frame,
	// thickest in the corners, that never moves once it has arrived -- it only advances and
	// retreats.
	//
	// WHAT IT IS, mechanically, is the same trick as RainLens and it inherits every one of
	// that file's constraints, documented there in full rather than repeated here: one
	// screen-aligned quad drawn last with `depthTest` off, reading the finished frame
	// through `viewportMipTexture`, and decoding that sample back to working space.
	// Read RainLens's header before touching any of that here.
	//
	// TWO LENSES, ONE FRAMEBUFFER. During sleet both layers are live. Whether three hands
	// them one shared framebuffer copy or two is an implementation detail of
	// ViewportTextureNode, and either answer is fine: with one, this layer samples the frame
	// as it stood before RainLens drew, which costs a little compositing accuracy in a case
	// that is already a rare blend of two weathers. Nothing here depends on the answer.
	//
	// THE SHAPE OF FROST, and why it is ridged noise. Frost is dendritic -- it grows in thin
	// branching filaments, not in blobs -- and the cheapest honest way to draw that is to
	// take fractal noise and fold it about zero: `1 - |fbm|` puts a bright thin ridge along
	// every zero crossing of the field. Two scales of it, a fine needle layer over coarse
	// plates, is the whole crystal structure. Plain (unfolded) fbm gives smoke, which is
	// what makes most frost shaders look like a dirty window instead of a cold one.
	//
	// THE FRONT is a threshold on a vignette: distance from the centre of the frame, pushed
	// around by a low-frequency noise so the growth edge is lobed rather than a clean circle,
	// against a level that `uGrowth` walks inward from beyond the corners to past the centre.
	// That single number is what the CPU side drives, and it is slow in BOTH directions --
	// ice takes seconds to form and longer to go, which is exactly what distinguishes it from
	// RainLens's quick beading.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		Fn,
		colorSpaceToWorking,
		float,
		mix,
		mx_fractal_noise_float,
		positionLocal,
		pow,
		screenSize,
		screenUV,
		smoothstep,
		uniform,
		vec2,
		vec3,
		vec4,
		viewportMipTexture
	} from 'three/tsl';
	import { clamp01, descriptor, snowAmount } from '../../model';
	import { instancedQuad, skyLayerMaterial, SKY_LAYER_USERDATA, LENS_LAYER } from '../skyLayer';

	interface Props {
		/**
		 * Zoom of the crystal pattern. Larger = coarser, more widely spaced dendrites. A
		 * fixed value, as RainLens's: this is a fixed piece of glass.
		 */
		scale?: number;
		/** Multiplier on the refraction offset. 0 keeps the frost but stops it bending. */
		refraction?: number;
		/**
		 * Mip level sampled through fully-formed frost. Much higher than RainLens's glass
		 * blur, because ice genuinely is close to opaque -- but it only ever reaches this at
		 * mask 1, which by construction is the corners of the frame.
		 */
		frostBlur?: number;
		/** How far toward the ice colour a fully frosted pixel is milked. */
		milk?: number;
		/** How brightly the crystal filaments themselves catch the light. */
		sparkle?: number;
		/**
		 * How much frost snow puts on the glass with the camera standing still.
		 *
		 * THIS IS THE DOMINANT TERM, not a floor under a motion-driven effect: rain has
		 * to be driven into to land on a windscreen, so RainLens has no standing term at
		 * all, but frost is a TEMPERATURE -- a lens sitting in snow ices over whether or
		 * not it is going anywhere. Motion only deepens it.
		 */
		standingFrost?: number;
		/**
		 * Forward speed, world units per second, at which motion contributes its full extra
		 * measure on top of `standingFrost`. Only `1 - standingFrost` of range is left above
		 * that term, so this is a shallower ramp than RainLens's, not a steeper one.
		 */
		speedForFull?: number;
		/**
		 * How much sideways motion counts, as a fraction of forward motion. Non-zero for
		 * exactly the reason RainLens's is -- DemoScene's camera orbits and its forward speed
		 * is identically zero. Drop it to 0 for a first-person controller.
		 */
		lateralInfluence?: number;
		/**
		 * Seconds for the frost to form, and to melt back. Slower than RainLens's beading in
		 * both directions -- ice takes time to grow and longer to give up -- but not so slow
		 * that stepping into a snowfall leaves the player waiting on it.
		 */
		freezeSeconds?: number;
		meltSeconds?: number;
		/** Ceiling on growth, so even a whiteout leaves the middle of the frame readable. */
		maxFrost?: number;
	}

	let {
		scale = 1,
		refraction = 0.4,
		frostBlur = 3.4,
		milk = 0.45,
		sparkle = 0.55,
		standingFrost = 0.5,
		speedForFull = 6,
		lateralInfluence = 0.35,
		freezeSeconds = 1.8,
		meltSeconds = 6,
		maxFrost = 0.75
	}: Props = $props();

	const { camera, renderer, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	/** How far the front has advanced, 0 (clear) to 1 (past the centre of the frame). */
	const uGrowth = uniform(0);
	/**
	 * The colour frost scatters, from the light hints -- the same reasoning as Snow's flake
	 * tint, and it matters more here because this covers whole regions of the frame rather
	 * than specks. Ice has no colour of its own; a white frost border under a night sky is
	 * the single most obvious way to make a cold scene look like a bug. A `Vector3` rather
	 * than a `Color`, so nothing colour-manages a working-space shader constant.
	 */
	const uIce = uniform(new THREE.Vector3(0.78, 0.87, 0.98));
	/**
	 * A translation into the NOISE DOMAIN, re-rolled each time the frost returns, so no
	 * two freezes grow the same arrangement of lobes and dendrites. Without it every
	 * snowfall in every session ices over identically. Seeded at construction as well,
	 * so the very first freeze is not the one arrangement everybody sees.
	 *
	 * IT MUST NOT REACH THE VIGNETTE, which is why this is applied inside `Frost` rather
	 * than folded into `patternUV` where it would be tidier. The vignette is distance
	 * from the centre OF THE FRAME; offsetting it would slide the growth field
	 * off-centre and the frost would come in from one side of an off-screen ellipse
	 * instead of from the edges. Only the two noise lookups take the offset.
	 */
	const uPatternOffset = uniform(new THREE.Vector2(Math.random() * 512, Math.random() * 512));

	/**
	 * Builds the quad and its material once. Every input is a build-time prop, as in the
	 * other layers.
	 */
	const build = () => {
		const material = skyLayerMaterial({ side: THREE.DoubleSide });
		// Nothing may occlude the lens: it IS the lens. `skyLayerMaterial` already clears
		// depthWrite; this is the other half.
		material.depthTest = false;

		// A fullscreen quad written straight into clip space -- `instancedQuad`'s corners are
		// already +/-1, which is exactly NDC, so no camera is consulted at all.
		material.vertexNode = vec4(positionLocal.xy, 0, 1);

		/**
		 * Ridged fractal noise: fbm folded about zero, so its zero crossings become thin
		 * bright filaments. See the header on why this and not plain fbm.
		 *
		 * A plain function rather than an `Fn`, because it contains no assignment and so
		 * needs no stack to record into (skyLayer.ts). `mx_fractal_noise_float` brings its
		 * own. The position is lifted to vec3 explicitly: only `mx_noise_float` declares the
		 * `vec2|vec3` conversion, the fractal variant does not.
		 */
		const ridged = (p: THREE.Node<'vec2'>, frequency: number, octaves: number) =>
			mx_fractal_noise_float(vec3(p.mul(frequency), 0), octaves, 2, 0.55, 1)
				.abs()
				.oneMinus()
				.clamp(0, 1);

		/**
		 * The frost field at a point, as (crystal, mask).
		 *
		 * `mask` is coverage -- 0 clear glass, 1 fully iced -- and every visible consequence
		 * of this layer is scaled by it, so the un-frosted middle of the frame is untouched
		 * rather than merely lightly affected. `crystal` is the dendrite structure, already
		 * multiplied by the mask so its gradient carries the edge of the growth front too and
		 * the refraction ramps up with the ice instead of snapping on at its boundary.
		 *
		 * Inside `Fn` so it can be evaluated three times (see the finite differences below)
		 * without three copies of the graph.
		 */
		const Frost = Fn(([p]: [any]): any => {
			// The vignette the front advances against: 0 at the centre, 1 at the top and
			// bottom edges, ~1.9 at the corners of a 16:9 frame. Frost reaches the corners
			// first for free, which is what it does on real glass.
			const edge = p.length().mul(2);

			// The noise domain, and ONLY the noise domain -- see `uPatternOffset` on why the
			// vignette above reads the un-offset `p`.
			const q = p.add(uPatternOffset);

			// Lobes. Without this the front is a perfect circle closing in, which reads as a
			// vignette effect rather than as something growing.
			const lobes = mx_fractal_noise_float(vec3(q.mul(4.5), 0), 3, 2, 0.5, 1);

			// At growth 0 the level sits past the far corners (2.7 against a maximum of about
			// 1.9 + 0.55) so the glass is genuinely clear, not faintly hazed; at growth 1 it
			// has swept beyond the centre.
			const front = float(2.7).sub(uGrowth.mul(2.9));
			const mask = smoothstep(float(0), float(0.5), edge.add(lobes.mul(0.55)).sub(front));

			// Fine needles over coarse plates. The powers sharpen the ridges: without them
			// `1 - |fbm|` is a fat band around each zero crossing and the result is closer to
			// marble than to ice.
			const needles = ridged(q, 24, 3);
			const plates = ridged(q, 7.5, 3);
			const crystal = pow(needles, float(3))
				.mul(0.8)
				.add(pow(plates, float(2)).mul(0.4));

			return vec2(crystal.mul(mask), mask);
		});

		// The pattern lives in aspect-corrected space centred on the frame, so the crystals
		// are square on screen and the vignette is a real distance rather than a stretched
		// one. No y flip here: unlike RainLens this is not a port of a Shadertoy shader, so
		// there is no foreign convention to reconcile and noise does not care about the sign.
		const aspect = screenSize.x.div(screenSize.y);
		const patternUV = screenUV.sub(0.5).mul(vec2(aspect, 1)).mul(scale);

		// Normals by finite difference, and unlike RainLens this is a free choice rather
		// than a forced one: the field is smooth fbm with no `floor`/`fract` grids in it, so
		// `dFdx`/`dFdy` would be well-behaved here. Finite differences are used anyway
		// because they are resolution-independent -- a screen-space derivative makes the
		// refraction strength depend on the display's pixel density, and `refraction` would
		// have to be retuned per monitor.
		const e = float(0.0015);
		const c = Frost(patternUV).toVar();
		const cx = Frost(patternUV.add(vec2(e, 0))).x;
		const cy = Frost(patternUV.add(vec2(0, e))).x;
		const n = vec2(cx.sub(c.x), cy.sub(c.x)).mul(refraction);

		// Blur rides coverage, so it is heaviest in the corners and absent in the clear
		// middle. There is no counterpart to RainLens's `dropBlur` -- water drops are lenses
		// and resolve a sharper image than the film around them, but there is nothing you can
		// see clearly THROUGH ice.
		const focus = c.y.mul(float(frostBlur));

		// See RainLens's colour-space note; the cast is the same typings gap it documents.
		const frame = colorSpaceToWorking(
			viewportMipTexture(screenUV.add(n), focus),
			renderer.outputColorSpace
		) as unknown as THREE.Node<'vec4'>;

		// Ice scatters rather than absorbs: milk the frame toward the ice colour by coverage,
		// then lay the lit crystal filaments over the top. The second term is what keeps the
		// frost from reading as a smear -- it is the only part with any structure in it once
		// the blur has taken the frame apart.
		const frosted = mix(frame.rgb, uIce, c.y.mul(float(milk))).add(uIce.mul(c.x.mul(sparkle)));

		material.colorNode = vec4(frosted, 1);
		// Coverage IS the blend. Everything above arrives through this one number, so clear
		// glass costs nothing visually even on the frames either side of `mesh.visible`
		// flipping -- and the ceiling keeps a little of the untouched frame in even at the
		// densest corner.
		material.opacityNode = c.y.mul(0.92);

		return { geometry: instancedQuad(1), material };
	};

	const { geometry, material } = build();

	// Plain variables, written and read only by the task.
	let growth = 0;
	let wasVisible = false;
	let lastPosition: THREE.Vector3 | null = null;
	const stepVector = new THREE.Vector3();
	const forward = new THREE.Vector3();

	/** A single-frame move beyond this is a cut, not motion. */
	const TELEPORT_WORLD = 8;

	useTask(
		(delta) => {
			const cam = camera.current;
			const position = cam.position;

			// How fast, and how much of that is INTO the view -- the same measurement
			// RainLens makes, signed the same way.
			let forwardSpeed = 0;
			let lateralSpeed = 0;

			if (lastPosition === null) {
				lastPosition = position.clone();
			} else {
				stepVector.subVectors(position, lastPosition);
				lastPosition.copy(position);
				if (stepVector.length() <= TELEPORT_WORLD && delta > 0) {
					stepVector.divideScalar(delta);
					cam.getWorldDirection(forward);
					forwardSpeed = Math.max(0, stepVector.dot(forward));
					// Pythagoras against the total, so this is the component perpendicular to
					// the view rather than a second projection.
					const total = stepVector.length();
					lateralSpeed = Math.sqrt(Math.max(0, total * total - forwardSpeed * forwardSpeed));
				}
			}

			// The complement of RainLens's share, off the same explicit `precipitationType`
			// channel: rain runs off glass and snow freezes to it, so during sleet each layer
			// gets its own half rather than both reacting to the total.
			const snow = snowAmount(descriptor.weather);

			// A PRESENCE CURVE, not the raw amount -- the same shape Rain and Snow use.
			// Whether it is snowing is a threshold question, not a proportion: past a light
			// flurry the glass is cold and the rest is a matter of degree, which the terms
			// below express. So this reaches full by a quarter intensity and is only here to
			// take the layer cleanly to zero when the snow stops. (Feeding the raw
			// `snowAmount` in instead starves the effect -- the authored `snow` weather sits
			// at precipitation 0.7, and the product at rest came to 0.18, which put the
			// growth front beyond all but the extreme corners.)
			const presence = Math.min(1, snow * 4);

			const speed = forwardSpeed + lateralSpeed * lateralInfluence;
			const target = clamp01(standingFrost + speed / speedForFull) * presence * maxFrost;

			// Asymmetric one-pole smoothing, as RainLens but slow on BOTH sides (see the
			// header). Both branches use the `exp` form so the time constants hold at any
			// framerate.
			const tau = target > growth ? freezeSeconds : meltSeconds;
			growth += (target - growth) * (1 - Math.exp(-delta / tau));
			uGrowth.value = growth;

			// What the ice is scattering. Floored so a night blizzard still shows frost
			// rather than a black border, and biased cool at every level.
			const { ambient, intensity } = descriptor.light;
			const lit = Math.min(1.05, Math.max(0.12, 0.15 + ambient * 0.5 + intensity * 0.09));
			uIce.value.set(lit * 0.78, lit * 0.87, lit * 0.98);

			// Below this the blend is invisible, and skipping the draw skips a fullscreen
			// pass that evaluates the crystal field three times per pixel.
			const visible = growth > 0.002;

			// A NEW ARRANGEMENT EACH TIME THE FROST RETURNS, on the RISING edge of that
			// threshold specifically. Re-rolling is a discontinuity -- every lobe and every
			// dendrite moves at once -- so it has to land on a frame where none of them are
			// drawn. This is that frame: growth has only just crossed 0.002, which puts the
			// front beyond the corners, so coverage is still zero everywhere and the jump is
			// unobservable.
			if (visible && !wasVisible) {
				uPatternOffset.value.set(Math.random() * 512, Math.random() * 512);
			}
			wasVisible = visible;

			if (mesh) mesh.visible = visible;
			if (visible) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		if (mesh) mesh.layers.set(LENS_LAYER);
	});

	// Same as RainLens: only the active camera may see a screen-space lens
	// (see LENS_LAYER in skyLayer.ts).
	$effect(() => {
		const unsubscribe = camera.subscribe((cam) => cam.layers.enable(LENS_LAYER));
		return unsubscribe;
	});

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});
</script>

<!-- renderOrder 11: above every sky layer AND above RainLens, because this must read a
     framebuffer that already contains all of them. `frustumCulled` off is mandatory -- the
     vertex node writes clip space directly and ignores the model matrix, so the geometry's
     bounding sphere describes nothing three could usefully test. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={11}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
