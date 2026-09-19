// Scene transition — dissolves the outgoing scene's FROZEN LAST FRAME down to a flat
// veil, and the veil back up into the incoming live one. Full rationale (why a snapshot
// rather than a two-live-pass crossfade, the three-phase sequence, default-on):
// postprocessing/CLAUDE.md "Scene transitions" and ../transitionState.svelte.ts.
//
// ONE MASK, TWO FRONTS: the dip and the reveal run the same threshold over the same mask,
// so a wipe sweeps once each way and a dissolve's blobs return in the order they left.

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
	 * The three durations, in seconds. None is a shader value — the driver reads them
	 * from the panel state and their bag uniforms go unused, the price of keeping every
	 * knob in one place. `veilSeconds` is the dip (frozen frame to flat); `minCoverSeconds`
	 * floors the whole cover so a re-entry into an already-cached scene doesn't strobe
	 * the loading UI on and off; `revealSeconds` is the veil dissolving into the live scene.
	 */
	veilSeconds: number;
	minCoverSeconds: number;
	revealSeconds: number;
	/** Zoom the frozen frame reaches at full dip, as a fraction of the frame. This and
	 * the two below are the plate's degradation, and all three ride the dip
	 * (`uTransitionVeil`, 0 at capture to 1 at flat) rather than a clock, so a long load
	 * doesn't walk them off the end of their own range. */
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
		// The frozen frame. `autoUpdate: false` makes this a manual capture: it renders
		// the chain into its target only on frames the driver flags via
		// `textureNeedsUpdate`, and holds that image until the next capture. Mipmapped
		// since the cover's blur is a mip level (fogScatter/rainLens's `rtt()` +
		// `levelNode` route). `autoUpdate` is an RTTNode option, not a RenderTarget one
		// — the addon `.d.ts` doesn't know that (CLAUDE.md's "Rebuild discipline").
		const snapshot = ctx.track(
			rtt(ctx.color, null, null, {
				autoUpdate: false,
				type: HalfFloatType,
				generateMipmaps: true,
				minFilter: LinearMipmapLinearFilter
			} as any)
		) as any;
		registerSnapshot(snapshot);

		// The plate degrades across the dip, not the load: push-in, mip blur and a
		// drain toward grey, all riding `uTransitionVeil` (0 at capture, 1 at flat) —
		// a ten-second load and a one-second load leave the plate in the same state.
		// `uvNode`/`levelNode` set in place, not via `.sample()`/`.level()` (those
		// return clones; only the RTT node itself carries the fill).
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

		/** Where a 0..1 driver value puts the front. Sweeps from -softness to 1+softness
		 * so both ends clear the mask range; without a mask (plain fade) the value IS
		 * the weight. */
		const advance = (t: any): any => {
			if (mask === null) return t;
			const front = t.mul(soft.mul(2).add(1)).sub(soft);
			return clamp(front.sub(mask).div(soft.mul(2)).add(0.5), float(0), float(1));
		};

		// The cover: the frozen plate dissolving to the veil colour. Black is the veil
		// colour on purpose — 0 in linear working colour and 0 after any output
		// transform, so it matches Loader.svelte's `#000` exactly with nothing to sync.
		const covered = vec4(frozen.rgb.mul(float(1).sub(advance(veil))), frozen.a);

		// The screen: the live scene under whatever the cover currently is.
		return mix(ctx.color, covered, advance(uTransitionMix));
	}
};
