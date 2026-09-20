// The effect registry — one place that declares what every effect is. The builder
// (build.ts) and the Studio panel both read this; nothing hand-wires a graph and
// no UI hard-codes an effect list. See CLAUDE.md in this directory.

import type { QualityLevel } from '$extensions/settings/types';
import type { EffectDef, EffectValues, MrtRequirement, Requirement } from './types';
import { afterimageEffect } from './effects/afterimage';
import { anamorphicEffect } from './effects/anamorphic';
import { aoEffect } from './effects/ao';
import { bloomEffect } from './effects/bloom';
import { dofEffect } from './effects/dof';
import { fogScatterEffect } from './effects/fogScatter';
import { fxaaEffect } from './effects/fxaa';
import { godraysEffect } from './effects/godrays';
import { lutEffect } from './effects/lut';
import { motionBlurEffect } from './effects/motionblur';
import { rainLensEffect } from './effects/rainLens';
import { retroEffect } from './effects/retro';
import { sceneTransitionEffect } from './effects/sceneTransition';
import { snowLensEffect } from './effects/snowLens';
import { smaaEffect } from './effects/smaa';
import { speedLinesEffect } from './effects/speedLines';
import { ssaaEffect } from './effects/ssaa';
import { vignetteEffect } from './effects/vignette';

/**
 * The registry. Display order for panels: base first, then chain, then grade, then AA.
 *
 * A record rather than an array so the param types survive — `EffectParamMap` below is
 * derived from it, which is what lets the extension's state shape be generated instead
 * of hand-listed. Each key must equal its def's `id`; nothing type-checks that, since
 * `EffectDef.id` is a plain `string`.
 */
export const EFFECT_REGISTRY = {
	ssaa: ssaaEffect,
	retro: retroEffect,
	ao: aoEffect,
	dof: dofEffect,
	fogScatter: fogScatterEffect,
	godrays: godraysEffect,
	motionBlur: motionBlurEffect,
	rainLens: rainLensEffect,
	snowLens: snowLensEffect,
	speedLines: speedLinesEffect,
	bloom: bloomEffect,
	anamorphic: anamorphicEffect,
	afterimage: afterimageEffect,
	vignette: vignetteEffect,
	// Last in the chain: it composites the frozen previous scene over everything the
	// chain produced, and wants the vignette (and the rest) applied to both sides alike.
	sceneTransition: sceneTransitionEffect,
	lut: lutEffect,
	smaa: smaaEffect,
	fxaa: fxaaEffect
} as const;

export type EffectId = keyof typeof EFFECT_REGISTRY;

type ParamsOf<T> = T extends EffectDef<infer P> ? P : never;

/** Every effect's param shape, keyed by id — the extension's state shape is built on this. */
export type EffectParamMap = { [K in EffectId]: ParamsOf<(typeof EFFECT_REGISTRY)[K]> };

export const EFFECTS: EffectDef<any>[] = Object.values(EFFECT_REGISTRY);

export const EFFECTS_BY_ID: ReadonlyMap<string, EffectDef<any>> = new Map(
	EFFECTS.map((def) => [def.id, def])
);

/** The base pass used when no base-role effect is enabled. */
export const DEFAULT_BASE_ID = 'default';

/** Tier ordering for `minQuality`. */
const QUALITY_RANK: Record<QualityLevel, number> = { low: 0, high: 1 };

/** Default param values per effect id — seeds the extension state. */
export const effectDefaults = (): EffectValues => {
	const defaults: EffectValues = {};
	for (const def of EFFECTS) defaults[def.id] = def.params();
	return defaults;
};

export interface EnabledSetResolution {
	/** Effect ids that will actually be built, in `order` (i.e. fold) order. */
	active: string[];
	/** Ids the user enabled but policy removed, with the reason. */
	dropped: { id: string; reason: string }[];
	/** `DEFAULT_BASE_ID` or the winning base effect id. */
	basePassId: string;
	/** MRT attachments the builder must provision (never depth/viewZ — those are free). */
	mrt: MrtRequirement[];
}

/**
 * Pure policy: given the enabled set and quality tier, decide what runs — quality
 * 'low' drops everything; at most one base pass and one AA (lowest `order` wins,
 * losers reported); explicit `conflicts` enforced the same way; geometry consumers
 * dropped under a non-default base pass; the MRT set is the union of the survivors'
 * requirements. Pure on purpose: the panel greys things out with it, the builder
 * builds with it.
 */
