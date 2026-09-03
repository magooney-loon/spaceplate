// MRT attachment-count probe — the tool that found the motion-blur crash.
//
// ## What it checks
//
// The invariant WebGPU actually enforces: a pipeline's colour-target count must equal
// the attachment count of the pass it is bound in. Violating it is fatal on
// Chromium/Dawn and invisible on lenient backends:
//
//   Attachment state of [RenderPipeline "renderPipeline_NodeMaterial_22"] is not
//   compatible with [RenderPassEncoder]. Expects colorTargets [0, 1]; pipeline has [0].
//
// So for every draw this counts the `@location(...)` outputs the compiled fragment
// shader DECLARES and compares that to the attachments the render context HAS. It
// deliberately measures the end state rather than any theory about caching — an earlier
// version stamped NodeBuilderStates and watched for one crossing an attachment
// boundary, which stayed silent through a live failure and cost a debugging round.
//
// ## Reading the output
//
// One `[MRT PROBE]` line per distinct (material, outputs, attachments) triple, so a
// normal load prints an inventory and then goes quiet. Rows with `attachments=2` are the
// contents of the MRT pass.
//
//   MISMATCH   the bug, with the material's node/flags/ancestry so you can identify the
//              mesh without guessing. This is what named Studio's selection overlay.
//   stage N now drawn under attachments=…
//              one fragment ProgrammableStage used under two attachment counts. Stages
//              are deduplicated by shader SOURCE (`Pipelines.programs.fragment` is a Map
//              keyed on the WGSL string) while `WebGPUBackend.getRenderCacheKey()`
//              records only attachment 0's format and never the COUNT — so identical
//              WGSL across two contexts silently shares one GPU pipeline. That is how a
//              wrong shader becomes a wrong pipeline instead of a recompile.
//
// Everything goes through `console.log`, never `console.error`: Chromium attaches a full
// stack to every error and the render loop buries the finding under hundreds of frames.
//
// The MRT traps are written up in src/core/postprocessing/CLAUDE.md (Gotchas) and
// DOCS/webgpu-notes.md §§1.4-1.6 for the two failure modes this distinguishes and the
// blending trap that follows fixing them.

import * as THREE from 'three/webgpu';

/** Number of `@location(...)` outputs the fragment entry point declares, or -1. */
const declaredOutputs = (wgsl: string): number => {
	if (typeof wgsl !== 'string') return -1;

	const entry = /@fragment\s*(?:\/\/[^\n]*\n\s*)*fn\s+\w+\s*\([\s\S]*?\)\s*->\s*([\s\S]*?)\{/.exec(
		wgsl
	);
	if (!entry) return -1;

	const returns = entry[1];

	// `-> @location( 0 ) vec4<f32> {` — a single unstructured output.
	if (/@location\s*\(/.test(returns)) return (returns.match(/@location\s*\(/g) ?? []).length;

	// `-> FragmentOutput {` — count the struct members.
	const structName = returns.trim().replace(/[^\w].*$/, '');
	if (!structName) return -1;

	const struct = new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\}`).exec(wgsl);
	if (!struct) return -1;

	return (struct[1].match(/@location\s*\(/g) ?? []).length;
};

/** Wrap `Pipelines.getForRender` on a live renderer. Idempotent per renderer. */
const attach = (renderer: any) => {
	const pipelines = renderer._pipelines;
	if (!pipelines || pipelines.__mrtProbeInstalled) return;
	pipelines.__mrtProbeInstalled = true;

	const original = pipelines.getForRender.bind(pipelines);
	const seen = new Set<string>();
	/** fragment stage id → the attachment counts it has been drawn under. */
	const stageTargets = new Map<number, Set<number>>();

	pipelines.getForRender = (renderObject: any, promises: any = null) => {
		const result = original(renderObject, promises);

		try {
			const state = renderObject.getNodeBuilderState();
			const outputs = declaredOutputs(state.fragmentShader);
			const attachments = renderObject.context?.textures ? renderObject.context.textures.length : 1;

			const material = renderObject.material;
			const object = renderObject.object;
			const label = `${material.name || material.type}#${material.id}`;
			const stage = pipelines.programs.fragment.get(state.fragmentShader);
			const stageId = stage ? stage.id : -1;

			let counts = stageTargets.get(stageId);
			if (counts === undefined) stageTargets.set(stageId, (counts = new Set()));
			const stageWasNarrower = counts.size > 0 && !counts.has(attachments);
			counts.add(attachments);

			const row = `${label}|${outputs}|${attachments}`;
			if (!seen.has(row)) {
				seen.add(row);

				const line =
					`outputs=${outputs} attachments=${attachments}` +
					` stage=${stageId} pipeline=${renderObject.pipeline?.cacheKey}` +
					` mat=${label} (${material.constructor.name})` +
					` obj=${object.name || object.type}#${object.id}` +
					` ctxNode=${renderer.contextNode?.id}`;

				if (outputs >= 0 && outputs !== attachments) {
					const nodeOf = (n: any) => (n ? n.constructor.name : 'null');
					const ancestry: string[] = [];
					for (let o = object; o; o = o.parent) {
						ancestry.push(`${o.name || o.type}#${o.id}`);
					}

					console.log(
						`[MRT PROBE] MISMATCH — ${line}\n` +
							`  material : fragmentNode=${nodeOf(material.fragmentNode)}` +
							` outputNode=${nodeOf(material.outputNode)}` +
							` mrtNode=${nodeOf(material.mrtNode)}\n` +
							`  flags    : transparent=${material.transparent}` +
							` depthTest=${material.depthTest} depthWrite=${material.depthWrite}` +
							` side=${material.side} blending=${material.blending}` +
							` lights=${material.lights} fog=${material.fog}\n` +
							`  geometry : ${object.geometry?.type ?? '?'}` +
							` userData=${JSON.stringify(Object.keys(object.userData ?? {}))}\n` +
							`  ancestry : ${ancestry.join(' < ')}`
					);
				} else {
					console.log(`[MRT PROBE] ${line}`);
				}
			}

			if (stageWasNarrower) {
				console.log(
					`[MRT PROBE] stage ${stageId} now drawn under attachments=${attachments}` +
						` after ${[...counts].join('/')} — mat=${label}`
				);
			}
		} catch (error) {
			console.warn('[MRT PROBE] inspection failed', error);
		}

		return result;
	};

	console.log('[MRT PROBE] installed');
};

/**
 * Arm the probe. Patches `WebGPURenderer.prototype.render` rather than taking a renderer
 * instance, so no engine file has to be edited to run it — `renderer._pipelines` only
 * exists after `init()`, so the wrap defers until the first frame.
 */
export const installMrtProbe = () => {
	const proto = THREE.WebGPURenderer.prototype as any;
	if (proto.__mrtProbePatched) return;
	proto.__mrtProbePatched = true;

	const originalRender = proto.render;

	proto.render = function (this: any, ...args: unknown[]) {
		attach(this);
		return originalRender.apply(this, args);
	};
};
