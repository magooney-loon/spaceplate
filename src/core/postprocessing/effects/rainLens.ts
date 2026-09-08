// WATER ON THE LENS -- the screen-space droplet effect, ported from Martijn Steinrucken's
// "Heartfelt" (shadertoy.com/view/ltffzl) with its demo scaffolding stripped: no heart,
// no story timeline, no faked lightning or vignette. This app has a real Lightning layer
// and a real sky; the port keeps only the water.
//
// WHAT IT IS. Drops act as tiny lenses, the wet glass between them is defocused, and the
// trails they leave behind are clear streaks. It used to be a mesh in the scene
// (`layers/precipitation/RainLens.svelte`) reading the framebuffer through
// `viewportMipTexture` -- "post-processing without a pipeline". `lensState.svelte.ts`
// records why that had to stop; the short version is that one screen-filling quad inside
// the scene pass overwrites every non-`output` MRT attachment, which had been quietly
// disabling motion blur in any rain.
//
// WHAT THE MOVE CHANGED, and it is not nothing:
//
//   * NO COLOUR-SPACE ROUND TRIP. The mesh sampled the FRAMEBUFFER, which holds
//     output-referred values (tone-mapped and encoded), so it had to decode back to
//     working space or the frame was sRGB-encoded twice and washed out. The chain carries
//     linear working values, so that whole dance is gone.
//   * ...WHICH MEANS THE INPUT IS UNBOUNDED HDR, and that is the new trap. The sun disc is
//     `min(vSunE * Fex, 80) * 760` in SkyMesh.js -- up to 60800 against a noon sky of
//     order 1 -- and this effect MIPS its input. Un-clamped, one drop passing over the sun
//     smears it across the lens exactly as bloom does without its `inputClamp`. Hence
//     `inputClamp` here, for the same reason and with the same caveat: it clamps only what
//     the LENS samples, never the image, so the disc still renders at full brightness.
//   * THE BLUR SOURCE IS AN RTT, NOT THE FRAMEBUFFER. `viewportMipTexture` copies whatever
//     render target is bound at the time -- meaningless mid-chain -- so the mip chain comes
//     from `rtt()` over the (clamped) chain colour instead. `minFilter` must be a mipmap
//     filter or the explicit-LOD sample clamps to level 0; `ViewportTextureNode` sets
//     exactly that on its own framebuffer texture, which is where the value came from.
//
// ONLY WHEN MOVING. The lens is clear standing still and beads up as the camera drives
// into the rain. That measurement lives in `LensDriver.svelte` -- `wetness` is an
// accumulator with asymmetric time constants, quick to wet and slow to dry, because a mask
// that tracked speed directly would pop on and off every time the player stopped.
//
// ...WHICH IS ALSO WHY THE DROPS DO NOT FALL. If the lens only exists while the camera is
// driving into the rain, then the force on the water is the airflow and not gravity, and
// the drops stream OUTWARD from the point the camera is heading at -- a windscreen, not a
// window. That is a change of coordinates rather than a change of shader; the whole
// argument is at "The windshield" in `build` below.
//
// ORDER 36 -- after every geometry consumer (ao 10, dof 30, motionBlur 35), before bloom
// (40). Both halves matter. AO/DoF/motion blur are SCENE-space and must see the un-lensed,
// geometry-aligned frame; bloom is optics, and light scattered by water on the front
// element is exactly the sort of thing that should then bloom.
import {
	Fn,
	atan,
	dot,
	float,
	floor,
	fract,
	log,
	mix,
	screenSize,
	screenUV,
	sin,
	smoothstep,
	sqrt,
	vec2,
	vec3,
	vec4
} from 'three/tsl';
import { rtt } from 'three/tsl';
import { HalfFloatType, LinearMipmapLinearFilter } from 'three/webgpu';
import {
	lensActivity,
	uDropTime,
	uFlowTime,
	uWetness
} from '$core/skybox/layers/precipitation/lensState.svelte';
import type { EffectDef } from '../types';