export const resolveEnabledSet = (
	enabled: string[],
	quality: QualityLevel,
	values?: EffectValues
): EnabledSetResolution => {
	const dropped: { id: string; reason: string }[] = [];
	const drop = (id: string, reason: string) => dropped.push({ id, reason });

	if (quality === 'low') {
		for (const id of enabled) drop(id, 'quality is low');
		return { active: [], dropped, basePassId: DEFAULT_BASE_ID, mrt: [] };
	}

	const defs: EffectDef<any>[] = [];
	for (const id of enabled) {
		const def = EFFECTS_BY_ID.get(id);
		if (def) {
			defs.push(def);
		} else {
			drop(id, 'unknown effect');
		}
	}

	// Effective requirements — static unless the def computes them from its params.
	const requirementsOf = (def: EffectDef<any>): Requirement[] =>
		def.requiresValues ? def.requiresValues(values?.[def.id] ?? def.params()) : def.requires;

	// Quality gates. Ranked rather than compared by name, so a middle tier can't
	// silently turn a gate into a no-op. Currently unreachable with only low/high, kept
	// for the removed effects that declared minQuality (see "Removed effects" in CLAUDE.md).
	const qualityOk: EffectDef<any>[] = [];
	for (const def of defs) {
		if (def.minQuality && QUALITY_RANK[quality] < QUALITY_RANK[def.minQuality]) {
			drop(def.id, `requires ${def.minQuality} quality (current: ${quality})`);
		} else {
			qualityOk.push(def);
		}
	}

	// Mutual exclusion: base and resolve roles allow only one winner (lowest order);
	// chain effects coexist unless an explicit `conflicts` pair says otherwise. Walked
	// in order and matched only against SURVIVORS, so an effect already dropped can't
	// knock out a third, and equal orders resolve deterministically.
	const survivors: EffectDef<any>[] = [];
	for (const def of qualityOk.slice().sort((a, b) => a.order - b.order)) {
		const exclusive = def.role === 'base' || def.role === 'resolve';
		const winner = survivors.find(
			(other) =>
				(exclusive && other.role === def.role) ||
				Boolean(other.conflicts?.includes(def.id) || def.conflicts?.includes(other.id))
		);
		if (winner) {
			drop(def.id, `mutually exclusive with ${winner.label}`);
		} else {
			survivors.push(def);
		}
	}

	// Geometry consumers under a non-default base pass.
	const baseDef = survivors.find((def) => def.role === 'base');
	const baseIsDefault = !baseDef;
	const eligible: EffectDef<any>[] = [];
	for (const def of survivors) {
		if (!baseIsDefault && def !== baseDef && requirementsOf(def).length > 0) {
			drop(def.id, `${baseDef!.label} base pass feeds no geometry buffers`);
		} else {
			eligible.push(def);
		}
	}

	// MRT union from the survivors (depth/viewZ are PassNode builtins, not attachments).
	const mrtSet = new Set<MrtRequirement>();
	for (const def of eligible) {
		for (const req of requirementsOf(def)) {
			if (req !== 'depth' && req !== 'viewZ') mrtSet.add(req);
		}
	}

	return {
		active: eligible.map((def) => def.id),
		dropped,
		basePassId: baseDef ? baseDef.id : DEFAULT_BASE_ID,
		mrt: [...mrtSet]
	};
};

/** The structural fingerprint of the current configuration — everything a graph
 * rebuild depends on, as one string. Non-structural param drags must not change this. */
export const structuralKeyOf = (enabled: string[], values: EffectValues): string =>
	enabled
		.slice()
		.sort()
		.map((id) => {
			const def = EFFECTS_BY_ID.get(id);
			const structural = def?.structural ?? [];
			const parts: (string | number)[] = structural.map((key) => values[id]?.[key] ?? 0);
			// Runtime key material the values cannot carry (the LUT's texture version).
			const tag = def?.structuralTag?.();
			if (tag !== undefined) parts.push(tag);
			return parts.length > 0 ? `${id}(${parts.join(',')})` : id;
		})
		.join('|');
