<script lang="ts">
	// WATER ON THE LENS -- the screen-space droplet layer, ported from Martijn Steinrucken's
	// "Heartfelt" (shadertoy.com/view/ltffzl) with its demo scaffolding stripped: no heart,
	// no story timeline, no faked lightning or vignette. This app has a real Lightning layer
	// and a real sky; the port keeps only the water.
	//
	// WHAT IT IS. One screen-aligned quad, drawn after everything else, that reads the frame
	// already rendered and puts it back distorted -- drops act as tiny lenses, the wet glass
	// between them is defocused, and the trails they leave behind are clear streaks. It is a
	// post-processing effect in every respect EXCEPT that it needs no post-processing
	// pipeline, which this app does not have (`core/utils/Renderer.svelte` is a stub and
	// `autoRender` is left on -- see src/CLAUDE.md). `viewportMipTexture` is what makes that
	// work: three documents it as the input for refractive materials, it extracts the
	// framebuffer with a COPY rather than a second render pass, and its mip chain supplies
	// the defocus blur for free.
	//
	// DRAW ORDER IS THE WHOLE TRICK. The copy happens in that node's `updateBefore`, which
	// NodeFrame fires once per render at the moment the first object using it is drawn
	// (`NodeFrame.updateBeforeNode`, RENDER update type). This quad is that object, and it
	// draws last -- `renderOrder` above every sky layer, `depthTest` off -- so what it reads
	// is the finished frame: world, sky, rain and all.
	//
	// ONLY WHEN MOVING. The lens is clear standing still and beads up as the camera drives
	// into the rain. `wetness` is an accumulator with asymmetric time constants, quick to
	// wet and slow to dry, because a mask that tracked speed directly would pop on and off
	// every time the player stopped.
	//
	// COLOUR SPACE, AND IT IS NOT OPTIONAL. The framebuffer holds OUTPUT-space values: three
	// has already applied tone mapping and the transfer function by the time anything lands
	// there. A `FramebufferTexture` defaults to `NoColorSpace`, so sampling it decodes
	// nothing, while this material's own output still runs the working -> output transform on
	// the way out. Left alone that encodes sRGB TWICE and the whole screen washes out.
	// Decoding the sample back to working space first makes the round trip an identity.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		Fn,
		colorSpaceToWorking,
		dot,
		float,
		floor,
		fract,
		mix,
		positionLocal,
		screenSize,
		screenUV,
		sin,
		sqrt,
		uniform,
		vec2,
		vec3,
		vec4,
		viewportMipTexture
	} from 'three/tsl';
	import { clamp01, descriptor, rainAmount } from '../../model';
	import { instancedQuad, skyLayerMaterial, SKY_LAYER_USERDATA, LENS_LAYER } from '../skyLayer';

	interface Props {
		/**
		 * Zoom of the droplet pattern. The original animates this between 0.4 and 1.0 for
		 * its demo; a fixed value reads as a fixed piece of glass, which is what this is.
		 * Larger = drops spread further apart and appear bigger.
		 */
		scale?: number;
		/** Multiplier on the refraction offset. 0 keeps the drops but stops them bending. */
		refraction?: number;
		/**
		 * Mip level sampled for the wet glass BETWEEN drops, at full wetness. The original
		 * runs 3-6 here for a deliberately misted windscreen; this is tuned much lower,
		 * because a game frame that goes soft whenever the player moves is unreadable.
		 */
		glassBlur?: number;
		/**
		 * Mip level sampled THROUGH a drop. Lower than `glassBlur` on purpose: a drop is a
		 * lens and resolves a sharper (if distorted) image than the film around it.
		 */
		dropBlur?: number;
		/** Forward speed, world units per second, at which the lens reaches full wetness. */
		speedForFull?: number;
		/**
		 * How much sideways motion counts toward wetting, as a fraction of forward motion.
		 *
		 * Physically this should be near zero -- rain lands on a windscreen because you
		 * drive INTO it. It is not zero because DemoScene's camera orbits the origin with
		 * `lookAt(0,0,0)`, so its velocity is always perpendicular to its view direction and
		 * its forward speed is identically zero: at 0 the effect could never be seen there
		 * at all. Drop it to 0 for a first-person controller.
		 */
		lateralInfluence?: number;
		/** Seconds for the lens to bead up, and to dry off. Asymmetric on purpose. */
		wetSeconds?: number;
		drySeconds?: number;
		/** Ceiling on wetness, so a downpour never turns the screen to soup. */
		maxWetness?: number;
	}

	let {
		scale = 0.85,
		refraction = 1,
		glassBlur = 2.4,
		dropBlur = 0.3,
		speedForFull = 7,
		lateralInfluence = 0.35,
		wetSeconds = 0.7,
		drySeconds = 2.6,
		maxWetness = 0.85
	}: Props = $props();

	const { camera, renderer, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	/** Overall strength: drives both the droplet density and the blend against the frame. */
	const uWetness = uniform(0);
	/**
	 * The droplet animation clock, ACCUMULATED on the CPU rather than `time * rate`.
	 *
	 * The rate depends on how fast the camera is moving, and a rate multiplied into absolute
	 * elapsed time teleports the whole pattern by `elapsed x rate-change` the instant it
	 * changes -- the §15.7 trap that CloudDeck and Snow's `uWindDrift` already work around,
	 * and it would be far more visible here than in either of those.
	 */
	const uDropTime = uniform(0);

	/**
	 * Builds the quad and its material once. Every input is a build-time prop, as in the
	 * other layers.
	 */
	const build = () => {
		const material = skyLayerMaterial({ side: THREE.DoubleSide });
		// Nothing may occlude the lens: it IS the lens. `skyLayerMaterial` already clears
		// depthWrite; this is the other half.
		material.depthTest = false;

		// A fullscreen quad written straight into clip space. The camera is deliberately not
		// consulted -- `instancedQuad`'s corners are already +/-1, which is exactly NDC, so
		// there is no view or projection matrix in this layer at all.
		material.vertexNode = vec4(positionLocal.xy, 0, 1);

		// ── The ported shader ────────────────────────────────────────────────────────
		//
		// Everything below is inside `Fn()`, which matters: TSL's assignment operators need
		// a stack to record into and fail SILENTLY outside one (see skyLayer.ts). The port
		// leans on `.toVar()` / `.addAssign()` heavily, because the original is written in
		// GLSL's mutable style and rewriting it into pure expressions would make it
		// impossible to diff against the source.

		/**
		 * The shader's `S(a, b, t)`, written out rather than deferred to TSL's `smoothstep`.
		 *
		 * The port needs the DESCENDING form -- `Saw` calls it as `S(1., b, t)` with a > b,
		 * and so does the main drop -- and WGSL leaves `smoothstep` UNDEFINED when
		 * edge0 >= edge1. Drivers happen to evaluate the same polynomial either way today,
		 * but that is undefined behaviour to lean on. The explicit clamp is two instructions
		 * and is defined for both orders.
		 */
		const S = Fn(([a, b, t]: [any, any, any]): any => {
			const x = t.sub(a).div(b.sub(a)).clamp(0, 1).toVar();
			return x.mul(x).mul(float(3).sub(x.mul(2)));
		});

		/** Dave Hoskins' vec3 hash, as the original. */
		const N13 = Fn(([p]: [any]): any => {
			const p3 = fract(vec3(p).mul(vec3(0.1031, 0.11369, 0.13787))).toVar();
			p3.addAssign(dot(p3, p3.yzx.add(19.19)));
			return fract(
				vec3(p3.x.add(p3.y).mul(p3.z), p3.x.add(p3.z).mul(p3.y), p3.y.add(p3.z).mul(p3.x))
			);
		});

		const N = Fn(([t]: [any]): any => fract(sin(t.mul(12345.564)).mul(7658.76)));

		/** Rises to 1 at `b`, falls back to 0 at 1 -- one drop's life over its cycle. */
		const Saw = Fn(([b, t]: [any, any]): any => S(float(0), b, t).mul(S(float(1), b, t)));

		/** The small drops that cling in place and slowly fade. */
		const StaticDrops = Fn(([uvIn, t]: [any, any]): any => {
			const uv = vec2(uvIn).mul(40).toVar();
			const id = vec2(floor(uv));
			uv.assign(fract(uv).sub(0.5));
			const n = vec3(N13(id.x.mul(107.45).add(id.y.mul(3543.654))));
			const p = n.xy.sub(0.5).mul(0.7);
			const d = uv.sub(p).length();
			const fade = Saw(float(0.025), fract(t.add(n.z)));
			return S(float(0.3), float(0), d)
				.mul(fract(n.z.mul(10)))
				.mul(fade);
		});

		/**
		 * A layer of drops that run down the glass, each leaving a tapering trail with
		 * smaller droplets strung along it. Returns (mask, trail).
		 */
		const DropLayer2 = Fn(([uvIn, t]: [any, any]): any => {
			// The UNSCROLLED coordinate. The original keeps this as `UV` before mutating
			// `uv`, and uses it for the horizontal wiggle and the trailing droplets, so both
			// stay pinned to the glass while the drops themselves slide down it.
			const uvBase = vec2(uvIn).toVar();
			const uv = vec2(uvIn).toVar();
			uv.y.addAssign(t.mul(0.75));

			const a = vec2(6, 1);
			const grid = a.mul(2);
			const id = vec2(floor(uv.mul(grid))).toVar();

			// Offset each column by its own random amount, so the drops in neighbouring
			// columns are not in lockstep.
			uv.y.addAssign(N(id.x));
			id.assign(vec2(floor(uv.mul(grid))));

			const n = vec3(N13(id.x.mul(35.2).add(id.y.mul(2376.1)))).toVar();
			const st = fract(uv.mul(grid)).sub(vec2(0.5, 0)).toVar();

			const x = n.x.sub(0.5).toVar();
			const wiggleY = uvBase.y.mul(20);
			const wiggle = sin(wiggleY.add(sin(wiggleY)));
			x.addAssign(wiggle.mul(float(0.5).sub(x.abs())).mul(n.z.sub(0.5)));
			x.mulAssign(0.7);

			// Where the drop sits in its fall this cycle.
			const ti = fract(t.add(n.z));
			const y = Saw(float(0.85), ti).sub(0.5).mul(0.9).add(0.5).toVar();

			const d = st.sub(vec2(x, y)).mul(a.yx).length();
			const mainDrop = S(float(0.4), float(0), d);

			// The trail: narrows and fades the further it is behind the drop.
			const r = sqrt(S(float(1), y, st.y));
			const cd = st.x.sub(x).abs();
			const trailFront = S(float(-0.02), float(0.02), st.y.sub(y));
			const trail = S(r.mul(0.23), r.mul(r).mul(0.15), cd).mul(trailFront).mul(r).mul(r);

			// Droplets strung along the trail, on a grid pinned to the glass.
			// (The original computes a first `droplets` from a `trail2` term and then
			// overwrites both on the next line without using them; that dead pair is not
			// reproduced here.)
			const dropletY = fract(uvBase.y.mul(10)).add(st.y.sub(0.5));
			const dd = st.sub(vec2(x, dropletY)).length();
			const droplets = S(float(0.3), float(0), dd);

			return vec2(mainDrop.add(droplets.mul(r).mul(trailFront)), trail);
		});

		/** Static drops plus two running layers at different scales. Returns (mask, trail). */
		const Drops = Fn(([uvIn, t, l0, l1, l2]: [any, any, any, any, any]): any => {
			const s = StaticDrops(uvIn, t).mul(l0);
			const m1 = DropLayer2(uvIn, t).mul(l1).toVar();
			const m2 = DropLayer2(uvIn.mul(1.85), t).mul(l2).toVar();

			const c = S(float(0.3), float(1), s.add(m1.x).add(m2.x));
			// `m1.y * l0` and `m2.y * l1` are the original's weights, and they do look like
			// an off-by-one against l1/l2 -- kept as written, since this only feeds the
			// blur term and changing it would silently retune the look away from the source.
			return vec2(c, m1.y.mul(l0).max(m2.y.mul(l1)));
		});

		// ── Composition ──────────────────────────────────────────────────────────────

		// `screenUV` follows the WebGPU convention, y = 0 at the TOP of the screen
		// (ScreenNode flips WebGL to match). The shader is Shadertoy's, where y = 0 is the
		// BOTTOM and drops fall by scrolling +y. Rebuilding that convention once here keeps
		// every ported line below readable against the original instead of scattering sign
		// flips through the maths.
		const shaderUV = vec2(screenUV.x, screenUV.y.oneMinus());

		// The pattern lives in aspect-corrected space centred on the screen, exactly the
		// original's `uv = (fragCoord - .5*iResolution.xy) / iResolution.y`.
		const aspect = screenSize.x.div(screenSize.y);
		const patternUV = shaderUV.sub(0.5).mul(vec2(aspect, 1)).mul(scale);

		const wet = uWetness;
		const t = uDropTime;

		// Layer weights, as the original derives them from `rainAmount`.
		const staticDrops = S(float(-0.5), float(1), wet).mul(2);
		const layer1 = S(float(0.25), float(0.75), wet);
		const layer2 = S(float(0), float(0.5), wet);

		const c = Drops(patternUV, t, staticDrops, layer1, layer2).toVar();

		// Normals by finite difference -- the original's "expensive" path. The cheap
		// `dFdx`/`dFdy` variant is genuinely cheaper, but this pattern is built on `floor`
		// and `fract` grids and screen-space derivatives blow up across every cell boundary,
		// stamping the grid into the refraction. Three evaluations is the honest price.
		const e = float(0.001);
		const cx = Drops(patternUV.add(vec2(e, 0)), t, staticDrops, layer1, layer2).x;
		const cy = Drops(patternUV.add(vec2(0, e)), t, staticDrops, layer1, layer2).x;
		const n = vec2(cx.sub(c.x), cy.sub(c.x)).mul(refraction);

		// Blur: heaviest on the bare wet film, clearing along trails (`c.y`) and clearer
		// still seen through a drop (`c.x`).
		const focus = mix(float(glassBlur).sub(c.y), float(dropBlur), S(float(0.1), float(0.2), c.x));

		// Back to the renderer's own convention for the sample, undoing the flip above.
		const refractedUV = shaderUV.add(n);
		const sampleUV = vec2(refractedUV.x, refractedUV.y.oneMinus());

		// See the colour-space note in the header: the framebuffer is already in output
		// space, so decode it to working space and let the material re-encode on the way out.
		// The cast is a typings gap, not a shape mismatch: `colorSpaceToWorking` is declared
		// as returning its own `ColorSpaceNode` class rather than one of the vec unions
		// `colorNode` is typed against, though it produces a vec4 here like any other sample.
		material.colorNode = colorSpaceToWorking(
			viewportMipTexture(sampleUV, focus),
			renderer.outputColorSpace
		) as unknown as THREE.Node<'vec4'>;
		// The blend against the untouched frame. Everything the effect does -- refraction,
		// blur, drops -- arrives through this one number, so a dry lens costs nothing
		// visually even on the frames either side of `mesh.visible` flipping.
		material.opacityNode = uWetness;

		return { geometry: instancedQuad(1), material };
	};

	const { geometry, material } = build();

	// Plain variables, written and read only by the task -- a per-frame value can never be
	// reactive state (DOCS/weather-system.md §14.1).
	let wetness = 0;
	let dropTime = 0;
	let lastPosition: THREE.Vector3 | null = null;
	const stepVector = new THREE.Vector3();
	const forward = new THREE.Vector3();

	/** Base rate of the droplet clock, and how much the camera's speed adds to it. */
	const DROP_RATE = 0.18;
	const DROP_RATE_PER_SPEED = 0.025;
	/** A single-frame move beyond this is a cut, not motion. */
	const TELEPORT_WORLD = 8;

	useTask(
		(delta) => {
			const cam = camera.current;
			const position = cam.position;

			// How fast, and how much of that is INTO the view. `getWorldDirection` is the
			// camera's own -Z in world space, so this is signed: reversing out of the rain
			// wets nothing, which is why it is floored at zero.
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
					// Pythagoras against the total, so this is the component perpendicular
					// to the view rather than a second projection.
					const total = stepVector.length();
					lateralSpeed = Math.sqrt(Math.max(0, total * total - forwardSpeed * forwardSpeed));
				}
			}

			// The same shared split Rain uses, off the explicit `precipitationType` channel.
			// Snow leaves no droplets on glass, so this layer is deliberately rain-only --
			// and during sleet it wets in proportion to the rain half alone.
			const rain = rainAmount(descriptor.weather);

			const speed = forwardSpeed + lateralSpeed * lateralInfluence;
			const target = clamp01(speed / speedForFull) * rain * maxWetness;

			// Asymmetric one-pole smoothing: beads up quickly, dries slowly. Both branches
			// use the `exp` form so the time constants hold at any framerate.
			const tau = target > wetness ? wetSeconds : drySeconds;
			wetness += (target - wetness) * (1 - Math.exp(-delta / tau));
			uWetness.value = wetness;

			// The clock runs faster the faster you move -- drops streak past rather than
			// drifting -- and is accumulated, never `time * rate`. See the uniform's note.
			dropTime += delta * (DROP_RATE + speed * DROP_RATE_PER_SPEED);
			uDropTime.value = dropTime;

			// Below this the blend is invisible, and skipping the draw skips a fullscreen
			// pass that evaluates the droplet field three times per pixel.
			const visible = wetness > 0.002;
			if (mesh) mesh.visible = visible;
			if (visible) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		if (mesh) mesh.layers.set(LENS_LAYER);
	});

	// The active camera — game or Studio editor — is the only one allowed to see the
	// lens (see LENS_LAYER in skyLayer.ts). Subscribed rather than read once so swapping
	// cameras carries the layer over; the subscription also fires immediately with the
	// current camera.
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

<!-- renderOrder 10: above every sky layer (1 to 4) because this must read a framebuffer
     that already contains all of them. `frustumCulled` off is mandatory -- the vertex node
     writes clip space directly and ignores the model matrix, so the geometry's bounding
     sphere describes nothing three could usefully test. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={10}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
