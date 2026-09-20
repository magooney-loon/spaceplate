// Speed lines — a radial "tunnel wind" pull: the frame's periphery streaks inward
// toward the centre while the centre itself stays sharp (that's where the eye
// looks), same arcade-racer trick as the vignette's opposite: darkening reads as a
// frame, this reads as speed. A one-sided zoom blur, not a symmetric one — a
// symmetric pull cancels its own streak.
//
// Runtime-modulated like `afterimage.ts` (see postprocessing/CLAUDE.md's "shared-
// uniform driver" contract): `uSpeedLinesBoost` is a module-scope uniform, one
// writer (TestGame's `fx/SpeedLines.svelte`, off carSim.accelFwd), any number of
// readers. Panel `intensity` is the standing floor and defaults to 0 — a pure
// identity resample, same "always in the graph, free at rest" bargain motionBlur
// and anamorphic already make (this is one extra texture per sample, nothing
// latched), so a scene with no driver mounted pays for the loop but shows nothing.

import {
	Fn,
	Loop,
	convertToTexture,
	float,
	length,
	smoothstep,
	uniform,
	uv,
	vec2,
	vec3,
	vec4
} from 'three/tsl';
import type { EffectDef } from '../types';

export type SpeedLinesParams = {
	/** Standing floor, 0…1 — added to the runtime boost, same shape as afterimage's damp. */
	intensity: number;
	/** Loop bound baked into the shader at build time — structural, like motionBlur's. */
	numSamples: number;
	/** Fraction of the half-frame-diagonal that stays clean before the pull ramps in. */
	innerRadius: number;
	/** Pull distance at full mask × intensity, in uv units. */
	reach: number;
};

/** Runtime intensity 0…1, written by a scene driver (TestGame's `fx/SpeedLines.svelte`).
 * Module-scope `uniform()` so identity survives rebuilds; 0 with no driver mounted. */
export const uSpeedLinesBoost = uniform(0);

export const speedLinesEffect: EffectDef<SpeedLinesParams> = {
	id: 'speedLines',
	label: 'Speed Lines',
	role: 'chain',
	order: 38,
	requires: [],
	structural: ['numSamples'],
	params: () => ({ intensity: 0, numSamples: 10, innerRadius: 0.35, reach: 0.09 }),
	defaultEnabled: true,
	ranges: {
		intensity: { min: 0, max: 1, step: 0.01 },
		numSamples: { min: 4, max: 24, step: 1 },
		innerRadius: { min: 0, max: 0.9, step: 0.01 },
		reach: { min: 0, max: 0.3, step: 0.005 }
	},
	note: 'Runtime-driven (TestGame acceleration) adds onto the panel intensity floor, same contract as afterimage — 0 here is a pure identity resample. The periphery pulls toward the centre; the middle of the frame stays clean.',
	build: (ctx, u) => {
		// Chain colour may be a computed node (from a prior fold) — needs a real texture
		// to sample at shifted uvs, same trap and fix as motionBlur.ts.
		const input = convertToTexture(ctx.color);
		if (input !== (ctx.color as unknown)) {
			ctx.track({ dispose: () => (input as any).renderTarget.dispose() });
		}
		const amount = u.intensity.add(uSpeedLinesBoost).clamp(0, 1);
		// Loop bound must be a JS number at build time (structural) — same rule as
		// godrays.ts/anamorphic.ts. **Kept out of the Fn's own argument list on
		// purpose**: Fn() auto-converts every argument it's called with into a node,
		// so a plain number passed through there stops being usable by JS arithmetic
		// inside the body (`Math.max(node - 1, 1)` silently coerces to NaN, which
		// WGSL then emits as a bare `NaN.0` literal — a real bug this hit once).
		// Closing over it from the surrounding scope instead, the way anamorphic.ts's
		// `highPassFn` closes over its own `sampleCount`/`half`, keeps it a number.
		const sampleCount = u.numSamples.value;
		const denom = Math.max(sampleCount - 1, 1);

		const speedLinesFn = Fn((): any => {
			const centered = uv().sub(0.5).mul(vec2(ctx.aspect, 1));
			const dist = length(centered);
			// 0 through the middle of the frame, ramping to 1 past innerRadius — the pull
			// is an EDGE effect, never over what the driver is actually looking at.
			const mask = smoothstep(u.innerRadius, float(1.0), dist).mul(amount);
			// (uv - 0.5) already carries distance-from-centre as its own magnitude, so the
			// pull grows with both the mask AND raw radius — no separate falloff curve needed.
			const pull = uv().sub(0.5).mul(mask).mul(u.reach);

			const color = vec3(0).toVar();
			Loop(sampleCount, ({ i }: any) => {
				// t=0 keeps the true pixel (the sample's own colour is never fully lost),
				// t=1 is the full pull toward the centre — the streak is the average of
				// the walk between them.
				const t = float(i).div(float(denom));
				color.addAssign(input.sample(uv().sub(pull.mul(t))).rgb);
			});

			const centerAlpha = input.sample(uv()).a;
			return vec4(color.div(float(sampleCount)), centerAlpha);
		});

		return speedLinesFn();
	}
};
