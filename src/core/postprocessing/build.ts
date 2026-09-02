// The pipeline builder — DOCS/post-processing.md §3.3. Reads the registry plus the
// enabled set, provisions the MRT attachments, folds the chain, applies the
// resolve stage, and owns every node it creates (disposal on rebuild).
//
// Discipline (§4): every numeric param reaches a node factory as a `uniform()`
// from the bag built here, never a raw number — param drags write `.value`, only
// the structural key rebuilds.

import { pass, mrt, output, velocity, uniform, context, renderOutput } from 'three/tsl';
import type { RenderPipeline, Scene, Camera, WebGPURenderer } from 'three/webgpu';
import type { QualityLevel } from '$extensions/settings/types';
import { EFFECTS_BY_ID, resolveEnabledSet } from './registry';
import { createUniformBag } from './uniforms';
import type { BuildContext, EffectValues, MrtRequirement, UniformBag } from './types';

export interface BuildReport {
	/** False when the graph threw and the fallback pass was installed instead. */
	ok: boolean;
	active: string[];
	dropped: { id: string; reason: string }[];
	basePassId: string;
	mrt: MrtRequirement[];
	error?: unknown;
}

export interface BuildOptions {
	pipeline: RenderPipeline;
	scene: Scene;
	camera: Camera;
	renderer: WebGPURenderer;
	/** Enabled effect ids (raw — policy is applied here). */
	enabled: string[];
	/** Current param values per effect id (only enabled ids are read). */
	values: EffectValues;
	quality: QualityLevel;
}

export interface PipelineBuild {
	report: BuildReport;
	/** Uniform bags per built effect id — the hot-update path. */
	uniforms: Map<string, UniformBag<any>>;
	/** Write the viewport aspect (vignette roundness); called by the frame task. */
	setAspect(aspect: number): void;
	/** Dispose every node this build created. Does not touch the pipeline itself. */
	dispose(): void;
}

/**
 * MRT attachment name → the TSL node that writes it.
 *
 * Only `velocity` survives: it is what motion blur needs, and every other consumer
 * (ao/ssgi/ssr/traa) was removed. The union algorithm below is unchanged and still
 * general — re-adding a normals consumer means one row here
 * (`normal: () => packNormalToRGB(normalView)`), one in MRT_TEXTURE_NAME, one member
 * on `Requirement`, and the unpacked `sample(uv => unpackRGBToNormal(...))` node on
 * BuildContext. See DOCS/post-processing.md §2.2 for the full attachment table.
 */
const MRT_LAYOUT: Record<MrtRequirement, (ctx: any) => any> = {
	velocity: () => velocity
};

const MRT_TEXTURE_NAME: Record<MrtRequirement, string> = {
	velocity: 'velocity'
};

