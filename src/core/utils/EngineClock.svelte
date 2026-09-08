<script lang="ts">
	// Installs the engine clock (all reasoning in core/utils/engineClock.ts — read its
	// header) and the frame-rate cap. Renders nothing and REGISTERS NO TASK: the clock
	// wraps `scheduler.run` and the cap wraps the animation-loop callback, both upstream
	// of every stage and task, so neither needs ordering and neither disturbs the
	// render-task order the capture grab depends on (DOCS/webgpu-notes.md §2). Mounts
	// first, before anything that integrates a delta. Not dev-only — with no source
	// installed the clock is a pass-through (only `extensions/capture/` ever installs
	// one), and with no cap selected the gate installs nothing.

	import { useThrelte } from '@threlte/core/webgpu';
	import { settingsState } from '$extensions/settings';
	import { engineClock, installEngineClock } from './engineClock';

	const { scheduler, renderer, invalidate } = useThrelte();

	$effect(() => installEngineClock(scheduler, renderer, invalidate));

	// ── The frame-rate cap (Settings ▸ General ▸ maxFps; 0 = VSync, the default) ──
	//
	// Caps the engine loop below the monitor's refresh rate by re-wrapping the ONE
	// callback three's animation loop calls every vsync (Threlte's `scheduler.run` +
	// flag-clear closure), so a throttled tick never reaches the scheduler at all.
	//
	// WHY THAT LEVEL, AND NOT scheduler.run. Skipping `scheduler.run` from inside
	// (the clock's trick) or vetoing `shouldRender()` would leave Threlte's loop
	// closure clearing `frameInvalidated` on the skipped tick — an invalidation that
	// landed in the skipped window would be swallowed without a render, and a one-shot
	// invalidator (a settings drag, a toggle) could drop its frame entirely. Gating
	// upstream, the closure does not run: pending invalidations simply wait for the
	// next accepted tick. Costs and benefits follow the whole loop, not just the
	// render: stages, tasks, Rapier's synchronization and the render all run at ≤ cap.
	//
	// WHAT STILL RUNS AT REFRESH RATE: three's `Animation.update` itself — rAF still
	// wakes us every vsync, `nodeFrame.update()` still advances TSL `time` on the wall
	// clock, and `info.reset()` still clears the stats. The wake is one early-returned
	// JS call; the clock behaviour is exactly what a cap should want (scene time
	// follows the wall clock; accepted ticks see real, larger deltas — every
	// integrator is delta-driven and clamp-protected, physics catches up in fixed
	// substeps).
	//
	// QUANTISATION, INHERENT: rAF only ticks on vsyncs, so the effective cap snaps
	// DOWN to a whole number of refresh intervals — a 60 cap on a 144 Hz display lands
	// at every 3rd vsync (~48). rAF timestamps are ALSO quantized (commonly to 1 ms —
	// on a 60 Hz panel deltas arrive as alternating 16/17 instead of 16.67), which a
	// strict `delta < interval` gate turns into dropped frames (measured: 60 → ~40,
	// 30 → ~20). Hence the 1 ms TOLERANCE and the DRIFT-FREE deadline below: an
	// early-accepted frame pulls the next deadline sooner, never later, so
	// quantization cannot compound; a stall (hidden tab) resyncs via the same max()
	// instead of bursting.
	//
	// Capture (dev-only) takes the clock over while `engineClock.fixed` — the gate
	// bypasses for the duration, so an offline take paces itself.
	$effect(() => {
		const cap = settingsState.graphics.maxFps;
		if (cap <= 0) return;

		// Threlte's own loop closure — the public getter returns exactly what
		// Threlte handed setAnimationLoop, un-wrapped.
		const threlteLoop = renderer.getAnimationLoop();
		if (!threlteLoop) return;

		const minInterval = 1000 / cap;
		const TOLERANCE_MS = 1;
		/** Next accepted-frame deadline (see the quantisation note above). */
		let nextAllowed = -Infinity;

		void renderer.setAnimationLoop(((time: number) => {
			if (engineClock.fixed) {
				// A fixed-step take owns the clock — pace is the take's business.
				// Resync so normal pacing resumes the tick after it ends.
				nextAllowed = time;
				threlteLoop(time);
				return;
			}
			if (time + TOLERANCE_MS < nextAllowed) return;
			nextAllowed = Math.max(nextAllowed, time) + minInterval;
			threlteLoop(time);
		}) as typeof threlteLoop);

		return () => {
			// Restore the true closure (not a re-implementation), so unmount and
			// a later Canvas teardown both see Threlte's own loop again.
			void renderer.setAnimationLoop(threlteLoop);
		};
	});
</script>
