// Godrays — REAL crepuscular rays: the view ray is raymarched through the key light's
// shadow volume and every unshadowed step adds light, so the beams are cast by the actual
// scene geometry and exist whether or not the sun is on screen. Three passes, laid out as
// three's own example lays them out (webgpu_postprocessing_godrays):
//
//   godrays( depth, camera, light )  →  bilateralBlur( … )  →  godrayCompositeFn( … )
//
// the blur to take the raymarch's noise off, and the edge-aware composite to stop the rays
// leaking across silhouettes. Only the third is ours rather than the addon's, and its header
// has the reason: `depthAwareBlend` LERPS the frame toward the light colour, which darkens
// everything in an HDR frame that is brighter than that colour — i.e. most of a sunlit
// scene. Driven by the sky, not the panel — `$core/skybox/godrays.svelte.ts` carries the key
// light, its colour and radiance, and the haze weight; see postprocessing/CLAUDE.md for the
// patch this depends on and the latch contract it shares with `fogScatter`.
//
// THIS NEEDS A PATCHED three (`patches/three.patch`), for two separate reasons.
//
// CORRECTNESS: upstream's `GodraysNode` branches on `isPointLight`/`isDirectionalLight`
// only, and our key light is `SunLight` — neither, and with a TWO-CASCADE shadow atlas where
// the node assumes one map and one matrix. The patch adds the `isSunLight` branch: per-sample
// cascade selection, and march bounds taken from the VIEW frustum truncated at the shadow
// distance rather than from a light-space box (the cascades are fitted to the camera, so that
// is where the shadow information is).
//
// LOOK: three fixes to the march itself, all of which were visible as banding. Its render
// target is an 8-bit one holding a smooth screen-wide ramp; its dither rolls the sample COUNT
// rather than offsetting the samples, so neighbouring pixels march identical positions; and
// it `clamp()`s the result against `maxDensity`, drawing a contour across the brightest part
// of every shaft. Half float, a per-pixel sample offset, and a soft ceiling.

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
 * The composite — our own, where the chain used three's `depthAwareBlend`. Two departures,
 * and they fix different complaints.
 *
 * **It ADDS rather than lerping.** The addon finishes with `mix( scene, blendColor, rays )`,
 * and `blendColor` is the key light's colour, magnitude ~1, composited into an HDR frame:
 * wherever the scene is brighter than 1 — every sunlit surface, the whole dome — a shaft
 * DARKENED it. A lerp is also a contrast crush by construction, pulling lit pixels down and
 * shadowed pixels up toward the same value, so a shaft laid across a shadow boundary erased
 * the boundary. Inscattered light is light ARRIVING at the camera: it adds to whatever it is
 * in front of and it cannot subtract, so that is what this does, at the radiance the sky
 * actually has (`uGodrayRadiance`) rather than a normalised hue.
 *
 * **The half-res fetch is a DEPTH-WEIGHTED UPSAMPLE, not the addon's push.** Both exist for
 * the same reason — the ray buffer is half-res, so a straight bilinear fetch at a silhouette
 * reads the shaft belonging to the other side of the edge and haloes — but the addon's
 * answer is an eight-tap poisson search that ends in `select( uv + push, uv )`: a BINARY
 * decision, off a hard `lessThan` threshold, over a direction that jumps whenever a tap
 * crosses in or out of the depth test. Every one of those is a discontinuity, and a
 * discontinuity in a per-pixel decision is a thing that CRAWLS when the camera moves —
 * pixels flip sides frame to frame along every silhouette in the frame.
 *
 * A joint bilateral upsample is the standard answer and has no decision in it at all: weight
 * each tap by how closely its depth matches this pixel's, `exp( -|Δ| / falloff )`, and
 * normalise. Same rejection of the far side of an edge, reached smoothly, so camera motion
 * moves it continuously instead of snapping it. It is also fewer texture fetches than the
 * eight-tap search it replaces.
 */
