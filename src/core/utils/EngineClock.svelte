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

	// The frame-rate cap (Settings > General > maxFps; 0 = VSync, the default).
	//
	// Caps the engine loop below the monitor's refresh rate by re-wrapping the one
	// callback three's animation loop calls every vsync, so a throttled tick never
	// reaches the scheduler at all — gating further downstream (skipping
	// `scheduler.run`, or `shouldRender()`) would let the loop closure clear
	// `frameInvalidated` on the skipped tick, silently dropping a one-shot
	// invalidation (a settings drag, a toggle) that landed in that window.
	//
	// Quantisation is inherent: rAF only ticks on vsyncs, so the cap snaps down to a
	// whole number of refresh intervals, and rAF timestamps are themselves quantised
	// (commonly to 1ms), which a strict `delta < interval` gate turns into dropped
	// frames. Hence the 1ms tolerance and the drift-free deadline below: an
	// early-accepted frame pulls the next deadline sooner, never later, so
	// quantisation can't compound.
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
