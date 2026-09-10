// Scene transition — the composite that dissolves the outgoing scene's FROZEN LAST
// FRAME into the incoming live one. Why a snapshot rather than three's two-live-pass
// `TransitionNode`, and why it is mixed here in linear chain colour: ../transitionState.
//
// LAST IN THE CHAIN (order 60, after the vignette) and DEFAULT ON at mix 0, the
// afterimage's bargain rather than the lenses': a structural latch would rebuild the
// graph at the exact moment a transition starts, and a rebuild is the hitch the veil
// exists to hide. At rest it costs one texture fetch and one `mix` per pixel, and the
// snapshot target is still 1×1 — `rtt()` sizes itself on its first real capture, so a
// session that never switches scenes never allocates a full-screen target for this.
//
// THE PATTERN IS STRUCTURAL, on purpose: each one is a different mask expression rather
// than a branch, so the shader carries only the wipe actually in use. It is a panel
// choice, never something a running transition changes.

import {
	clamp,
	cos,
	float,
	length,
	mix,
	mx_fractal_noise_float,
	rtt,
	saturation,
	sin,
	uv,
	vec2,
	vec3,
	vec4
} from 'three/tsl';
import { HalfFloatType, LinearMipmapLinearFilter } from 'three/webgpu';
import type { EffectDef } from '../types';
import { registerSnapshot, uTransitionHold, uTransitionMix } from '../transitionState.svelte';

/** Ceiling on the push-in, as a fraction of the frame. A long load drifts, then settles. */
const PUSH_MAX = 0.3;
/** How fast the blur and the desaturation reach their full value, per second. */
const RAMP_RATE = 0.8;

export type SceneTransitionParams = {
	/** 0 fade · 1 wipe · 2 radial · 3 dissolve. Structural — a different mask, not a branch. */
	pattern: number;
	/** Edge width of the wipe front, in mask units. Big values read as a soft fade. */
	softness: number;
	/** Wipe direction in turns (0 = left→right, 0.25 = bottom→top). Wipe only. */
	angle: number;
	/** Noise frequency of the dissolve. Dissolve only. */
	scale: number;
	/**
	 * Dissolve duration in SECONDS. Not a shader value — the driver reads it from the
	 * panel state (`postprocessingState.sceneTransition.revealSeconds`); its uniform in
	 * the bag goes unused, which is the price of keeping every knob in one place.
	 */
	revealSeconds: number;
	/** Push-in per second the cover is up, as a fraction of the frame. 0 = dead still. */
	push: number;
	/** Mip level the frozen frame blurs to while it covers. 0 = stays sharp. */
	blur: number;
	/** How far the frozen frame drains toward grey while it covers. 0 = keeps its colour. */
	desaturate: number;
};

export const PATTERN_FADE = 0;
export const PATTERN_WIPE = 1;
export const PATTERN_RADIAL = 2;
export const PATTERN_DISSOLVE = 3;

/**
 * The mask a pixel is ranked by: LOW reveals the live scene first. `null` means "no
 * mask" (a plain fade), which is a different formula rather than a constant mask —
 * a uniform mask cannot produce a full-range fade through the threshold maths.
 */
const maskFor = (pattern: number, u: any, aspect: any): any => {
	if (pattern === PATTERN_WIPE) {
		// A linear gradient at `angle`, normalised so the corners stay inside 0…1.
		const p = uv().sub(0.5);
		const a = u.angle.mul(Math.PI * 2);
		return p.x
			.mul(cos(a))
			.add(p.y.mul(sin(a)))
			.add(0.5);
	}
	if (pattern === PATTERN_RADIAL) {
		// Aspect-corrected so the front is a circle on any viewport, and scaled by
		// 1/√2 · 2 so it reaches the corners exactly at 1 (the vignette's constant).
		return length(uv().sub(0.5).mul(vec2(aspect, 1))).mul(1.42);
	}
	if (pattern === PATTERN_DISSOLVE) {
		// MaterialX fractal noise, remapped to 0…1. Screen-space on purpose: the frozen
		// frame is screen-space too, so a world-space mask would have nothing to hold
		// on to. Cast because the scaled `uv()` types as vec3 through the addon `.d.ts`
		// (the 2D variant of this noise is not declared there at all).
		const p = vec3(uv().mul(u.scale) as any, 0);
		return mx_fractal_noise_float(p as any, 3)
			.mul(0.5)
			.add(0.5);
	}
	return null;
};