const godrayCompositeFn = Fn(
	([base, rays, depth, near, far, inscatter, spread, tolerance]: any[], _builder: any) => {
		const uvNode = base.uvNode || uv();

		// Linear depth, so the "same surface?" weight below is a percentage rather than
		// something that means one thing at the near plane and another at the far.
		const linearDepth = (raw: any) =>
			viewZToOrthographicDepth(perspectiveDepthToViewZ(raw, near, far), near, far);

		const centerDepth = linearDepth(depth.sample(uvNode)).toConst();

		// The RAY BUFFER's texel, not the frame's: the taps have to straddle the low-res
		// samples that actually exist, or they all land inside one of them and the weighting
		// has nothing to choose between.
		const rayTexel = vec2(1)
			.div(vec2(textureSize(rays) as any))
			.mul(spread)
			.toConst();

		// The window, relative to this pixel's own depth — a fixed world-space tolerance would
		// be the whole scene at the far plane and sub-millimetre at the near one. `max` keeps
		// a pixel at depth 0 from dividing by zero.
		const falloff = centerDepth.mul(tolerance).max(1e-6).toConst();

		// The centre tap weighs 1 by construction (its own depth difference is zero), so the
		// accumulator can never come out empty and there is no guard to write.
		const sum = rays.sample(uvNode).r.toVar();
		const weight = float(1).toVar();

		const offsets = array([vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1)]);

		Loop(4, ({ i }: any) => {
			const tapUv = uvNode.add(offsets.element(i).mul(rayTexel));
			const tapDepth = linearDepth(depth.sample(tapUv));

			// 1 on the same surface, smoothly to 0 across a silhouette. The 0.5 is the spatial
			// term — a four-neighbour tent — which is what also takes the half-res blockiness
			// off the result.
			const w = exp(tapDepth.sub(centerDepth).abs().div(falloff).negate()).mul(0.5);

			sum.addAssign(rays.sample(tapUv).r.mul(w));
			weight.addAssign(w);
		});

		const shaft = sum.div(weight);
		const scene = base.sample(uvNode);

		// rgb only — alpha carries through untouched, the rule every hand-written effect
		// here follows (`vignette.ts`).
		return vec4(scene.rgb.add(inscatter.mul(shaft)), scene.a);
	}
);

