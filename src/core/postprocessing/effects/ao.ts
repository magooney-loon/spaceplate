// Ground Truth Ambient Occlusion — three's GTAONode, wired to the depth + normal
// buffers of the scene pass. Why it exists, and the non-output-MRT-doesn't-blend
// gotcha it surfaced: postprocessing/CLAUDE.md, "ao — the one effect that is not a look".
// Ordered FIRST in the chain (10): belongs on the raw beauty, before anything blurs it
// or bloom fills a crease with halo.
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
	 * AO render-target size as a fraction of the DRAWING BUFFER. Structural (resizes
	 * the RT; the node reads it as a plain property, not a uniform). **Multiplies on
	 * top of Settings ▸ Render Scale, does not replace it** — AO buffer is
	 * `canvas × dpr × renderScale × this`, so 0.5 on both is a sixteenth of native.
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

		// Assign onto the node BEFORE it's used — `setup()` is lazy (first draw) and reads
		// `this.radius` & co. then; assigning after a build silently does nothing.
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