export const buildPipeline = (opts: BuildOptions): PipelineBuild => {
	const { pipeline, scene, camera, renderer, enabled, values, quality } = opts;
	const resolution = resolveEnabledSet(enabled, quality);

	const uniforms = new Map<string, UniformBag<any>>();
	const disposables: { dispose?: () => void }[] = [];
	const track = <T>(node: T): T => {
		disposables.push(node as { dispose?: () => void });
		return node;
	};
	const disposeAll = () => {
		for (const node of disposables) {
			try {
				node.dispose?.();
			} catch {
				/* a broken dispose must not mask the original error */
			}
		}
		disposables.length = 0;
	};

	const aspect = uniform(1);

	const report: BuildReport = {
		ok: true,
		active: resolution.active,
		dropped: resolution.dropped,
		basePassId: resolution.basePassId,
		mrt: resolution.mrt
	};

	// The fallback installs a bare pass — a broken graph must not take the render
	// loop down with it (§3.3 step 6, worth keeping from the old implementation).
	const installFallback = (error: unknown) => {
		disposeAll();
		uniforms.clear();
		pipeline.outputColorTransform = true;
		pipeline.outputNode = track(pass(scene, camera));
		pipeline.needsUpdate = true;
		report.ok = false;
		report.active = [];
		report.error = error;
	};

	try {
		// 1. Base pass — the default `pass()` or the winning base-role effect.
		const baseDef = EFFECTS_BY_ID.get(resolution.basePassId);
		const baseCtx = {
			scene,
			camera,
			renderer,
			pipeline,
			aspect,
			track
		} as unknown as BuildContext;

		const basePass = baseDef
			? (() => {
					const bag = createUniformBag({ ...baseDef.params(), ...values[baseDef.id] });
					const node = track(baseDef.build(baseCtx, bag));
					uniforms.set(baseDef.id, bag);
					return node;
				})()
			: track(pass(scene, camera));

		// 2. MRT provisioning — only what the enabled effects asked for.
		if (resolution.mrt.length > 0) {
			const entries: Record<string, any> = { output };
			for (const req of resolution.mrt) {
				entries[MRT_TEXTURE_NAME[req]] = MRT_LAYOUT[req](baseCtx);
			}
			basePass.setMRT(mrt(entries));
		}

		// 2b. Shader-cache isolation for the MRT pass. THIS IS LOAD-BEARING, not a
		// tuning knob — without it motion blur dies on a WebGPU validation error:
		//
		//   Attachment state of [RenderPipeline "..."] is not compatible with
		//   [RenderPassEncoder]. Expects colorTargets [0, 1], pipeline has [0].
		//
		// NodeMaterial folds the MRT into its output at build time by reading
		// `renderer.getMRT()` (NodeMaterial.js §MRT), but the compiled result is cached
		// in `nodeBuilderCache` under `RenderObject.initialCacheKey` — a key that
		// contains NO MRT information. Anything else that renders this same scene
		// without MRT (Studio's viewport, Sky.svelte's per-frame CubeCamera env bake,
		// any auxiliary target pass) therefore compiles a one-output shader under the
		// same key, and this pass then reuses it against N attachments.
		//
		// `renderer.contextNode.id` IS in that key, and PassNode swaps
		// `renderer.contextNode` for its own for the duration of its render. So handing
		// the pass an empty context gives everything drawn inside it a private
		// cache namespace — same generated code, different key. A fresh context per
		// build also means a changed attachment set recompiles rather than reusing
		// shaders built for the previous count.
		//
		// Ask the PASS whether it has attachments, not `resolution.mrt`: a base-pass
		// effect may provision its own MRT internally (pixelationPass did exactly that
		// before it was removed) and would otherwise slip through unisolated.
		if (basePass.getMRT() !== null) basePass.contextNode = context();

		// 3. Resolve the build context — no effect ever reaches for the pass itself.
		const ctx: BuildContext = {
			...baseCtx,
			basePass,
			color: basePass.getTextureNode('output'),
			depth: basePass.getTextureNode('depth'),
			viewZ: basePass.getViewZNode(),
			velocity: null as any,
			aspect
		};
		if (resolution.mrt.includes('velocity')) ctx.velocity = basePass.getTextureNode('velocity');

		// 4. Fold chain effects in order, threading ctx.color.
		const chain = resolution.active
			.map((id) => EFFECTS_BY_ID.get(id)!)
			.filter((def) => def.role === 'chain')
			.sort((a, b) => a.order - b.order);

		for (const def of chain) {
			const bag = createUniformBag({ ...def.params(), ...values[def.id] });
			const node = track(def.build(ctx, bag));
			if (node !== undefined && node !== null) ctx.color = node;
			uniforms.set(def.id, bag);
		}

		// 5. The output colour transform, owned here rather than by an effect. FXAA and
		// the 3D LUT both need display-referred input (`displayColor`), and if each ran
		// its own renderOutput() a pipeline with both would tone-map twice. So: disable
		// the pipeline's automatic transform once, fold in exactly one renderOutput(),
		// and every later stage sees encoded colour.
		//
		// Tone mapping stays Threlte's — this READS renderer.toneMapping, never writes it.
		const activeDefs = resolution.active.map((id) => EFFECTS_BY_ID.get(id)!);
		const wantsDisplayColor = activeDefs.some((def) => def.displayColor);
		// Reset first — a previous build may have disabled it.
		pipeline.outputColorTransform = !wantsDisplayColor;
		if (wantsDisplayColor) {
			ctx.color = renderOutput(ctx.color, renderer.toneMapping, renderer.outputColorSpace);
		}

		// 6. Grade stage — colour grading after the transform, before AA. Unlike base and
		// resolve, grades are not mutually exclusive, so fold them all in order.
		for (const def of activeDefs
			.filter((def) => def.role === 'grade')
			.sort((a, b) => a.order - b.order)) {
			const bag = createUniformBag({ ...def.params(), ...values[def.id] });
			const node = track(def.build(ctx, bag));
			if (node !== undefined && node !== null) ctx.color = node;
			uniforms.set(def.id, bag);
		}

		// 7. Resolve stage — at most one AA (policy already enforced). Runs last so it
		// anti-aliases the graded image rather than being smeared by the grade.
		const resolveDef = activeDefs.find((def) => def.role === 'resolve');
		if (resolveDef) {
			const bag = createUniformBag({ ...resolveDef.params(), ...values[resolveDef.id] });
			const node = track(resolveDef.build(ctx, bag));
			if (node !== undefined && node !== null) ctx.color = node;
			uniforms.set(resolveDef.id, bag);
		}

		pipeline.outputNode = ctx.color;
		pipeline.needsUpdate = true;
	} catch (error) {
		installFallback(error);
	}

	return {
		report,
		uniforms,
		setAspect: (value: number) => {
			aspect.value = value;
		},
		dispose: disposeAll
	};
};
