// The blurred copy of the frame that fogScatter, rainLens and snowLens all sample: a
// half-float `rtt()` over the chain colour with a mip chain, so a `levelNode` buys a
// broad low-frequency smear in one bilinear fetch instead of a gaussian's several taps
// per pixel. Each caller supplies where to sample and how far down the chain.
//
// Two invariants worth keeping in one place rather than three effect headers: clamp
// what is SAMPLED, never the frame (the chain carries unbounded linear HDR — the sky's
// sun disc reaches 60800 — so callers mix against the unclamped `ctx.color`, keeping a
// bright source's real radiance wherever the effect is thin); and configure
// `uvNode`/`levelNode` IN PLACE, since `.sample()`/`.level()` return plain TextureNode
// clones and only the RTT node itself carries the `updateBefore` that fills the target.
//
// The scene transition's snapshot does NOT come through here — it's a manual capture
// (`autoUpdate: false`, no clamp, held across frames), a different resource with a
// different lifetime. See effects/sceneTransition.ts.

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
