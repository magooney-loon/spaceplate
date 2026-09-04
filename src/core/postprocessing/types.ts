// Post-processing effect registry types — the single source of truth for what an
// effect IS (role, requirements, conflicts, params). Consumed by the builder
// (build.ts) and the Studio panel; neither hand-wires anything. Details in
// ./CLAUDE.md.

import type { Camera, Scene, WebGPURenderer, RenderPipeline } from 'three/webgpu';
// Deep type-only import: UniformNode is a default export of its module and is not
// re-exported by 'three/tsl' or 'three/webgpu'. Never imported at runtime.
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import type { QualityLevel } from '$extensions/settings/types';

/**
 * `grade` sits between the chain and the resolve stage and is deliberately NOT
 * mutually exclusive the way `base`/`resolve` are: colour grading and anti-aliasing
 * are orthogonal. See `displayColor` for who owns the output colour transform.
 */
export type PassRole = 'base' | 'chain' | 'grade' | 'resolve';

/**
 * Buffers an effect needs from the scene pass. `depth` and `viewZ` come free with
 * every PassNode; the rest are provisioned as MRT attachments by the builder (union
 * of all enabled effects' requirements). `emissive` feeds bloom's material mode
 * (selective emissive bloom), `normal` feeds AO. Removed members (`metalrough`,
 * `diffuse`) re-add additively — the union machinery is untouched (build.ts
 * MRT_LAYOUT).
 */
export type Requirement = 'depth' | 'viewZ' | 'velocity' | 'emissive' | 'normal';

/** MRT-attachable requirements — `depth`/`viewZ` are PassNode builtins, never attachments. */
export type MrtRequirement = Exclude<Requirement, 'depth' | 'viewZ'>;

export type EffectParams = Record<string, number>;

/** Per-effect bag of `uniform()` nodes owned by the pipeline — the only hot-update path. */
export type UniformBag<P extends EffectParams = EffectParams> = {
	[K in keyof P]: UniformNode<'float', number>;
};

export type ParamRange = { min: number; max: number; step: number };

/** Values per effect id, keyed as the builder and Renderer pass them around. */
export type EffectValues = Record<string, EffectParams>;

export interface BuildContext {
	scene: Scene;
	camera: Camera;
	renderer: WebGPURenderer;
	pipeline: RenderPipeline;
	/** The active scene pass — `pass()` or a base-role effect (ssaa/retro). */
	basePass: any;
	/** The running chain value (vec4) — reassigned as chain effects fold in. */
	color: any;
	/** Depth texture node — free on every PassNode. */
	depth: any;
	/** viewZ node (`basePass.getViewZNode()`) — free, no MRT attachment. */
	viewZ: any;
	/** Velocity texture node — only set when some effect requires `velocity`. */
	velocity: any;
	/** Emissive texture node — only set when some effect requires `emissive`. */
	emissive: any;
	/** View-space normal texture node — only set when some effect requires `normal`. */
	normal: any;
	/** Viewport aspect (w/h), owned by the builder, written by the frame task. */
	aspect: UniformNode<'float', number>;
	/**
	 * Velocity → shutter scale. Owned by the builder, written by the frame task.
	 *
	 * **Any effect that multiplies `ctx.velocity` must multiply by this too.** three's
	 * `velocity` MRT is a raw PER-FRAME NDC delta with no notion of time (`VelocityNode`
	 * subtracts two clip positions and stops), so a smear derived from it scales with the
	 * frame's delta: the same camera move blurs ~5× wider at 30fps than at 144. That stays
	 * invisible until an offline capture take runs the engine clock at a fixed `1/fps` step
	 * and every frame comes out blurrier than the viewport ever looked
	 * (`extensions/capture/CLAUDE.md`).
	 *
	 * Multiplying by this makes the smear a function of SCENE-TIME motion instead — the
	 * same rule the engine clock already imposes on every task's `delta`. A param tuned
	 * once holds at every frame rate, offline takes included.
	 */
	shutterScale: UniformNode<'float', number>;
	/**
	 * Register an intermediate node created inside `build` for disposal. The
	 * builder only tracks the node an effect RETURNS — anything else owning render
	 * targets (BloomNode, LensflareNode, ...) must go through here or it leaks on
	 * rebuild, since Node.dispose() does not cascade to children.
	 */
	track: <T>(node: T) => T;
}

