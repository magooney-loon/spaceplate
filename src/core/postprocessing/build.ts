// The pipeline builder: resolves the base pass, provisions the MRT attachments,
// folds the chain, applies the resolve stage, and owns every node it creates
// (disposal on rebuild). Discipline — every numeric param reaches a node factory
// as a `uniform()` from the bag, never a raw number — in ./CLAUDE.md ("Rebuild
// discipline").

import {
	pass,
	mrt,
	output,
	velocity,
	emissive,
	normalView,
	vec4,
	uniform,
	context,
	renderOutput
} from 'three/tsl';
import { BlendMode, NormalBlending, UnsignedByteType } from 'three/webgpu';
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
	/**
	 * Write the frame's SCENE delta in seconds (`engineClock.delta`); called by the frame
	 * task. Turns per-frame velocity into shutter-normalised velocity — see
	 * `BuildContext.shutterScale`.
	 */
	setShutterScale(deltaSeconds: number): void;
	/** Dispose every node this build created. Does not touch the pipeline itself. */
	dispose(): void;
}

/**
 * MRT attachment name → the TSL node that writes it. `velocity` feeds motion blur;
 * `emissive` feeds bloom's material mode — packed as `vec4(emissive, output.a)` and
 * blended like the output attachment (NormalBlending), mirroring
 * webgpu_postprocessing_bloom_emissive. `normal` is view-space, the layout GTAONode's
 * own docs specify (`mrt({ output, normal: normalView })`). Re-adding a member is one
 * row here, one in MRT_TEXTURE_NAME, one on `Requirement` (see "Removed effects" in
 * CLAUDE.md).
 */
const MRT_LAYOUT: Record<MrtRequirement, (ctx: any) => any> = {
	velocity: () => velocity,
	emissive: () => vec4(emissive, output.a),
	normal: () => normalView
};

const MRT_TEXTURE_NAME: Record<MrtRequirement, string> = {
	velocity: 'velocity',
	emissive: 'emissive',
	normal: 'normal'
};

/**
 * The frame time velocity-consuming params are tuned AGAINST: `shutterScale` is exactly 1
 * here, so `motionBlur.blurAmount = 0.25` still means what it has always meant on a 60Hz
 * display and only departs from it where the frame time does. See
 * `BuildContext.shutterScale` for why the normalisation exists at all.
 */
const REFERENCE_FRAME_SECONDS = 1 / 60;

/**
 * Ceiling on the scale (480 fps). The product `velocity × shutterScale` is self-limiting —
 * a shorter frame moves proportionally less — so this is not needed for the smear width;
 * it is there so one pathological delta (a resumed tab, a clock handover) cannot turn a
 * frame of sampling noise into a full-screen streak.
 */
const MAX_SHUTTER_SCALE = 8;

/** Per-attachment fixups the union can't express — run after setMRT. */
const MRT_FINALIZE: Record<MrtRequirement, (basePass: any, mrtNode: any) => void> = {
	velocity: () => {},
	// Normals stay at the pass's default float format and default (no) blending: a
	// blended normal is a meaningless direction, and transparent geometry writing
	// garbage into it is the known cost of MRT-on-the-main-pass (CLAUDE.md, "Removed
	// effects" — the prePass question this re-opens).
	normal: () => {},
	// UnsignedByte emissive saves bandwidth (example does the same); NormalBlending so
	// transparent surfaces write emissive like they write color (default is no blend).
	emissive: (basePass, mrtNode) => {
		mrtNode.setBlendMode('emissive', new BlendMode(NormalBlending));
		basePass.getTexture('emissive').type = UnsignedByteType;
	}
};

export const buildPipeline = (opts: BuildOptions): PipelineBuild => {
	const { pipeline, scene, camera, renderer, enabled, values, quality } = opts;
	const resolution = resolveEnabledSet(enabled, quality, values);

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
	const shutterScale = uniform(1);

	const report: BuildReport = {
		ok: true,
		active: resolution.active,
		dropped: resolution.dropped,
		basePassId: resolution.basePassId,
		mrt: resolution.mrt
	};

	// The fallback installs a bare pass — a broken graph must not take the render
	// loop down with it.
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
			shutterScale,
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
			const mrtNode = mrt(entries);
			basePass.setMRT(mrtNode);
			for (const req of resolution.mrt) {
				MRT_FINALIZE[req](basePass, mrtNode);
			}
		}

		// 2b. Shader-cache isolation for the MRT pass — LOAD-BEARING, not a tuning
		// knob (full trap in ./CLAUDE.md). Compiled shaders are cached under
		// `RenderObject.initialCacheKey`, which carries NO MRT information, so any
		// other render of this scene without MRT (Studio's viewport, Sky.svelte's
		// CubeCamera env bake) compiles a one-output shader under the same key —
		// this pass then reuses it against N attachments and motion blur dies on a
		// WebGPU validation error.
		//
		// `renderer.contextNode.id` IS in the key, and PassNode swaps in its own
		// contextNode for the duration of its render — so an empty `context()` here
		// gives the pass a private cache namespace: same generated code, different
		// key. Fresh per build, so a changed attachment set recompiles too. Ask the
		// PASS, not `resolution.mrt`: a base-pass effect may provision its own MRT
		// internally and slip through unisolated.
		if (basePass.getMRT() !== null) basePass.contextNode = context();

		// 3. Resolve the build context — no effect ever reaches for the pass itself.
		const ctx: BuildContext = {
			...baseCtx,
			basePass,
			color: basePass.getTextureNode('output'),
			depth: basePass.getTextureNode('depth'),
			viewZ: basePass.getViewZNode(),
			velocity: null as any,
			emissive: null as any,
			normal: null as any,
			aspect,
			shutterScale
		};
		if (resolution.mrt.includes('velocity')) ctx.velocity = basePass.getTextureNode('velocity');
		if (resolution.mrt.includes('emissive')) ctx.emissive = basePass.getTextureNode('emissive');
		if (resolution.mrt.includes('normal')) ctx.normal = basePass.getTextureNode('normal');

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

		// 5. The output colour transform, owned here rather than by an effect: if any
		// active effect declares `displayColor`, disable the pipeline's automatic
		// transform once and fold in exactly one renderOutput() — two callers would
		// tone-map twice. Tone mapping stays Threlte's: this READS
		// renderer.toneMapping, never writes it.
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
		setShutterScale: (deltaSeconds: number) => {
			// A delta of 0 is legal — a held frame, or the head frame of a capture take. Nothing
			// moved, so velocity is zero and the scale is irrelevant; 1 keeps it out of the way
			// rather than dividing by zero.
			shutterScale.value =
				deltaSeconds > 0 ? Math.min(REFERENCE_FRAME_SECONDS / deltaSeconds, MAX_SHUTTER_SCALE) : 1;
		},
		dispose: disposeAll
	};
};
