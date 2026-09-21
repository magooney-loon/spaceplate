// MRT attachment-count probe — the tool that found the motion-blur crash.
//
// Checks the invariant WebGPU enforces: a pipeline's colour-target count must equal
// the attachment count of the pass it's bound in. For every draw, compares the
// `@location(...)` outputs the compiled fragment shader DECLARES against the
// attachments the render context HAS.
//
// MISMATCH lines carry the material's node/flags/ancestry so the offending mesh is
// identifiable without guessing. "stage N now drawn under attachments=…" means one
// fragment ProgrammableStage is being reused under two different attachment counts —
// shader stages are deduplicated by WGSL source, not by attachment count, so identical
// WGSL across two contexts can silently share one GPU pipeline (the MRT shader-cache
// trap; see `core/postprocessing/CLAUDE.md`).
//
// Uses `console.log`, never `console.error`: Chromium attaches a full stack to every
// error and the render loop buries the finding under hundreds of frames.

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
