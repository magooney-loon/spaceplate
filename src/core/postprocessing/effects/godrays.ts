// Godrays — real crepuscular rays: the view ray is raymarched through the key light's
// shadow volume, so beams are cast by actual scene geometry and exist whether or not
// the sun is on screen. Three passes, as three's own example lays them out:
//
//   godrays(depth, camera, light) -> bilateralBlur(...) -> godrayCompositeFn(...)
//
// Only the composite is ours rather than the addon's — the addon's `depthAwareBlend`
// lerps toward the light colour, which darkens an HDR frame brighter than that colour
// (most of a sunlit scene). Driven by the sky, not the panel —
// `$core/skybox/godrays.svelte.ts` carries the key light, its colour/radiance and the
// haze weight. Needs a patched three (`patches/three.patch`): upstream's `GodraysNode`
// doesn't recognise our `SunLight` or its two-cascade shadow atlas, and its march has
// banding the patch also fixes. Full rationale: postprocessing/CLAUDE.md.

import {
	Fn,
	Loop,
	array,
	convertToTexture,
	exp,
	float,
	perspectiveDepthToViewZ,
	reference,
	textureSize,
	uv,
	vec2,
	vec4,
	viewZToOrthographicDepth
} from 'three/tsl';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import {
	godrayActivity,
	uGodrayColor,
	uGodrayRadiance,
	uGodrayWeight
} from '$core/skybox/godrays.svelte';
import type { EffectDef } from '../types';

/**
 * The composite — ours, not the addon's `depthAwareBlend`. Adds the inscattered light
 * rather than lerping toward it (a lerp darkens anything brighter than the light
 * colour and crushes contrast across shadow boundaries). The half-res fetch is a joint
 * bilateral upsample rather than the addon's binary push-select, which avoids a
 * per-pixel decision that crawls as the camera moves.
 */
const godrayCompositeFn = Fn(
	([base, rays, depth, near, far, inscatter, spread, tolerance]: any[], _builder: any) => {
		const uvNode = base.uvNode || uv();

		const linearDepth = (raw: any) =>
			viewZToOrthographicDepth(perspectiveDepthToViewZ(raw, near, far), near, far);

		const centerDepth = linearDepth(depth.sample(uvNode)).toConst();

		// The ray buffer's own texel, so the taps straddle the low-res samples that exist.
		const rayTexel = vec2(1)
			.div(vec2(textureSize(rays) as any))
			.mul(spread)
			.toConst();

		// Window relative to this pixel's own depth — a fixed world-space tolerance
		// would be the whole scene at the far plane and sub-millimetre at the near one.
		const falloff = centerDepth.mul(tolerance).max(1e-6).toConst();

		const sum = rays.sample(uvNode).r.toVar();
		const weight = float(1).toVar();

		const offsets = array([vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1)]);

		Loop(4, ({ i }: any) => {
			const tapUv = uvNode.add(offsets.element(i).mul(rayTexel));
			const tapDepth = linearDepth(depth.sample(tapUv));
			// 1 on the same surface, smoothly to 0 across a silhouette.
			const w = exp(tapDepth.sub(centerDepth).abs().div(falloff).negate()).mul(0.5);
			sum.addAssign(rays.sample(tapUv).r.mul(w));
			weight.addAssign(w);
		});

		const shaft = sum.div(weight);
		const scene = base.sample(uvNode);
		return vec4(scene.rgb.add(inscatter.mul(shaft)), scene.a);
	}
);

export type GodraysParams = {
	/** Accumulation rate along the ray. The sky's haze weight multiplies this as a
	 * ceiling — see CLAUDE.md for why this wants to be high, not "bright". */
	density: number;
	/** Fraction of the key light's own radiance a fully saturated ray adds to the
	 * frame — a linear gain, read against `SUN_INTENSITY` (4.75). */
	maxDensity: number;
	/** How fast accumulation falls off with distance from the camera, over the shadow range. */
	distanceAttenuation: number;
	/** Raymarch steps per pixel. Hot — bounds a `Loop` through a uniform. */
	raymarchSteps: number;
	/** Raymarch resolution as a fraction of the drawing buffer. The cost lever. Structural. */
	resolutionScale: number;
	/** Bilateral blur radius (`kernelSize = sigma * 2 + 3`). Structural; 0 skips the blur pass. */
	blurSigma: number;
	/** The bilateral filter's `sigmaColor`, read against the ray buffer's own range
	 * (0..maxDensity, not 0..1) — see CLAUDE.md. Structural. */
	blurTolerance: number;
	/** Composite upsample tap spacing, in ray-buffer texels. */
	upsampleSpread: number;
	/** How far apart two depths must be before the composite stops trusting a tap, as
	 * a fraction of the pixel's own depth. Soft falloff, not a cutoff. */
	upsampleTolerance: number;
};