export type RainLensParams = {
	/**
	 * Zoom of the droplet pattern. The original animates this between 0.4 and 1.0 for its
	 * demo; a fixed value reads as a fixed piece of glass, which is what this is. Larger =
	 * drops spread further apart and appear bigger.
	 *
	 * IT ONLY SIZES THE STATIC DROPS NOW. The running layers live in log-polar space
	 * (see "The windshield" in `build`), where a zoom of the pattern is `log(r) + log(k)` —
	 * a phase shift along the flow and nothing else. Their size is set by `RADIAL_COLUMNS`,
	 * which is a build constant rather than a param because the seam at ±π only closes on
	 * an integer.
	 */
	scale: number;
	/** Multiplier on the refraction offset. 0 keeps the drops but stops them bending. */
	refraction: number;
	/**
	 * Radius of the CLEAR CENTRE, in half-frame-heights: 0.5 is the top and bottom edge,
	 * ~0.89 the sides of a 16:9 frame, ~1.02 its corners. Coverage ramps from here to
	 * `+ COVERAGE_BAND` and the effect is absent inside it.
	 *
	 * WHY THE MIDDLE IS EXEMPT. Two reasons that happen to agree. The centre of the frame
	 * is where the airflow comes FROM, so on a real windscreen it is the last place water
	 * reaches and the first place it leaves — and it is also what the player is looking
	 * through. A lens that beads over the whole frame equally reads as a dirty screen; one
	 * that closes in from the edges reads as weather and stays playable.
	 *
	 * Measured in FRAME units, not pattern units, so it does not move when `scale` does.
	 */
	clearRadius: number;
	/**
	 * Mip level sampled for the wet glass BETWEEN drops, at full wetness. The original runs
	 * 3-6 here for a deliberately misted windscreen; this is tuned much lower, because a
	 * game frame that goes soft whenever the player moves is unreadable.
	 */
	glassBlur: number;
	/**
	 * Mip level sampled THROUGH a drop. Lower than `glassBlur` on purpose: a drop is a lens
	 * and resolves a sharper (if distorted) image than the film around it.
	 */
	dropBlur: number;
	/** Ceiling on the linear value the lens is allowed to SAMPLE. See the header. */
	inputClamp: number;
};

