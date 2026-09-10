// THE WARM GATE — "has the scene stopped COMPILING yet?", the asset gate's sibling.
//
// WARMING IS RENDERING, NOT `compileAsync`. During a normal frame three creates every
// pipeline SYNCHRONOUSLY (`Pipelines.getForRender` passes no promise array, so
// `WebGPUPipelineUtils.createRenderPipeline` takes the `device.createRenderPipeline`
// branch, not the `…Async` one) — so a material's first draw BLOCKS the main thread on
// its WGSL build and pipeline creation. That stall is the scene-entry hitch, and the
// only way to spend it somewhere invisible is to draw the frame that pays it while the
// veil is up. `renderer.compileAsync()` cannot substitute: the post-processing base pass
// renders the scene under its own `contextNode` (an isolation context, see the MRT
// shader-cache trap in core/postprocessing/CLAUDE.md), and that node's id/version are
// hashed into every RenderObject's cache key. compileAsync runs with the renderer's
// default context, so it would compile a second set of variants the real pass never
// looks up — cost and GPU memory for nothing.
//
// So the gate FORCES FRAMES and watches `renderer.info.memory.programs`, which counts
// live shader programs and only moves when three builds a new one. Quiet for a few
// consecutive rendered frames = nothing left to compile for what the scene is currently
// drawing. Warmup.svelte owns that loop; this module is the handshake, because the
// caller (the scene transition) lives outside the Canvas and has no Threlte context.
//
// WHAT IT CANNOT SEE: `_projectObject` skips invisible objects and frustum-culled ones,
// so a material that draws NOTHING during the window compiles on the frame it first
// appears. `warmupState.active` is the contract for those — an fx that hides itself
// until its first use force-shows at zero alpha while it is true, and the quiet
// detector then waits for the pipelines that produces (fx/CarExhaustFlames.svelte's
// exhaust tips are the case this exists for). Never force a LIGHT visible for this: the
// lights array is part of every lit material's cache key, so toggling one recompiles the
// whole scene.

import { logEngine } from '$extensions/logger';

export type WarmOutcome = 'quiet' | 'capped' | 'timeout' | 'skipped';

/**
 * True while the engine is warming the current scene behind a cover. Scene content
 * that is invisible at entry may force itself visible (at zero alpha) while this is
 * set, so its pipelines compile here instead of on first use.
 */
export const warmupState = $state({ active: false });

type Warmer = () => Promise<WarmOutcome>;

let warmer: Warmer | null = null;
/**
 * The re-entrancy guard, a PLAIN boolean and never `warmupState.active`.
 * `warmupState` is this module's OUTPUT — written here, read by scene content — and a
 * caller in a reactive position that also read it would be reading and writing the same
 * `$state` in one effect: the unconditional loop (`src/extensions/CLAUDE.md`). It bit
 * exactly once, as a 6-frame warm restarting forever behind the boot screen.
 */
let warming = false;

/** Warmup.svelte registers the frame loop here on mount, and clears it on destroy. */
export function setWarmer(fn: Warmer | null): void {
	warmer = fn;
}

/**
 * Runs the scene warm and resolves when compilation has gone quiet, when the frame
 * budget runs out, or when the wall-clock cap expires (a backgrounded tab renders no
 * frames at all). Like the asset gate, it can delay an entry and never block one.
 *
 * `'skipped'` means there was nothing to warm with: no Canvas (`capabilityState.tier`
 * 'none') or a warm already running.
 */
export async function warmScene(): Promise<WarmOutcome> {
	if (warmer === null || warming) return 'skipped';

	warming = true;
	warmupState.active = true;
	try {
		const outcome = await warmer();
		if (outcome !== 'quiet') logEngine.warn(`Scene warm-up ended early (${outcome})`);
		return outcome;
	} finally {
		warming = false;
		warmupState.active = false;
	}
}