export const godraysEffect: EffectDef<GodraysParams> = {
	id: 'godrays',
	label: 'Godrays',
	role: 'chain',
	// After fogScatter (32), before motion blur/lenses/bloom: light in the air of the
	// scene belongs under anything modelling the lens, shutter or eye.
	order: 33,
	requires: ['depth'],
	structural: ['resolutionScale', 'blurSigma', 'blurTolerance'],
	params: () => ({
		density: 6,
		maxDensity: 0.06,
		distanceAttenuation: 2,
		raymarchSteps: 48,
		resolutionScale: 0.5,
		blurSigma: 4,
		blurTolerance: 0.03,
		upsampleSpread: 1,
		upsampleTolerance: 0.04
	}),
	// Off by default — not for cost (the latch already zeroes that in clear air) but
	// because it's a look: the composite brightens most of the frame the moment it fires.
	defaultEnabled: false,
	ranges: {
		density: { min: 0, max: 20, step: 0.1 },
		maxDensity: { min: 0, max: 0.5, step: 0.005 },
		distanceAttenuation: { min: 0, max: 5, step: 0.05 },
		raymarchSteps: { min: 16, max: 120, step: 1 },
		resolutionScale: { min: 0.25, max: 1, step: 0.05 },
		blurSigma: { min: 0, max: 8, step: 1 },
		blurTolerance: { min: 0.005, max: 0.25, step: 0.005 },
		upsampleSpread: { min: 0, max: 3, step: 0.25 },
		upsampleTolerance: { min: 0.005, max: 0.3, step: 0.005 }
	},
	// The latch: the graph must not contain this effect while the sky is clear or no
	// key light is mounted — none of its cost is skippable from inside the shader.
	structuralTag: () => {
		const { active, light } = godrayActivity;
		if (!active || light === null || light.shadow.map === null) return 'off';
		return `on:${light.id}`;
	},
	note: 'True raymarched crepuscular rays — the view ray is stepped through the sun’s shadow cascades, so the beams are cast by real geometry and do not vanish when the sun leaves the frame. Driven by the weather haze: it costs nothing in clear air. Resolution Scale is the cost lever. Density shapes the ray (how fast it saturates along its length), Max Density scales it (the share of the key light’s own radiance a saturated ray adds), and the inscatter is ADDED to the frame, so it can never darken what it crosses.',
	build: (ctx, u) => {
		// Clear air, no key light, or no shadow atlas yet: fold in nothing.
		const light = godrayActivity.light;
		if (!godrayActivity.active || light === null || light.shadow.map === null) return ctx.color;

		// Assigned before first use — `setup()` is lazy and reads these then; assigning
		// after a build silently does nothing (same rule as ao.ts).
		// `density` gets a computed node: the panel value is the ceiling, `uGodrayWeight`
		// is the weather's share of it, multiplied in-shader so neither side rebuilds.
		// `light as any`: the addon's `.d.ts` still declares DirectionalLight | PointLight,
		// which `patches/three.patch` removes at runtime but cannot patch the types for.
		const godraysNode: any = ctx.track(godrays(ctx.depth, ctx.camera, light as any));
		godraysNode.density = u.density.mul(uGodrayWeight);
		godraysNode.maxDensity = u.maxDensity;
		godraysNode.distanceAttenuation = u.distanceAttenuation;
		godraysNode.raymarchSteps = u.raymarchSteps;
		godraysNode.resolutionScale = u.resolutionScale.value;

		// Denoise: the march is dithered per pixel, and this turns the dither back into
		// a smooth shaft. Bilateral so it doesn't smear a beam across its own silhouette.
		// Both args are baked into the kernel, hence structural — sigma 0 is a different
		// graph (skip the pass), not a different value.
		const blurSigma = u.blurSigma.value;
		const rays =
			blurSigma > 0
				? ctx
						.track(
							bilateralBlur(
								godraysNode.getTextureNode(),
								undefined,
								blurSigma,
								u.blurTolerance.value
							)
						)
						.getTextureNode()
				: godraysNode.getTextureNode();

		// The composite samples its base node, so a computed chain colour (anything
		// after AO or DoF) needs converting to a texture first, same as motionblur.ts.
		const base: any = convertToTexture(ctx.color);
		if (base !== (ctx.color as unknown)) {
			// RTTNode owns a render target but has no dispose() of its own.
			ctx.track({ dispose: () => base.renderTarget.dispose() });
		}

		// The key light's colour at its own magnitude, so a bare unit colour composited
		// into HDR doesn't read dimmer than the scene it's meant to be lighting.
		const inscatter = uGodrayColor.mul(uGodrayRadiance);

		return godrayCompositeFn(
			base,
			rays,
			ctx.depth,
			reference('near', 'float', ctx.camera),
			reference('far', 'float', ctx.camera),
			inscatter,
			u.upsampleSpread,
			u.upsampleTolerance
		);
	}
};
