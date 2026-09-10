// Scene transition — the composite that dissolves the outgoing scene's FROZEN LAST
// FRAME down to a flat veil, and the veil back up into the incoming live one. Why a
// snapshot rather than three's two-live-pass `TransitionNode`, why it is mixed here in
// linear chain colour, and why there is a veil in the middle at all: ../transitionState.
//
// ONE MASK, TWO FRONTS. The dip (frozen → veil) and the reveal (veil → live) run the
// same threshold expression over the same mask, so a wipe sweeps once in each direction
// rather than being a dissolve on one side and a fade on the other, and a dissolve's
// blobs return in the order they left.
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
import { registerSnapshot, uTransitionMix, uTransitionVeil } from '../transitionState.svelte';

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
	 * The three durations, in SECONDS. None of them is a shader value — the driver reads
	 * them from the panel state (`postprocessingState.sceneTransition.*`) and their
	 * uniforms in the bag go unused, which is the price of keeping every knob in one
	 * place.
	 *
	 * `veilSeconds`     — the dip: how long the frozen frame takes to dissolve to flat.
	 * `minCoverSeconds` — floor on the whole cover, dip included. A re-entry into an
	 *                     already-cached scene passes its asset and warm gates in a
	 *                     couple of frames; without a floor the loading UI would strobe
	 *                     on and straight back off.
	 * `revealSeconds`   — the reveal: the veil dissolving into the live scene.
	 */
	veilSeconds: number;
	minCoverSeconds: number;
	revealSeconds: number;
	/**
	 * Zoom the frozen frame reaches at full dip, as a fraction of the frame. 0 = still.
	 *
	 * This and the two below are the plate's degradation, and all three RIDE THE DIP
	 * rather than a clock: `uTransitionVeil` is 0 at capture and 1 at flat, so they reach
	 * their full value exactly as the plate goes flat, whatever the load costs. The first
	 * version ramped them off seconds-held, which meant a long load walked them off the
	 * end of their own range and then revealed a mip-2, 45%-grey, 30%-zoomed plate into a
	 * sharp scene.
	 */
	push: number;
	/** Mip level the frozen frame blurs to at full dip. 0 = stays sharp. */
	blur: number;
	/** How far the frozen frame drains toward grey at full dip. 0 = keeps its colour. */
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
	note: 'Freezes the outgoing scene, dissolves it to the loading veil and the veil into the new one. Driven by scene switches — at rest it does nothing.',
	params: () => ({
		pattern: PATTERN_DISSOLVE,
		softness: 0.18,
		angle: 0,
		scale: 6,
		veilSeconds: 0.4,
		minCoverSeconds: 0.9,
		revealSeconds: 0.7,
		push: 0.06,
		blur: 2.2,
		desaturate: 0.45
	}),
	defaultEnabled: true,
	structural: ['pattern'],
	ranges: {
		softness: { min: 0.02, max: 1, step: 0.01 },
		angle: { min: 0, max: 1, step: 0.01 },
		scale: { min: 1, max: 40, step: 0.5 },
		veilSeconds: { min: 0.1, max: 2, step: 0.05 },
		minCoverSeconds: { min: 0, max: 4, step: 0.05 },
		revealSeconds: { min: 0.1, max: 3, step: 0.05 },
		push: { min: 0, max: 0.3, step: 0.005 },
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

		// ── The plate degrades across the DIP, not across the load ────────────────
		//
		// The frozen frame gets a push-in, a mip blur and a drain toward grey as it
		// dissolves away, so the exit is a film dissolve rather than a hard cut. All
		// three ride `uTransitionVeil` (0 at capture, 1 at flat), which is why a
		// ten-second load and a one-second load leave the plate in exactly the same
		// state: the motion that has to carry the LOAD is Loader.svelte's veil, on the
		// compositor, where a blocked main thread cannot stop it.
		//
		// `uvNode` and `levelNode` are set IN PLACE, never through `.sample()`/`.level()`:
		// those return plain TextureNode clones and only the RTT node ITSELF carries the
		// `updateBefore` that fills the target (fogScatter's header has the full note).
		const veil = uTransitionVeil;
		// Zoom about the centre.
		const zoom = float(1).add(u.push.mul(veil));
		snapshot.uvNode = uv().sub(0.5).div(zoom).add(0.5);
		snapshot.levelNode = veil.mul(u.blur);

		const frozen = vec4(saturation(snapshot.rgb, float(1).sub(veil.mul(u.desaturate))), snapshot.a);

		// Reading the pattern from the VALUE, not the uniform: it is structural, so this
		// runs again whenever it changes and the graph carries one mask.
		const pattern = Math.round(u.pattern.value);
		const mask = maskFor(pattern, u, ctx.aspect);
		const soft = u.softness;

		/**
		 * Where a 0…1 driver value puts the front. The front sweeps from -softness to
		 * 1+softness so both ends clear the mask range completely; `+0.5` centres the
		 * soft edge on the front itself. Without a mask (the plain fade) the value IS
		 * the weight — a uniform mask cannot produce a full-range fade through this.
		 */
		const advance = (t: any): any => {
			if (mask === null) return t;
			const front = t.mul(soft.mul(2).add(1)).sub(soft);
			return clamp(front.sub(mask).div(soft.mul(2)).add(0.5), float(0), float(1));
		};

		// THE COVER: the frozen plate dissolving to the veil colour. Draining to black is
		// a multiply, so it costs one op and cannot disturb alpha. Black is the veil
		// colour on purpose — it is 0 in linear working colour and 0 after any output
		// transform, so it matches Loader.svelte's `#000` exactly with nothing to keep
		// in sync. A game restyling its veil should fade its own background IN over the
		// dip rather than expect this plate to match it.
		const covered = vec4(frozen.rgb.mul(float(1).sub(advance(veil))), frozen.a);

		// THE SCREEN: the live scene under whatever the cover currently is.
		return mix(ctx.color, covered, advance(uTransitionMix));
	}
};