export type GodraysParams = {
	/**
	 * Accumulation rate along the ray — how humid/dusty the air reads. The sky's haze weight
	 * multiplies this, so it is a CEILING and not the value itself.
	 *
	 * **It wants to be high, and that is not the same statement as "bright".** The march is
	 * `1 - exp(-illum)` over `illum = rayLength × density × mean(lit × attenuation)`, so the
	 * density decides WHERE ON THE EXPONENTIAL a typical ray sits, and `maxDensity` decides how
	 * bright that is. Down at 0.7 (the addon's default, and ours until this was understood) a
	 * ray is still on the linear part of the curve, which means **the ray's value is dominated
	 * by how far away its surface is** — the buffer is a depth map with occlusion as a minor
	 * term. That is why the shafts read as a flat lift over everything distant instead of as
	 * beams, and why they lurched whenever geometry swept through the view: depth is the thing
	 * that changes violently when the camera moves, and the effect was mostly a function of it.
	 *
	 * High enough for a typical ray to SATURATE, the length term falls out of the expression
	 * and what is left is the share of the ray that was lit — which is occlusion, which is
	 * anchored to the world and holds still while the camera does not.
	 */
	density: number;
	/**
	 * THE brightness knob: the fraction of the key light's own radiance a fully saturated
	 * ray adds to the frame. It is now a clean linear gain, and two things made it one:
	 *
	 * - the patched march scales the transmittance by it instead of `clamp()`ing against it,
	 *   so it is a ceiling that is approached rather than one that is hit (a hard clamp drew
	 *   a contour line across the middle of every bright shaft — see `patches/three.patch`);
	 * - the sky's weight is no longer multiplied in here. It belongs on `density`, which is
	 *   the physical term — more haze is more scattering per metre — and applying it to both
	 *   made the response QUADRATIC in the haze channel, so the effect spent most of the
	 *   weather range invisible and then arrived all at once.
	 *
	 * So: `density` shapes the ray, this scales it, and the sky decides how much air there
	 * is to scatter in.
	 *
	 * **Read it against 4.75.** The composite adds `keyColour × keyIntensity × this × ray`, and
	 * `SUN_INTENSITY` is 4.75, so 0.16 here is most of a unit of radiance added to a scene
	 * whose lit surfaces sit around 1.5 — a wash, not a shaft. What makes a beam read is the
	 * CONTRAST between a lit column and an occluded one, and that contrast is this number; it
	 * does not need to be large to be seen, and the whole of it is also being added to
	 * everything the beams are not.
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
	 * How much difference in ray density the blur will still smooth across — the bilateral
	 * filter's `sigmaColor`, and the knob that decides whether it behaves like a denoiser or
	 * like an edge detector.
	 *
	 * It has to be read against the range of what it is filtering, which is not a picture:
	 * the ray buffer only ever holds 0..`maxDensity`. The addon's 0.1 default was picked for
	 * an ordinary 0..1 image, and against a signal a third that size it refuses to blur any
	 * step bigger than a third of the range — i.e. it PRESERVES the march's own banding,
	 * which is the exact thing the blur was put in the chain to remove. Set at about half the
	 * usable range instead: free to smooth inside a shaft, still unwilling to smear one
	 * across the silhouette that cut it. Structural — it is folded into the kernel as a
	 * constant, like `blurSigma`.
	 */
	blurTolerance: number;
	/**
	 * Composite upsample tap spacing, in RAY-BUFFER texels (so at `resolutionScale` 0.5, 1 is
	 * two screen pixels). Below 1 the four taps land inside the centre texel and the weighting
	 * has nothing to choose between; well above it the tent starts smearing the shaft.
	 */
	upsampleSpread: number;
	/**
	 * How far apart two depths have to be before the composite stops trusting a tap, as a
	 * FRACTION of the pixel's own depth. The anti-leak knob: too low and the upsample rejects
	 * its own neighbours on a steeply angled floor and goes blocky, too high and shafts bleed
	 * across silhouettes. It is a soft `exp()` falloff, not a cutoff — there is no value of
	 * this that puts a hard edge back into the result.
	 */
	upsampleTolerance: number;
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
	structural: ['resolutionScale', 'blurSigma', 'blurTolerance'],
	params: () => ({
		// High on purpose — this is the knob that decides whether the ray buffer is an
		// occlusion map or a depth map, and only the first of those holds still when the
		// camera moves. See the param's note; it is multiplied by the sky's weight, which
		// spends most of its life around 0.1..0.5, so the panel number has to carry that.
		density: 6,
		// A LINEAR GAIN on the key's radiance (~4.75), not a mix ceiling against a unit
		// colour. What sells a beam is its contrast against the unlit air beside it, and
		// that contrast IS this number — all of which is also added to everything the beams
		// are not, which is what "washed out" means.
		maxDensity: 0.06,
		distanceAttenuation: 2,
		raymarchSteps: 48,
		resolutionScale: 0.5,
		blurSigma: 4,
		// Half the usable range, which is 0..`maxDensity` and nothing like 0..1.
		blurTolerance: 0.03,
		upsampleSpread: 1,
		upsampleTolerance: 0.04
	}),
	// OFF by default, and not for the cost reason `fogScatter` would give — the latch below
	// already makes that zero in clear air. It is off because it is a LOOK, and one that
	// changes every existing scene: the composite adds the key light's own radiance to every
	// pixel with lit air in front of it, which is most of the frame, so the whole image
	// brightens and desaturates the moment the sky asks for shafts. That is a decision a game
	// should opt into, the same call `ao` makes and for the same reason.
	defaultEnabled: false,
	ranges: {
		density: { min: 0, max: 20, step: 0.1 },
		// 0..0.5, not 0..1: past ~0.2 a saturated ray is adding a full unit of radiance to an
		// HDR frame lit at about 1.5, and every value above that is a white-out with a slider
		// under it. The useful band is small, so give it the resolution instead of the reach.
		maxDensity: { min: 0, max: 0.5, step: 0.005 },
		distanceAttenuation: { min: 0, max: 5, step: 0.05 },
		raymarchSteps: { min: 16, max: 120, step: 1 },
		resolutionScale: { min: 0.25, max: 1, step: 0.05 },
		blurSigma: { min: 0, max: 8, step: 1 },
		blurTolerance: { min: 0.005, max: 0.25, step: 0.005 },
		upsampleSpread: { min: 0, max: 3, step: 0.25 },
		upsampleTolerance: { min: 0.005, max: 0.3, step: 0.005 }
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
	note: 'True raymarched crepuscular rays — the view ray is stepped through the sun’s shadow cascades, so the beams are cast by real geometry and do not vanish when the sun leaves the frame. Driven by the weather haze: it costs nothing in clear air. Resolution Scale is the cost lever. Density shapes the ray (how fast it saturates along its length), Max Density scales it (the share of the key light’s own radiance a saturated ray adds), and the inscatter is ADDED to the frame, so it can never darken what it crosses.',
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
		// `density` is assigned a COMPUTED node, not the bare bag uniform: the panel value is
		// the ceiling and `uGodrayWeight` is the share of it the weather is asking for,
		// multiplied in the shader so neither side needs a rebuild to move.
		//
		// **The weight lands on `density` ALONE.** It used to be multiplied into `maxDensity`
		// as well, which made the whole effect quadratic in the haze channel: at half haze both
		// terms were halved, so the shafts were a quarter of themselves, and the weather range
		// read as nothing-nothing-nothing-suddenly. Only `density` is the physical term (more
		// haze is more scattering per metre); `maxDensity` is an artistic gain and has no
		// business knowing about the weather.
		//
		// `light as any`: the addon's `.d.ts` still declares `DirectionalLight | PointLight`,
		// which is the very limitation `patches/three.patch` removes at runtime. Typing is the
		// one part of that patch that cannot be applied — the bundled declarations are
		// generated, not patched.
		const godraysNode: any = ctx.track(godrays(ctx.depth, ctx.camera, light as any));
		godraysNode.density = u.density.mul(uGodrayWeight);
		godraysNode.maxDensity = u.maxDensity;
		godraysNode.distanceAttenuation = u.distanceAttenuation;
		godraysNode.raymarchSteps = u.raymarchSteps;
		godraysNode.resolutionScale = u.resolutionScale.value;

		// Denoise. The march is dithered per pixel (`interleavedGradientNoise`, now offsetting
		// the SAMPLES rather than rolling their count — `patches/three.patch`), and the blur is
		// what turns that dither back into a smooth shaft. BILATERAL rather than gaussian
		// because it is edge-aware on the ray density itself, so it does not smear a beam
		// across the silhouette that cut it — but only as edge-aware as `blurTolerance` lets
		// it be; see that param for why the addon's default is the wrong number here.
		//
		// Both arguments are constructor arguments baked into the kernel, hence structural —
		// and hence the sigma 0 case is a different GRAPH, not a different value: skip the pass.
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

		// The composite SAMPLES its base node (`base.sample(uv)` plus a `textureSize` on it),
		// so a computed chain colour — anything after AO or the basic DoF — throws. Convert,
		// exactly as `motionblur.ts` has to for the same reason: a texture input passes through
		// free, a computed one gets an RTT.
		const base: any = convertToTexture(ctx.color);
		if (base !== (ctx.color as unknown)) {
			// RTTNode owns a render target but has no dispose() of its own — register the
			// target so a rebuild frees it. When the input was already a texture this is the
			// base pass's own target, which the builder already owns; skip it.
			ctx.track({ dispose: () => base.renderTarget.dispose() });
		}

		// The inscattered radiance: the KEY LIGHT's colour (so the sun→moon crossover is
		// already in it) at the key light's own magnitude. The second half is the whole point —
		// a bare unit colour composited into an HDR frame is dimmer than most of what it lands
		// on, which is what made the shafts look like they were fighting the lighting rather
		// than coming from it (`uGodrayRadiance` carries the argument in full).
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