/**
 * One effect definition. Node-graph plumbing is deliberately `any`-typed — the
 * addon `.d.ts`s are looser than their runtime behaviour ("Rebuild discipline" in
 * CLAUDE.md).
 */
export interface EffectDef<P extends EffectParams = EffectParams> {
	id: string;
	label: string;
	role: PassRole;
	/** Sort key within the role. Chain folds low→high; base/resolve pick lowest on conflict. */
	order: number;
	/** Buffers this effect needs — drives MRT provisioning and base-pass eligibility. */
	requires: Requirement[];
	/**
	 * Same as `requires`, but computed from the effect's current param values — for
	 * effects whose needs are mode-dependent (bloom only needs `emissive` in material
	 * mode). Takes precedence over the static array when present; `values` is the
	 * effect's own param record (registry fills in `params()` defaults if absent).
	 */
	requiresValues?: (values: EffectParams) => Requirement[];
	/** Ids that cannot be co-enabled (in addition to the role rules). */
	conflicts?: string[];
	/** Effect is only offered at this quality tier or above. */
	minQuality?: QualityLevel;
	/**
	 * Base role only: this base pass produces usable MRT outputs. When false (or when
	 * the base is not the default `pass()`), geometry consumers are dropped with a
	 * warning — verified combinations only.
	 */
	supportsMRT?: boolean;
	/**
	 * This effect consumes DISPLAY-referred colour — tone-mapped and encoded to the
	 * output colour space — rather than the linear working values the chain carries.
	 * True for FXAA (luma edge detection is defined on sRGB) and for 3D LUTs (`.cube`
	 * files are authored against a display image).
	 *
	 * The builder, not the effect, acts on this: if ANY active effect asks for it,
	 * the pipeline's automatic output transform is switched off and a single
	 * `renderOutput()` folded in — two callers would tone-map twice.
	 */
	displayColor?: boolean;
	/** Default parameter values — also seeds the extension state and the panel. */
	params: () => P;
	/** Whether the effect starts enabled — seeds the extension state's `enabled` flag. */
	defaultEnabled?: boolean;
	/**
	 * Param keys that are baked into the compiled graph (loop counts, texture sizes)
	 * and therefore need a rebuild rather than a uniform write. Everything else is
	 * hot through the uniform bag.
	 */
	structural?: (keyof P & string)[];
	/** UI ranges per param key. */
	ranges?: Partial<Record<keyof P & string, ParamRange>>;
	/** Params that are a choice, not a magnitude — the panel renders a list, not a slider. */
	options?: Partial<Record<keyof P & string, { value: number; text: string }[]>>;
	/**
	 * Sibling params to re-seed when a choice param changes — for modes whose sensible
	 * values are nothing like the other mode's (bloom's material mode blooms emissive
	 * values, not scene luminance, so it wants a far higher strength than global).
	 * Returns a patch applied on top of the change; `undefined` leaves params alone.
	 */
	paramDefaults?: (key: keyof P & string, value: number) => Partial<P> | undefined;
	/**
	 * Extra structural key material an effect can only know at runtime — appended to
	 * `structuralKeyOf`. Read reactive state here to force a rebuild when a resource
	 * the graph is built AROUND changes (not a uniform it merely reads): the LUT
	 * returns its loaded texture's version, so an async load landing or a different
	 * pick recompiles the graph.
	 */
	structuralTag?: () => string | number;
	/** Shown in the panel under the effect's controls. */
	note?: string;
	/**
	 * Base role: returns the scene pass itself (ctx.color etc. are not set yet).
	 * Chain/resolve: returns the new ctx.color.
	 */
	build: (ctx: BuildContext, u: UniformBag<P>) => any;
}
