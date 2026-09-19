// The pipeline builder: resolves the base pass, provisions MRT attachments, folds the
// chain, applies the resolve stage, and owns every node it creates (disposal on
// rebuild). Every numeric param reaches a node factory as a `uniform()` from the bag,
// never a raw number — see ./CLAUDE.md ("Rebuild discipline").

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
import type {
	BuildContext,
	EffectDef,
	EffectValues,
	MrtRequirement,
	PassRole,
	UniformBag
} from './types';

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
	/** Write the frame's scene delta in seconds; called by the frame task — turns
	 * per-frame velocity into shutter-normalised velocity, see `BuildContext.shutterScale`. */
	setShutterScale(deltaSeconds: number): void;
	/** Dispose every node this build created. Does not touch the pipeline itself. */
	dispose(): void;
}

/**
 * The MRT attachments, one row each. The record key IS the texture name the pass
 * exposes, so `basePass.getTextureNode(req)` needs no second lookup table. `velocity`
 * feeds motion blur; `emissive` feeds bloom's material mode; `normal` is view-space for
 * GTAONode. Nodes are thunks so each build gets its own.
 */
const MRT_ATTACHMENTS: Record<
	MrtRequirement,
	{ node: () => any; finalize?: (basePass: any, mrtNode: any) => void }
> = {
	velocity: { node: () => velocity },
	normal: { node: () => normalView },
	emissive: {
		node: () => vec4(emissive, output.a),
		finalize: (basePass, mrtNode) => {
			mrtNode.setBlendMode('emissive', new BlendMode(NormalBlending));
			basePass.getTexture('emissive').type = UnsignedByteType;
		}
	}
};

/** The frame time velocity-consuming params are tuned against — 1/60s, so
 * `motionBlur.blurAmount` keeps its usual meaning at 60Hz. */
const REFERENCE_FRAME_SECONDS = 1 / 60;

/** Ceiling on the shutter scale (480 fps), so one pathological delta (a resumed tab, a
 * clock handover) can't turn a frame of sampling noise into a full-screen streak. */
const MAX_SHUTTER_SCALE = 8;

/**
 * Private shader-cache namespaces the MRT base pass renders under, one per attachment
 * set, reused for the module's lifetime — a fresh `context()` per build recompiles the
 * whole scene (the MRT shader-cache trap, ./CLAUDE.md). Never disposed — bounded by
 * distinct attachment sets (<= 8 today).
 */
const passContexts = new Map<string, any>();

const isolationContext = (mrtNode: any): any => {
	const key = Object.keys(mrtNode.outputNodes).sort().join(',');
	let node = passContexts.get(key);
	if (node === undefined) {
		node = context();
		passContexts.set(key, node);
	}
	return node;
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
				// A broken dispose must not mask the original error.
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

	// A broken graph must not take the render loop down with it.
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
			for (const req of resolution.mrt) entries[req] = MRT_ATTACHMENTS[req].node();
			const mrtNode = mrt(entries);
			basePass.setMRT(mrtNode);
			for (const req of resolution.mrt) MRT_ATTACHMENTS[req].finalize?.(basePass, mrtNode);
		}

		// 2b. Shader-cache isolation for the MRT pass — load-bearing, not a tuning knob
		// (see ./CLAUDE.md). Ask the pass, not `resolution.mrt`: a base-pass effect may
		// provision its own MRT internally and slip through unisolated.
		const passMrt = basePass.getMRT();
		if (passMrt !== null) basePass.contextNode = isolationContext(passMrt);

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
		for (const req of resolution.mrt) ctx[req] = basePass.getTextureNode(req);

		/** Build one effect and thread its result into the chain. Every role but `base`
		 * goes through here — a base pass produces the pass rather than consuming a
		 * colour, so it's built above, before `ctx` exists. */
		const foldEffect = (def: EffectDef<any>) => {
			const bag = createUniformBag({ ...def.params(), ...values[def.id] });
			const node = track(def.build(ctx, bag));
			if (node !== undefined && node !== null) ctx.color = node;
			uniforms.set(def.id, bag);
		};

		const activeDefs = resolution.active.map((id) => EFFECTS_BY_ID.get(id)!);
		const byRole = (role: PassRole) =>
			activeDefs.filter((def) => def.role === role).sort((a, b) => a.order - b.order);

		// 4. Fold chain effects in order, threading ctx.color.
		for (const def of byRole('chain')) foldEffect(def);

		// 5. Output colour transform: if any active effect declares `displayColor`,
		// disable the pipeline's automatic transform and fold in exactly one
		// `renderOutput()` — two callers would tone-map twice.
		const wantsDisplayColor = activeDefs.some((def) => def.displayColor);
		pipeline.outputColorTransform = !wantsDisplayColor;
		if (wantsDisplayColor) {
			ctx.color = renderOutput(ctx.color, renderer.toneMapping, renderer.outputColorSpace);
		}

		// 6. Grade stage — not mutually exclusive with resolve, so fold them all in order.
		for (const def of byRole('grade')) foldEffect(def);

		// 7. Resolve stage — at most one AA; runs last so it anti-aliases the graded image.
		for (const def of byRole('resolve')) foldEffect(def);

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
			// A delta of 0 is legal (a held frame, or a capture take's head frame) — 1
			// keeps the scale out of the way rather than dividing by zero.
			shutterScale.value =
				deltaSeconds > 0 ? Math.min(REFERENCE_FRAME_SECONDS / deltaSeconds, MAX_SHUTTER_SCALE) : 1;
		},
		dispose: disposeAll
	};
};
