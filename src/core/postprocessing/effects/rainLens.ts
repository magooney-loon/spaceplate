// Water on the lens — screen-space droplets, ported from Martijn Steinrucken's
// "Heartfelt" (shadertoy.com/view/ltffzl). Drops act as tiny lenses, the wet glass
// between them is defocused, and trails are clear streaks. Moved here from a scene
// mesh because a screen-filling quad in the scene pass overwrites every non-`output`
// MRT attachment (was silently disabling motion blur in any rain).
//
// The chain carries unbounded linear HDR, so this mips an unclamped sun disc into a
// screen-wide smear without `inputClamp` — same trap and fix as bloom.
//
// Only active while moving: airflow, not gravity, carries drops outward from the point
// the camera is heading at (a windscreen, not a window) — see "The windshield" below.
// Order 36: after everything modelling the scene/air (ao 10, dof 30, fogScatter 32,
// motionBlur 35), before bloom (40, so water-scattered light blooms too).

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
	vec3
} from 'three/tsl';
import {
	uDropTime,
	uFlowTime,
	uWetness
} from '$core/skybox/layers/precipitation/lensState.svelte';
import type { EffectDef } from '../types';
import { mipSource } from './mipSource';

export type RainLensParams = {
	/** Zoom of the static droplet pattern — a fixed piece of glass. The running layers'
	 * size is set by `RADIAL_COLUMNS` instead (a build constant, not a param — see
	 * "The windshield"), so this only sizes the static drops. */
	scale: number;
	/** Multiplier on the refraction offset. 0 keeps the drops but stops them bending. */
	refraction: number;
	/**
	 * Radius of the clear centre, in half-frame-heights. Coverage ramps from here to
	 * `+ COVERAGE_BAND`. The centre is exempt because that's where airflow comes from
	 * (the last place water reaches on a windscreen) and it's what the player looks
	 * through — a lens beading over the whole frame reads as a dirty screen, one that
	 * closes in from the edges reads as weather. Measured in frame units, not pattern
	 * units, so it doesn't move when `scale` does.
	 */
	clearRadius: number;
	/** Mip level sampled for the wet glass between drops, at full wetness. Tuned much
	 * lower than the original's demo value — a game frame that goes soft on every move
	 * is unreadable. */
	glassBlur: number;
	/** Mip level sampled through a drop — lower than `glassBlur`, since a drop is a
	 * lens and resolves sharper than the film around it. */
	dropBlur: number;
	/** Ceiling on the linear value the lens is allowed to sample — see `mipSource.ts`. */
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
	// Always in the graph — the weatherGrade bargain, not a latch: the final `mix`
	// below is weighted by `uWetness` alone, an exact 0 when dry, so the effect is a
	// true identity at rest. The droplet field still evaluates three times per pixel,
	// fullscreen, whatever the weather — that's the cost this trades for never
	// rebuilding the pipeline on a rain transition (postprocessing/CLAUDE.md).
	note: 'Driven by weather + camera speed, not by these sliders — it only appears when you move through rain, and the drops stream outward from the centre of the frame as a windscreen does. Tuning here is the look of the glass; the wetting behaviour lives in LensDriver.svelte.',
	build: (ctx, u) => {
		// Everything below is inside `Fn()`: TSL's assignment operators need a stack to
		// record into and fail silently outside one (layers/skyLayer.ts). Leans on
		// `.toVar()`/`.addAssign()` to stay diffable against the GLSL original.

		/** The shader's `S(a, b, t)`: needs the DESCENDING form (`Saw` calls it with
		 * a > b), and WGSL leaves `smoothstep` undefined when edge0 >= edge1. */
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

		/** Rises to 1 at `b`, falls back to 0 at 1 — one drop's life over its cycle. */
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

		/** Drops running down the glass, each leaving a tapering trail with smaller
		 * droplets strung along it. Returns (mask, trail). */
		const DropLayer2 = Fn(([uvIn, t]: [any, any]): any => {
			// The unscrolled coordinate — kept for the horizontal wiggle and trailing
			// droplets, which stay pinned to the glass while the drops slide down it.
			const uvBase = vec2(uvIn).toVar();
			const uv = vec2(uvIn).toVar();
			uv.y.addAssign(t.mul(0.75));

			const a = vec2(6, 1);
			const grid = a.mul(2);
			const id = vec2(floor(uv.mul(grid))).toVar();

			// Offset each column by its own random amount so neighbours aren't in lockstep.
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

			// Droplets strung along the trail, on a grid pinned to the glass. (The
			// original's unused `droplets`/`trail2` overwrite is dead code, not reproduced.)
			const dropletY = fract(uvBase.y.mul(10)).add(st.y.sub(0.5));
			const dd = st.sub(vec2(x, dropletY)).length();
			const droplets = S(float(0.3), float(0), dd);

			return vec2(mainDrop.add(droplets.mul(r).mul(trailFront)), trail);
		});

		// ── The windshield ──────────────────────────────────────────────────────
		//
		// Gravity is not what moves water on a moving windscreen: drops land, airflow
		// catches them, and they sweep outward from the point the vehicle is heading
		// at — the centre of the frame for a forward-facing camera. The port's drops
		// ran straight down, which is what a parked car does, and this lens only
		// exists while the camera is moving, so down was wrong in every frame that
		// showed it.
		//
		// The fix is a change of coordinates, not of the shader: the running layers
		// are evaluated in screen-centred log-polar space, where the field's own
		// "down" axis IS the radial direction — every ported line survives unchanged,
		// except lanes become spokes and "behind" points back at the centre.
		//
		// Log-polar rather than plain polar because `(theta, log r)` is conformal: a
		// square cell maps to a square screen patch, so drops stay round and grow as
		// they travel out, matching perspective. A constant scroll rate in `log r` is
		// an accelerating drop in screen space, exactly like a windscreen.
		//
		// The seam at theta = +/-pi is exact, not approximate: the pattern is periodic
		// in x with period 1/12 (`grid.x`), and the two sides meet cell-for-cell as
		// long as the circumference is an integer number of columns. `RADIAL_COLUMNS`
		// is that integer and `FLOW_SCALE` is what makes it so.
		const RADIAL_COLUMNS = 96;
		const FLOW_SCALE = RADIAL_COLUMNS / (24 * Math.PI);

		/** Pattern space -> flow space. `x` is angle around the frame centre, `y` is
		 * negated log-distance so the pattern's downhill direction points outward. */
		const flowUV = (p: any) =>
			vec2(atan(p.y, p.x).mul(FLOW_SCALE), log(p.length().max(1e-3)).mul(-FLOW_SCALE));

		/**
		 * Static drops (pattern space) plus two running layers (flow space). Returns
		 * (mask, trail). The transform lives here so all three evaluations below share
		 * it and the refraction normal is still a screen-space gradient.
		 */
		const Drops = Fn(([uvIn, t, flow, l0, l1, l2]: [any, any, any, any, any, any]): any => {
			// Guard against the centre-of-expansion singularity (angle spins arbitrarily
			// fast there) — a couple percent of the frame, inside the clear middle anyway.
			const r = uvIn.length();
			const hub = smoothstep(float(0.012), float(0.09), r);
			const uvFlow = flowUV(uvIn);

			const s = StaticDrops(uvIn, t).mul(l0);
			const m1 = DropLayer2(uvFlow, flow).mul(l1.mul(hub)).toVar();
			const m2 = DropLayer2(uvFlow.mul(2), flow).mul(l2.mul(hub)).toVar();

			const c = S(float(0.3), float(1), s.add(m1.x).add(m2.x));
			// `m1.y * l0` / `m2.y * l1` look off-by-one against l1/l2 — kept as the
			// original wrote them; this only feeds the blur term.
			return vec2(c, m1.y.mul(l0).max(m2.y.mul(l1)));
		});

		// ── Composition ──────────────────────────────────────────────────────────

		// screenUV has y = 0 at the top (WebGPU convention); the ported shader is
		// Shadertoy's, y = 0 at the bottom. Flip once here so the ported lines below
		// stay readable against the original instead of scattering sign flips.
		const shaderUV = vec2(screenUV.x, screenUV.y.oneMinus());

		const aspect = screenSize.x.div(screenSize.y);
		const frameUV = shaderUV.sub(0.5).mul(vec2(aspect, 1));
		const patternUV = frameUV.mul(u.scale);

		// Coverage is applied to the final blend rather than the drop field: the field
		// still runs across the whole frame (drops enter the clear region already
		// formed) and simply isn't composited where the glass is clear.
		const COVERAGE_BAND = 0.4;
		const coverage = smoothstep(u.clearRadius, u.clearRadius.add(COVERAGE_BAND), frameUV.length());

		// Two clocks: `t` is a drop's own life (beading/fading in place), ticking
		// whenever the glass is wet; `flow` carries the running layers outward and
		// nearly stops when the camera does (see `uFlowTime` in lensState.svelte.ts).
		const t = uDropTime;
		const flow = uFlowTime;

		const staticDrops = S(float(-0.5), float(1), uWetness).mul(2);
		const layer1 = S(float(0.25), float(0.75), uWetness);
		const layer2 = S(float(0), float(0.5), uWetness);

		const c = Drops(patternUV, t, flow, staticDrops, layer1, layer2).toVar();

		// Normals by finite difference — the pattern is built on floor/fract grids
		// where screen-space derivatives (dFdx/dFdy) would stamp the grid into the
		// refraction. Three evaluations is the honest price; also why a dry lens must
		// leave the graph rather than multiply out to zero.
		const e = float(0.001);
		const cx = Drops(patternUV.add(vec2(e, 0)), t, flow, staticDrops, layer1, layer2).x;
		const cy = Drops(patternUV.add(vec2(0, e)), t, flow, staticDrops, layer1, layer2).x;
		const n = vec2(cx.sub(c.x), cy.sub(c.x)).mul(u.refraction);

		// Blur: heaviest on bare wet film, clearing along trails (c.y) and clearer
		// still through a drop (c.x).
		const focus = mix(u.glassBlur.sub(c.y), u.dropBlur, S(float(0.1), float(0.2), c.x));

		// Back to the renderer's own convention for the sample, undoing the flip above.
		const refractedUV = shaderUV.add(n);
		const sampleUV = vec2(refractedUV.x, refractedUV.y.oneMinus());

		const frame = mipSource(ctx, { clamp: u.inputClamp, uv: sampleUV, level: focus });

		// `wetness` was the mesh's opacityNode against NormalBlending, written out. The
		// base is the unclamped colour so the sun keeps real brightness where thin.
		return mix(ctx.color, frame, uWetness.mul(coverage));
	}
};
