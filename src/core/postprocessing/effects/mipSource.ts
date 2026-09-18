// The blurred copy of the frame that fogScatter, rainLens and snowLens all sample: a
// half-float `rtt()` over the chain colour with a mip chain, so a `levelNode` buys a
// broad low-frequency smear in ONE bilinear fetch instead of a gaussian's several taps
// per pixel. Each caller supplies where to sample and how far down the chain.
//
// It exists to hold two invariants that were previously restated in three effect headers
// and could be half-remembered by the fourth:
//
// CLAMP WHAT IS SAMPLED, NEVER THE FRAME. The chain carries unbounded linear HDR — the
// sky's sun disc reaches 60800 linear (`SkyMesh.js`) — and one runaway pixel dragged
// through a mip chain comes back as a screen-wide smear. The clamp applies only to the
// copy; every caller mixes against the UNCLAMPED `ctx.color`, so a bright source keeps
// its real radiance wherever the effect is thin.
//
// CONFIGURE `uvNode`/`levelNode` IN PLACE. `.sample()` / `.level()` return plain
// TextureNode CLONES, and only the RTT node ITSELF carries the `updateBefore` that
// renders the target — a graph containing only clones never fills it.
//
// The scene transition's snapshot deliberately does NOT come through here: it is a
// manual capture (`autoUpdate: false`, no clamp, held across frames), which is a
// different resource with a different lifetime. See effects/sceneTransition.ts.

import { rtt, vec3, vec4 } from 'three/tsl';
import { HalfFloatType, LinearMipmapLinearFilter } from 'three/webgpu';
import type { BuildContext } from '../types';

export interface MipSourceOptions {
	/** Ceiling on the linear value the copy is allowed to hold — the effect's `inputClamp`. */
	clamp: any;
	/** Where to sample it (`screenUV`, or a refracted offset of it). */
	uv: any;
	/** Which mip level — the blur radius in octaves. Fractional levels interpolate. */
	level: any;
}

/** Tracked for disposal by the builder: the target dies with the build that made it. */
export const mipSource = (ctx: BuildContext, options: MipSourceOptions): any => {
	const clamped = vec4(ctx.color.rgb.min(vec3(options.clamp)), ctx.color.a);
	const node: any = ctx.track(
		rtt(clamped, null, null, {
			type: HalfFloatType,
			generateMipmaps: true,
			minFilter: LinearMipmapLinearFilter
		})
	);
	node.uvNode = options.uv;
	node.levelNode = options.level;
	return node;
};
