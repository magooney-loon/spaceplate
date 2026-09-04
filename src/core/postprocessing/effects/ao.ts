// Ground Truth Ambient Occlusion — three's GTAONode, wired to the depth + normal
// buffers of the scene pass.
//
// WHY IT EXISTS, which is not "because AO looks nice". Nothing in this engine occludes
// the ambient term: `Sky.svelte` bakes the dome into `scene.environment` and
// `SkyLight.svelte` mounts a hemisphere fill, and neither knows geometry is in the way.
// A closed model is therefore lit from every direction by the full sky, so the inside
// of a building reads as if the sun shone through its walls. Shadow maps do not touch
// this — they attenuate the ONE key light, and by day `DAY_AMBIENT` is 0 precisely
// because the env map is carrying all of it (`core/skybox/model/CLAUDE.md`).
//
// IT MULTIPLIES THE COMPOSITE, NOT THE INDIRECT TERM. Physically the occlusion belongs
// to the ambient/IBL contribution alone, but separating that out in a post pass needs a
// `diffuse` MRT attachment (one of the members removed with the old ao/ssgi effects).
// Multiplying the beauty is what every screen-space AO does and it darkens directly-lit
// surfaces slightly too — that is the known error, not a bug to chase. Keep `scale`
// modest for the same reason.
//
// Ordered FIRST in the chain (10, ahead of dof's 30): AO belongs on the raw beauty,
// before anything blurs it, and before bloom — a creased corner that bloom has already
// filled with halo cannot be darkened back.
//
// KNOWN LIMITATION, the same one motion blur already lives with: non-`output` MRT
// attachments do not blend (../CLAUDE.md), so every transparent thing drawn inside the
// scene pass OVERWRITES the normal buffer rather than compositing into it — the
// precipitation fields, and above all `RainLens`/`SnowLens`, which are screen-filling
// quads. Expect the AO to degrade in heavy weather. The real fix is the prePass that
// CLAUDE.md's "Removed effects" section still lists as the pipeline's open cost
// question; it is not something this effect can solve on its own.
import { vec3, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import type { EffectDef } from '../types';

export type AoParams = {
	/** Occlusion sampling radius, in WORLD units. Scene-scale dependent. */
	radius: number;
	/** Exponent on the occlusion — the strength knob. 1 = raw GTAO. */
	scale: number;
	/** Sample count. Under 30 the node marches 3 directions, at/over it 5. */
	samples: number;
	/** View-space thickness a sample must be within to count as an occluder. */
	thickness: number;
	/** Falloff shaping along a march; the node's recommended range is [1, 2]. */
	distanceExponent: number;
	/** How fast occlusion decays with distance. Lower = larger-looking AO. */
	distanceFallOff: number;
	/**
	 * AO render-target size as a fraction of the DRAWING BUFFER. Structural — resizes
	 * the RT, and the node reads it as a plain property, not a uniform.
	 *
	 * **It multiplies on top of Settings ▸ Render Scale, it does not replace it.**
	 * GTAONode sizes itself from `renderer.getDrawingBufferSize()`, which is already
	 * `devicePixelRatio × settingsState.graphics.renderScale` (App.svelte's `dpr`). So
	 * the AO buffer is `canvas × dpr × renderScale × this`, and 0.5 on both knobs
	 * computes AO at a sixteenth of native. Named `aoBufferScale` rather than three's
	 * `resolutionScale` for exactly that reason — there are three near-identically
	 * named scales in this app (the third is DemoScene's mirror-floor reflector).
	 */
	aoBufferScale: number;
};

export const aoEffect: EffectDef<AoParams> = {
	id: 'ao',
	label: 'Ambient Occlusion',
	role: 'chain',
	order: 10,
	// `depth` is a PassNode builtin; `normal` is the MRT attachment this re-introduces.
	requires: ['depth', 'normal'],
	params: () => ({
		radius: 0.5,
		scale: 1,
		samples: 16,
		thickness: 1,
		distanceExponent: 1,
		distanceFallOff: 1,
		aoBufferScale: 0.5
	}),
	// Off by default: it is a real per-frame cost on a frame that already renders the
	// scene up to five times (DOCS/best-practices.md), and it changes the look of every
	// existing scene. Opt in from the panel.
	defaultEnabled: false,
	// `aoBufferScale` is a plain property on the node, not a uniform() — the only way
	// to change it is to rebuild. Everything else below is hot.
	structural: ['aoBufferScale'],
	ranges: {
		radius: { min: 0.05, max: 5, step: 0.05 },
		scale: { min: 0.1, max: 4, step: 0.05 },
		samples: { min: 4, max: 64, step: 1 },
		thickness: { min: 0.05, max: 5, step: 0.05 },
		distanceExponent: { min: 1, max: 2, step: 0.05 },
		distanceFallOff: { min: 0, max: 1, step: 0.05 },
		aoBufferScale: { min: 0.25, max: 1, step: 0.25 }
	},
	note: 'Occludes the sky ambient that lights closed interiors from the inside. Radius is in world units — raise it for big models, lower it for a contact-shadow look. AO Buffer Scale multiplies ON TOP of Settings ▸ Render Scale; half is usually indistinguishable at a quarter of the cost.',
	build: (ctx, u) => {
		const aoNode = ctx.track(ao(ctx.depth, ctx.normal, ctx.camera));

		// GTAONode takes only (depth, normal, camera); every other parameter is a
		// `uniform()` it constructs for itself. Replacing those with the pipeline's own
		// bag BEFORE the node is set up is what puts them on the hot path — `setup()` is
		// lazy (first draw) and reads `this.radius` & co. at that point, so the bag's
		// nodes are the ones that end up in the compiled graph. Assigning after a build
		// would silently do nothing. Same rule as "never pass a raw number to a node
		// factory" in ../CLAUDE.md, for a node with no factory arguments to pass them to.
		aoNode.radius = u.radius;
		aoNode.scale = u.scale;
		aoNode.samples = u.samples;
		aoNode.thickness = u.thickness;
		aoNode.distanceExponent = u.distanceExponent;
		aoNode.distanceFallOff = u.distanceFallOff;
		aoNode.resolutionScale = u.aoBufferScale.value;

		// `.r` EXPLICITLY. The AO target is RedFormat, but a pass texture node is vec4
		// whatever was written into it, and TSL's promotion rule ("use the greater length
		// vector") would silently make `color.rgb.mul(aoOut)` a vec4 — the exact trap
		// documented under "TSL silently widens" in ../CLAUDE.md.
		const occlusion = aoNode.getTextureNode().r;
		return vec4(ctx.color.rgb.mul(vec3(occlusion)), ctx.color.a);
	}
};