export const rainLensEffect: EffectDef<RainLensParams> = {
	id: 'rainLens',
	label: 'Rain Lens',
	role: 'chain',
	order: 36,
	requires: [],
	params: () => ({
		scale: 0.85,
		refraction: 0.8,
		clearRadius: 0.24,
		glassBlur: 1.9,
		dropBlur: 0.3,
		inputClamp: 8
	}),
	defaultEnabled: true,
	ranges: {
		scale: { min: 0.2, max: 2, step: 0.05 },
		refraction: { min: 0, max: 3, step: 0.05 },
		clearRadius: { min: 0, max: 1, step: 0.01 },
		glassBlur: { min: 0, max: 6, step: 0.1 },
		dropBlur: { min: 0, max: 6, step: 0.1 },
		inputClamp: { min: 0.5, max: 64, step: 0.5 }
	},
	// Weather drives this, not the panel: when the glass is dry the effect is left out of
	// the graph entirely rather than folded in with a zero uniform. It has to be structural
	// because a dry lens still evaluates the droplet field three times per pixel,
	// fullscreen — no uniform value avoids that. See `lensActivity`.
	structuralTag: () => (lensActivity.rain ? 1 : 0),
	note: 'Driven by weather + camera speed, not by these sliders — it only appears when you move through rain, and the drops stream outward from the centre of the frame as a windscreen does. Tuning here is the look of the glass; the wetting behaviour lives in LensDriver.svelte.',
	build: (ctx, u) => {
		// Dry glass: not in the graph at all. Returning the colour untouched makes this a
		// pass-through, the same shape the LUT effect uses before its texture lands.
		if (!lensActivity.rain) return ctx.color;

		// ── The ported shader ────────────────────────────────────────────────────────
		//
		// Everything below is inside `Fn()`: TSL's assignment operators need a stack to
		// record into and fail SILENTLY outside one (see layers/skyLayer.ts). The port leans
		// on `.toVar()` / `.addAssign()` heavily, keeping it diffable against the GLSL
		// original's mutable style.

		/**
		 * The shader's `S(a, b, t)`, written out rather than deferred to TSL's `smoothstep`.
		 *
		 * The port needs the DESCENDING form -- `Saw` calls it as `S(1., b, t)` with a > b,
		 * and so does the main drop -- and WGSL leaves `smoothstep` UNDEFINED when
		 * edge0 >= edge1. The explicit clamp is defined for both orders.
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

			// Droplets strung along the trail, on a grid pinned to the glass. (The original
			// computes a `droplets`/`trail2` pair it then overwrites unused -- dead code not
			// reproduced here.)
			const dropletY = fract(uvBase.y.mul(10)).add(st.y.sub(0.5));
			const dd = st.sub(vec2(x, dropletY)).length();
			const droplets = S(float(0.3), float(0), dd);

			return vec2(mainDrop.add(droplets.mul(r).mul(trailFront)), trail);
		});

		// ── The windshield ───────────────────────────────────────────────────────────
		//
		// GRAVITY IS NOT WHAT MOVES WATER ON A MOVING WINDSCREEN. Drops land, the airflow
		// catches them, and they are swept OUTWARD from the point the vehicle is heading
		// at — which for a forward-facing camera is the centre of the frame. The port's
		// drops ran straight down, which is what a parked car does; this lens only exists
		// while the camera is moving (`uWetness` is measured from speed), so down was the
		// wrong answer in every frame that ever showed it.
		//
		// The fix is a change of COORDINATES, not of the shader: the running layers are
		// evaluated in screen-centred log-polar space, where the field's own "down" axis
		// IS the radial direction. Every ported line below is untouched and every property
		// of the original survives — the drops still run in lanes, still leave tapering
		// trails behind them, still string droplets along those trails — except that the
		// lanes are now spokes and "behind" points back at the centre of expansion.
		//
		// WHY LOG-POLAR RATHER THAN PLAIN POLAR. `(θ, log r)` is CONFORMAL: a square cell
		// maps to a square patch of screen, so drops stay round instead of being stretched
		// into arcs, and they grow as they travel out — which is the perspective the flow
		// is a projection of. A constant scroll rate in `log r` is also an accelerating
		// drop in screen space, exactly as a windscreen looks.
		//
		// THE SEAM IS NOT AN APPROXIMATION. At θ = ±π the coordinate jumps by the full
		// circumference, and the pattern is periodic in x with period 1/12 (`grid.x`), so
		// the two sides meet cell-for-cell as long as the circumference is an INTEGER
		// number of columns. `RADIAL_COLUMNS` is that integer, `FLOW_SCALE` is what makes
		// it so, and the second layer's multiplier is 2 rather than the original's 1.85 for
		// the same reason. Neighbouring columns carry independent drops anyway (`N(id.x)`
		// offsets each one), so cell-aligned is all "seamless" has ever meant here.
		const RADIAL_COLUMNS = 96;
		const FLOW_SCALE = RADIAL_COLUMNS / (24 * Math.PI);

		/**
		 * Pattern space → flow space. `x` is the angle around the centre of the frame, `y`
		 * is the log of the distance from it, NEGATED so that the pattern's own downhill
		 * direction points outward.
		 */
		const flowUV = (p: any) =>
			vec2(atan(p.y, p.x).mul(FLOW_SCALE), log(p.length().max(1e-3)).mul(-FLOW_SCALE));

		/**
		 * Static drops (in pattern space, on the glass) plus two running layers (in flow
		 * space, streaming outward). Returns (mask, trail).
		 *
		 * The transform lives HERE, inside the differenced function, so all three
		 * evaluations share it and the refraction normal is still a screen-space gradient.
		 */
		const Drops = Fn(([uvIn, t, flow, l0, l1, l2]: [any, any, any, any, any, any]): any => {
			// The centre of expansion is a singularity: the angular coordinate spins
			// arbitrarily fast there, so the field aliases into a spinning knot at the exact
			// centre pixel. This is the guard for THAT, and nothing else — it is a couple of
			// percent of the frame wide and sits well inside the clear middle that
			// `coverage` (below) carves out for look reasons.
			const r = uvIn.length();
			const hub = smoothstep(float(0.012), float(0.09), r);
			const uvFlow = flowUV(uvIn);

			const s = StaticDrops(uvIn, t).mul(l0);
			const m1 = DropLayer2(uvFlow, flow).mul(l1.mul(hub)).toVar();
			const m2 = DropLayer2(uvFlow.mul(2), flow).mul(l2.mul(hub)).toVar();

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
		const frameUV = shaderUV.sub(0.5).mul(vec2(aspect, 1));
		const patternUV = frameUV.mul(u.scale);

		// COVERAGE IS RADIAL — see `clearRadius`. It is applied to the FINAL BLEND rather
		// than to the drop field, which is the difference between a lens that is clear in
		// the middle and a lens with no drops in the middle: the field still runs across
		// the whole frame (drops enter the covered region already formed, instead of
		// materialising at its boundary), it simply is not composited where the glass is
		// clear. Cheap, too — the field is evaluated either way, and this is one mix.
		const COVERAGE_BAND = 0.4;
		const coverage = smoothstep(u.clearRadius, u.clearRadius.add(COVERAGE_BAND), frameUV.length());

		// TWO CLOCKS, because the drops do two things. `t` is a drop's own life — beading
		// and fading in place — and it ticks whenever the glass is wet. `flow` is the
		// airflow that carries the running layers outward, and it all but stops when the
		// camera does. See `uFlowTime` in lensState.svelte.ts.
		const t = uDropTime;
		const flow = uFlowTime;

		// Layer weights, as the original derives them from `rainAmount`.
		const staticDrops = S(float(-0.5), float(1), uWetness).mul(2);
		const layer1 = S(float(0.25), float(0.75), uWetness);
		const layer2 = S(float(0), float(0.5), uWetness);

		const c = Drops(patternUV, t, flow, staticDrops, layer1, layer2).toVar();

		// Normals by finite difference -- the original's "expensive" path. The cheap
		// `dFdx`/`dFdy` variant is genuinely cheaper, but this pattern is built on `floor`
		// and `fract` grids and screen-space derivatives blow up across every cell boundary,
		// stamping the grid into the refraction. Three evaluations is the honest price, and
		// it is also why a dry lens must leave the graph rather than multiply out to zero.
		const e = float(0.001);
		const cx = Drops(patternUV.add(vec2(e, 0)), t, flow, staticDrops, layer1, layer2).x;
		const cy = Drops(patternUV.add(vec2(0, e)), t, flow, staticDrops, layer1, layer2).x;
		const n = vec2(cx.sub(c.x), cy.sub(c.x)).mul(u.refraction);

		// Blur: heaviest on the bare wet film, clearing along trails (`c.y`) and clearer
		// still seen through a drop (`c.x`).
		const focus = mix(u.glassBlur.sub(c.y), u.dropBlur, S(float(0.1), float(0.2), c.x));

		// Back to the renderer's own convention for the sample, undoing the flip above.
		const refractedUV = shaderUV.add(n);
		const sampleUV = vec2(refractedUV.x, refractedUV.y.oneMinus());

		// The mip source. Clamped (see the header), and configured IN PLACE rather than via
		// `.sample()/.level()`: those return plain TextureNode clones, and only the RTT node
		// ITSELF carries the `updateBefore` that renders the target — a graph containing
		// only clones never fills it.
		const clamped = vec4(ctx.color.rgb.min(vec3(u.inputClamp)), ctx.color.a);
		const frame: any = ctx.track(
			rtt(clamped, null, null, {
				type: HalfFloatType,
				generateMipmaps: true,
				minFilter: LinearMipmapLinearFilter
			})
		);
		frame.uvNode = sampleUV;
		frame.levelNode = focus;

		// `wetness` was the mesh's `opacityNode` against NormalBlending — the same blend,
		// written out. Everything the effect does (refraction, blur, drops) arrives through
		// this one number, and the base term is the UNCLAMPED colour so the sun keeps its
		// real brightness wherever the lens is thin.
		return mix(ctx.color, frame, uWetness.mul(coverage));
	}
};
