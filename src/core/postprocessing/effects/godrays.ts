// Godrays — REAL crepuscular rays: the view ray is raymarched through the key light's
// shadow volume and every unshadowed step adds light, so the beams are cast by the actual
// scene geometry and exist whether or not the sun is on screen. Three passes, as three's
// own example composes them (webgpu_postprocessing_godrays):
//
//   godrays( depth, camera, light )  →  bilateralBlur( … )  →  depthAwareBlend( … )
//
// the blur to take the raymarch's noise off, and the edge-aware composite to stop the rays
// leaking across silhouettes. Driven by the sky, not the panel — `$core/skybox/godrays.svelte.ts`
// carries the key light, the colour and the haze weight; see postprocessing/CLAUDE.md for
// the patch this depends on and the latch contract it shares with `fogScatter`.
//
// THIS NEEDS A PATCHED three (`patches/three.patch`). Upstream's `GodraysNode` branches on
// `isPointLight`/`isDirectionalLight` only, and our key light is `SunLight` — neither, and
// with a TWO-CASCADE shadow atlas where the node assumes one map and one matrix. The patch
// adds the `isSunLight` branch: per-sample cascade selection, and march bounds taken from
// the VIEW frustum truncated at the shadow distance rather than from a light-space box
// (the cascades are fitted to the camera, so that is where the shadow information is).

import { convertToTexture } from 'three/tsl';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { godrayActivity, uGodrayColor, uGodrayWeight } from '$core/skybox/godrays.svelte';
import type { EffectDef } from '../types';

export type GodraysParams = {
	/**
	 * Accumulation rate along the ray — how humid/dusty the air reads. The sky's haze
	 * weight multiplies this, so it is a CEILING and not the value itself.
	 */
	density: number;
	/**
	 * Ceiling on the blend, i.e. on how far a fully-lit ray can carry the frame toward the
	 * light colour. 1 would replace the scene outright wherever the ray is unoccluded; real
	 * shafts never do that, and the remaining scene underneath is what keeps them reading as
	 * light in the air rather than as fog. Also multiplied by the sky's weight.
	 */
	maxDensity: number;
	/**
	 * How fast the accumulation falls off with distance from the camera, over the shadow
	 * range. Higher keeps the shafts close and stops the far half of a long view washing
	 * into flat haze.
	 */
	distanceAttenuation: number;
	/** Raymarch steps per pixel. Hot — it bounds a `Loop` through a uniform, not a literal. */
	raymarchSteps: number;
	/**
	 * Raymarch resolution, as a fraction of the drawing buffer. THE cost lever: this is a
	 * shadow-atlas tap per step per pixel, and the result is dithered and then blurred, so
	 * it loses very little at half size. Structural — a plain property on the node, read in
	 * `setSize`.
	 */
	resolutionScale: number;
	/**
	 * Bilateral blur radius, in pixels-ish (`kernelSize = sigma * 2 + 3`). Structural: the
	 * kernel is unrolled into the shader. 0 skips the blur pass entirely, which is the raw
	 * dithered march — noisy, and worth seeing once while tuning.
	 */
	blurSigma: number;
	/**
	 * How far the composite looks for a depth discontinuity, in pixels, and how hard it
	 * pushes the sample away from one. Together they are the anti-leak knob: too low and the
	 * rays halo around silhouettes, too high and they pull away from edges they belong to.
	 */
	edgeRadius: number;
	edgeStrength: number;
};