export const sceneTransitionEffect: EffectDef<SceneTransitionParams> = {
	id: 'sceneTransition',
	label: 'Scene Transition',
	role: 'chain',
	order: 60,
	requires: [],
	note: 'Freezes the outgoing scene and dissolves it into the new one. Driven by scene switches — at rest it does nothing.',
	params: () => ({
		pattern: PATTERN_DISSOLVE,
		softness: 0.18,
		angle: 0,
		scale: 6,
		revealSeconds: 0.7,
		push: 0.045,
		blur: 2.2,
		desaturate: 0.45
	}),
	defaultEnabled: true,
	structural: ['pattern'],
	ranges: {
		softness: { min: 0.02, max: 1, step: 0.01 },
		angle: { min: 0, max: 1, step: 0.01 },
		scale: { min: 1, max: 40, step: 0.5 },
		revealSeconds: { min: 0.1, max: 3, step: 0.05 },
		push: { min: 0, max: 0.2, step: 0.005 },
		blur: { min: 0, max: 5, step: 0.1 },
		desaturate: { min: 0, max: 1, step: 0.01 }
	},
	options: {
		pattern: [
			{ value: PATTERN_FADE, text: 'Fade' },
			{ value: PATTERN_WIPE, text: 'Wipe' },
			{ value: PATTERN_RADIAL, text: 'Radial' },
			{ value: PATTERN_DISSOLVE, text: 'Dissolve' }
		]
	},
	build: (ctx, u) => {
		// The frozen frame. `autoUpdate: false` makes this a manual capture: the node
		// renders the chain into its target only on frames where the driver has set
		// `textureNeedsUpdate`, and holds that image until the next capture. Tracked for
		// disposal — the builder only owns what an effect RETURNS. Mipmapped, because the
		// cover blurs as it ages, and that blur is a mip level (the `rtt()` + `levelNode`
		// route fogScatter/rainLens established here). They regenerate on capture only.
		// `autoUpdate` is an RTTNode option, not a RenderTarget one — the addon `.d.ts`
		// types the bag as RenderTargetOptions and does not know that (CLAUDE.md's
		// "Rebuild discipline": the typings are looser than the runtime).
		const snapshot = ctx.track(
			rtt(ctx.color, null, null, {
				autoUpdate: false,
				type: HalfFloatType,
				generateMipmaps: true,
				minFilter: LinearMipmapLinearFilter
			} as any)
		) as any;
		registerSnapshot(snapshot);

		// ── The cover MOVES ───────────────────────────────────────────────────────
		//
		// A frozen frame held for a whole load reads as a hang, however good the
		// dissolve at the end is. So the still image gets a slow push-in, a blur that
		// racks over the first second or so, and a drain toward grey — the shape of a
		// film dissolve, and enough motion that the player reads "going somewhere"
		// rather than "stopped". `uTransitionHold` is the seconds it has been up, and
		// it keeps rising THROUGH the reveal so the motion carries into the new scene
		// instead of stopping dead as it arrives.
		//
		// `uvNode` and `levelNode` are set IN PLACE, never through `.sample()`/`.level()`:
		// those return plain TextureNode clones and only the RTT node ITSELF carries the
		// `updateBefore` that fills the target (fogScatter's header has the full note).
		const hold = uTransitionHold;
		// Zoom about the centre. Capped so a very long download cannot walk the frame
		// into a close-up of four pixels.
		const zoom = float(1).add(u.push.mul(hold).min(float(PUSH_MAX)));
		snapshot.uvNode = uv().sub(0.5).div(zoom).add(0.5);
		snapshot.levelNode = hold.mul(RAMP_RATE).min(float(1)).mul(u.blur);

		const drained = hold.mul(RAMP_RATE).min(float(1)).mul(u.desaturate);
		const frozen = vec4(saturation(snapshot.rgb, float(1).sub(drained)), snapshot.a);

		// Reading the pattern from the VALUE, not the uniform: it is structural, so this
		// runs again whenever it changes and the graph carries one mask.
		const pattern = Math.round(u.pattern.value);
		const mask = maskFor(pattern, u, ctx.aspect);
		const m = uTransitionMix;

		if (mask === null) return mix(ctx.color, frozen, m);

		// The front sweeps from -softness to 1+softness so both ends clear the mask
		// range completely; `+0.5` centres the soft edge on the front itself.
		const soft = u.softness;
		const front = m.mul(soft.mul(2).add(1)).sub(soft);
		const weight = clamp(front.sub(mask).div(soft.mul(2)).add(0.5), float(0), float(1));

		return mix(ctx.color, frozen, weight);
	}
};
