<script lang="ts">
	// The one writer of `wetSurface.svelte.ts`. Renders nothing: reads the weather,
	// integrates the water film and the pooling, and writes the three uniforms every
	// material patched with `applyWetness()` reads.
	//
	// MOUNTED OUTSIDE THE SKY GROUP, unlike `LensDriver` next to it, and the difference
	// is not an oversight. The lens is the camera's own glass, which is part of the sky
	// renderer's look and rightly disappears with it when an HDR or cube environment
	// takes over. Ground water is a property of the WORLD: the scene's materials are
	// patched at construction and go on being rendered whatever is in the sky, so a
	// driver inside the group would stop feeding them mid-scene and — worse — would have
	// to hard-reset on teardown, dropping the whole floor's albedo in a single frame.
	// Weather audio lives outside the layers for exactly this reason (`../../CLAUDE.md`).
	//
	// THE TIME CONSTANTS ARE THE WHOLE DESIGN. Wetting and drying are not the same
	// process and must not share a rate; neither are wetting and POOLING. A surface is
	// visibly wet within seconds of rain starting and stays damp for minutes; a puddle
	// takes a sustained downpour to form and outlasts the rain by longer still. Getting
	// that ordering right is most of what makes weather feel like it has a memory
	// instead of tracking the channel.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { clamp01, descriptor, rainAmount } from '../../model';
	import { uPuddles, uRippleTime, uWetness } from './wetSurface.svelte';

	interface Props {
		/** Seconds for the film to bead up, and to dry off. */
		wetSeconds?: number;
		drySeconds?: number;
		/** Seconds for standing water to gather, and to drain away. */
		poolSeconds?: number;
		drainSeconds?: number;
		/**
		 * Ceiling on the film. Below 1 because `applyWetness`'s own `darken` is what a
		 * FULLY wet surface looks like, and continuous rain outdoors is not the wettest a
		 * surface can be — this leaves the top of the range for a game to ask for more.
		 */
		maxWetness?: number;
		/**
		 * Rain amount at which pooling begins at all. A drizzle wets a road; it does not
		 * puddle it, and without a floor here every passing shower leaves standing water.
		 */
		poolThreshold?: number;
	}

	let {
		wetSeconds = 4,
		drySeconds = 45,
		poolSeconds = 30,
		drainSeconds = 120,
		maxWetness = 0.9,
		poolThreshold = 0.35
	}: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	// Plain variables, written and read only by the task — a per-frame value is never
	// reactive state (the descriptor contract, `../../CLAUDE.md`).
	let wetness = 0;
	let puddles = 0;
	let ripple = 0;

	/** Ripple phase rate at full rain, rad/s. */
	const RIPPLE_RATE = 2.6;

	useTask(
		(delta) => {
			const rain = rainAmount(descriptor.weather);

			// A presence curve, as Rain and LensDriver use: whether it is raining is a
			// threshold question, and how hard is what the pooling term below expresses.
			const wetTarget = Math.min(1, rain * 3) * maxWetness;
			// Asymmetric one-pole smoothing in the `exp` form, so the time constants mean
			// the same thing at 30 fps as at 144 — the rule every integrator in the engine
			// follows.
			const wetTau = wetTarget > wetness ? wetSeconds : drySeconds;
			wetness += (wetTarget - wetness) * (1 - Math.exp(-delta / wetTau));
			uWetness.value = wetness;

			// Pooling needs real rain, and it is proportional above the threshold rather
			// than a switch: the remapping keeps the full 0..1 range available above
			// `poolThreshold` instead of compressing it into whatever is left.
			const poolTarget = clamp01((rain - poolThreshold) / Math.max(1e-3, 1 - poolThreshold));
			const poolTau = poolTarget > puddles ? poolSeconds : drainSeconds;
			puddles += (poolTarget - puddles) * (1 - Math.exp(-delta / poolTau));
			uPuddles.value = puddles;

			// Accumulated, never `elapsed × rate` — see the uniform. The rate rides the
			// live rain so ripples quicken in a downpour and settle as it eases.
			ripple += delta * RIPPLE_RATE * Math.max(0.15, rain);
			uRippleTime.value = ripple;

			// Materials are only animated while there is standing water to ripple; the film
			// and the pooling themselves move slowly enough that the descriptor driver's own
			// invalidation covers them. Gated, because `renderMode` is 'on-demand' and an
			// ungated invalidate here would force a full-rate loop forever.
			if (puddles > 0.01) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);
</script>