export const godraysEffect: EffectDef<GodraysParams> = {
	id: 'godrays',
	label: 'Godrays',
	role: 'chain',
	// 33 — immediately after `fogScatter` (32), before motion blur (35), the lenses (36/37)
	// and bloom (40). Same argument fogScatter makes for itself: this is light in the AIR of
	// the scene, so it belongs under anything modelling the lens, the shutter or the eye,
	// and bloom folding in after means the shafts themselves bloom, which is most of what
	// makes them read as bright. After fogScatter specifically, so a shaft crossing a fog
	// bank is drawn into air that has already been softened rather than being blurred by it.
	order: 33,
	// `depth` is a PassNode builtin — no MRT attachment, so this effect adds nothing to the
	// union and never forces a scene-wide shader rebuild.
	requires: ['depth'],
	structural: ['resolutionScale', 'blurSigma'],
	params: () => ({
		density: 0.7,
		maxDensity: 0.45,
		distanceAttenuation: 2,
		raymarchSteps: 48,
		resolutionScale: 0.5,
		blurSigma: 4,
		edgeRadius: 2,
		edgeStrength: 2
	}),
	// Enabled by default and free when the air is clear: the latch below keeps it out of the
	// graph entirely until the sky asks for it, so the cost is exactly zero on a clear noon
	// and at night.
	defaultEnabled: true,
	ranges: {
		density: { min: 0, max: 2, step: 0.01 },
		maxDensity: { min: 0, max: 1, step: 0.01 },
		distanceAttenuation: { min: 0, max: 5, step: 0.05 },
		raymarchSteps: { min: 16, max: 120, step: 1 },
		resolutionScale: { min: 0.25, max: 1, step: 0.05 },
		blurSigma: { min: 0, max: 8, step: 1 },
		edgeRadius: { min: 0, max: 5, step: 1 },
		edgeStrength: { min: 0, max: 5, step: 0.1 }
	},
	// The latch (see godrays.svelte.ts): the graph must not contain this effect while the
	// sky is clear or no key light is mounted, because none of its cost is skippable from
	// inside the shader — the targets are allocated and the passes run from `updateBefore`.
	// The light's id is in the key so a remount rebuilds against the new instance, and
	// `shadow.map` is, because the node reads that texture at BUILD time and it does not
	// exist until the first shadow render.
	structuralTag: () => {
		const { active, light } = godrayActivity;
		if (!active || light === null || light.shadow.map === null) return 'off';
		return `on:${light.id}`;
	},
	note: 'True raymarched crepuscular rays — the view ray is stepped through the sun’s shadow cascades, so the beams are cast by real geometry and do not vanish when the sun leaves the frame. Driven by the weather haze: it costs nothing in clear air. Resolution Scale is the cost lever; Density and Max Density are ceilings the sky spends against.',
	build: (ctx, u) => {
		// Clear air, no key light, or no shadow atlas yet: fold in nothing at all. The effect
		// stays "enabled" in the panel — this is the sky's decision, not the user's — and the
		// graph is exactly what it would be with the effect switched off.
		const light = godrayActivity.light;
		if (!godrayActivity.active || light === null || light.shadow.map === null) return ctx.color;

		// The raymarch. Its params are `uniform()`s the node creates in its constructor and
		// reads in `setup()`; assigning over them BEFORE the first build is what makes them
		// ours — `setup()` is lazy, so assigning after a build silently does nothing (the same
		// rule `ao.ts` follows for GTAONode, and the reason both live in the bag).
		//
		// `density` and `maxDensity` are assigned COMPUTED nodes, not bare bag uniforms: the
		// panel value is a ceiling and `uGodrayWeight` is the fraction of it the weather is
		// asking for, multiplied in the shader so neither side needs a rebuild to move.
		// `light as any`: the addon's `.d.ts` still declares `DirectionalLight | PointLight`,
		// which is the very limitation `patches/three.patch` removes at runtime. Typing is the
		// one part of that patch that cannot be applied — the bundled declarations are
		// generated, not patched.
		const godraysNode: any = ctx.track(godrays(ctx.depth, ctx.camera, light as any));
		godraysNode.density = u.density.mul(uGodrayWeight);
		godraysNode.maxDensity = u.maxDensity.mul(uGodrayWeight);
		godraysNode.distanceAttenuation = u.distanceAttenuation;
		godraysNode.raymarchSteps = u.raymarchSteps;
		godraysNode.resolutionScale = u.resolutionScale.value;

		// Denoise. The march is dithered per pixel (`interleavedGradientNoise`) so it bands
		// instead of striping, and the blur is what turns that dither back into a smooth
		// shaft. BILATERAL rather than gaussian because it is edge-aware on the ray density
		// itself, so it does not smear a beam across the silhouette that cut it.
		//
		// `sigma` is a constructor argument baked into the kernel size, hence structural — and
		// hence the 0 case is a different GRAPH, not a different value: skip the pass.
		const blurSigma = u.blurSigma.value;
		const rays =
			blurSigma > 0
				? ctx
						.track(bilateralBlur(godraysNode.getTextureNode(), undefined, blurSigma))
						.getTextureNode()
				: godraysNode.getTextureNode();

		// The composite. `depthAwareBlend` SAMPLES its base node (`baseNode.sample(uv)` plus a
		// `textureSize` on it), so a computed chain colour — anything after AO or the basic DoF
		// — throws. Convert, exactly as `motionblur.ts` has to for the same reason: a texture
		// input passes through free, a computed one gets an RTT.
		const base: any = convertToTexture(ctx.color);
		if (base !== (ctx.color as unknown)) {
			// RTTNode owns a render target but has no dispose() of its own — register the
			// target so a rebuild frees it. When the input was already a texture this is the
			// base pass's own target, which the builder already owns; skip it.
			ctx.track({ dispose: () => base.renderTarget.dispose() });
		}

		// `blendColor` is the KEY LIGHT's colour, so the sun→moon crossover is already in it.
		// `edgeRadius` is passed as a float uniform where three's example passes `int()`: it
		// only ever multiplies a `vec2` poisson offset, and vec2 × int is not a legal product
		// in WGSL — the example gets away with it because a literal `int()` is const-folded.
		return depthAwareBlend(base, rays, ctx.depth, ctx.camera, {
			blendColor: uGodrayColor,
			edgeRadius: u.edgeRadius,
			edgeStrength: u.edgeStrength
		} as any);
	}
};
