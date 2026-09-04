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
// ORDER 36 -- after every geometry consumer (ao 10, dof 30, motionBlur 35), before bloom
// (40). Both halves matter. AO/DoF/motion blur are SCENE-space and must see the un-lensed,
// geometry-aligned frame; bloom is optics, and light scattered by water on the front
// element is exactly the sort of thing that should then bloom.
import { Fn, dot, float, floor, fract, mix, screenSize, screenUV, sin, sqrt, vec2, vec3, vec4 } from 'three/tsl';
import { rtt } from 'three/tsl';
import { HalfFloatType, LinearMipmapLinearFilter } from 'three/webgpu';
import { lensActivity, uDropTime, uWetness } from '$core/skybox/layers/precipitation/lensState.svelte';
import type { EffectDef } from '../types';

export type RainLensParams = {
	/**
	 * Zoom of the droplet pattern. The original animates this between 0.4 and 1.0 for its
	 * demo; a fixed value reads as a fixed piece of glass, which is what this is. Larger =
	 * drops spread further apart and appear bigger.
	 */
	scale: number;
	/** Multiplier on the refraction offset. 0 keeps the drops but stops them bending. */
	refraction: number;
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
	params: () => ({ scale: 0.85, refraction: 1, glassBlur: 2.4, dropBlur: 0.3, inputClamp: 8 }),
	defaultEnabled: true,
	ranges: {
		scale: { min: 0.2, max: 2, step: 0.05 },
		refraction: { min: 0, max: 3, step: 0.05 },
		glassBlur: { min: 0, max: 6, step: 0.1 },
		dropBlur: { min: 0, max: 6, step: 0.1 },
		inputClamp: { min: 0.5, max: 64, step: 0.5 }
	},
	// Weather drives this, not the panel: when the glass is dry the effect is left out of
	// the graph entirely rather than folded in with a zero uniform. It has to be structural
	// because a dry lens still evaluates the droplet field three times per pixel,
	// fullscreen — no uniform value avoids that. See `lensActivity`.
	structuralTag: () => (lensActivity.rain ? 1 : 0),
	note: 'Driven by weather + camera speed, not by these sliders — it only appears when you move through rain. Tuning here is the look of the glass; the wetting behaviour lives in LensDriver.svelte.',
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
		const patternUV = shaderUV.sub(0.5).mul(vec2(aspect, 1)).mul(u.scale);

		const t = uDropTime;

		// Layer weights, as the original derives them from `rainAmount`.
		const staticDrops = S(float(-0.5), float(1), uWetness).mul(2);
		const layer1 = S(float(0.25), float(0.75), uWetness);
		const layer2 = S(float(0), float(0.5), uWetness);

		const c = Drops(patternUV, t, staticDrops, layer1, layer2).toVar();

		// Normals by finite difference -- the original's "expensive" path. The cheap
		// `dFdx`/`dFdy` variant is genuinely cheaper, but this pattern is built on `floor`
		// and `fract` grids and screen-space derivatives blow up across every cell boundary,
		// stamping the grid into the refraction. Three evaluations is the honest price, and
		// it is also why a dry lens must leave the graph rather than multiply out to zero.
		const e = float(0.001);
		const cx = Drops(patternUV.add(vec2(e, 0)), t, staticDrops, layer1, layer2).x;
		const cy = Drops(patternUV.add(vec2(0, e)), t, staticDrops, layer1, layer2).x;
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
		return mix(ctx.color, frame, uWetness);
	}
};
