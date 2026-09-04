// The effect registry — one place that declares what every effect is. The builder
// (build.ts) and the Studio panel both read this; nothing hand-wires a graph and
// no UI hard-codes an effect list. See CLAUDE.md in this directory.

import type { QualityLevel } from '$extensions/settings/types';
import type { EffectDef, EffectValues, MrtRequirement, Requirement } from './types';
import { afterimageEffect } from './effects/afterimage';
import { aoEffect } from './effects/ao';
import { bloomEffect } from './effects/bloom';
import { dofEffect } from './effects/dof';
import { fxaaEffect } from './effects/fxaa';
import { lutEffect } from './effects/lut';
import { motionBlurEffect } from './effects/motionblur';
import { retroEffect } from './effects/retro';
import { smaaEffect } from './effects/smaa';
import { ssaaEffect } from './effects/ssaa';
import { vignetteEffect } from './effects/vignette';

/** Display order for panels: base alternates first, then chain, then grade, then AA. */
export const EFFECTS: EffectDef<any>[] = [
	ssaaEffect,
	retroEffect,
	aoEffect,
	dofEffect,
	motionBlurEffect,
	bloomEffect,
	afterimageEffect,
	vignetteEffect,
	lutEffect,
	smaaEffect,
	fxaaEffect
];

export const EFFECTS_BY_ID: ReadonlyMap<string, EffectDef<any>> = new Map(
	EFFECTS.map((def) => [def.id, def])
);

/** The base pass used when no base-role effect is enabled. */
export const DEFAULT_BASE_ID = 'default';

/** Default param values per effect id — seeds the extension state. */
export const effectDefaults = (): EffectValues => {
	const defaults: EffectValues = {};
	for (const def of EFFECTS) defaults[def.id] = def.params();
	return defaults;
};

export interface EnabledSetResolution {
	/** Effect ids that will actually be built, in registry order. */
	active: string[];
	/** Ids the user enabled but policy removed, with the reason. */
	dropped: { id: string; reason: string }[];
	/** `DEFAULT_BASE_ID` or the winning base effect id. */
	basePassId: string;
	/** MRT attachments the builder must provision (never depth/viewZ — those are free). */
	mrt: MrtRequirement[];
}

/**
 * Pure policy: given the enabled set and the quality tier, decide what runs —
 * quality 'low' drops everything; at most one base pass and one AA (lowest `order`
 * wins, losers reported); explicit `conflicts` enforced the same way; geometry
 * consumers dropped under a non-default base pass; the MRT set is the union of the
 * survivors' requirements (`requiresValues` overrides `requires` when needs are
 * param-dependent).
 *
 * Pure on purpose: the panel greys things out with it, the builder builds with it.
 * `values` is optional so callers without params still get the static answer.
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

	// Quality gates.
	const qualityOk: EffectDef<any>[] = [];
	for (const def of defs) {
		if (def.minQuality === 'high' && quality !== 'high') {
			drop(def.id, `requires high quality (current: ${quality})`);
		} else {
			qualityOk.push(def);
		}
	}

	// Mutual exclusion: base passes replace the scene pass and the AAs replace each
	// other, so within those roles only one can win (lowest order). Chain effects
	// coexist — only explicit `conflicts` cross-role pairs are exclusive.
	const survivors: EffectDef<any>[] = [];
	for (const def of qualityOk) {
		const exclusive = def.role === 'base' || def.role === 'resolve';
		const rivals = qualityOk.filter((other) => {
			if (other === def) return false;
			if (exclusive && other.role === def.role) return true;
			return Boolean(other.conflicts?.includes(def.id) || def.conflicts?.includes(other.id));
		});
		const loser = rivals.some((other) => other.order < def.order);
		if (loser) {
			const winner = rivals.find((other) => other.order < def.order)!;
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

/**
 * The structural fingerprint of the current configuration — everything a graph
 * rebuild depends on, as one string. Param drags that are NOT structural must not
 * change this; structural params (loop counts, texture sizes) must.
 */
export const structuralKeyOf = (enabled: string[], values: EffectValues): string =>
	enabled
		.slice()
		.sort()
		.map((id) => {
			const def = EFFECTS_BY_ID.get(id);
			const structural = def?.structural ?? [];
			const parts = structural.map((key) => values[id]?.[key] ?? 0);
			// Runtime key material the values cannot carry (the LUT's texture version).
			const tag = def?.structuralTag?.();
			if (tag !== undefined) parts.push(tag as never);
			return parts.length > 0 ? `${id}(${parts.join(',')})` : id;
		})
		.join('|');
