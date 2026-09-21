<script lang="ts">
	// The warm loop: forces real frames of the real pipeline behind a cover and watches
	// three's live program count until it stops moving. Draws nothing. Why frames rather
	// than renderer.compileAsync(), and what this can and cannot reach: warmup.svelte.ts.
	//
	// ONE TASK, and its two unusual options are both the point:
	//
	//   `{ after: autoRenderTask }` — the render stage, so it ticks after Renderer.svelte's
	//   draw task and samples a count that includes the frame just drawn (Telemetry.svelte
	//   sits in the same slot for the same reason; mount both after <Renderer />, since
	//   registration order decides among tasks sharing a constraint).
	//
	//   `autoInvalidate` LEFT ON — normally the hazard (a running task with the default
	//   pins the render loop at full rate forever, src/CLAUDE.md), here the mechanism:
	//   Threlte's `shouldRender()` is `frameInvalidated || autoInvalidations.size > 0`, so
	//   a started task with it on renders every frame. `invalidate()` could not do this
	//   job from here — the loop clears `frameInvalidated` after `scheduler.run`, so an
	//   invalidate raised inside a render-stage task is wiped before the next frame reads
	//   it. The task is `autoStart: false` and stops itself the moment the scene is warm,
	//   which is what keeps on-demand rendering intact the rest of the time.
	import { onDestroy } from 'svelte';
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { logEngine } from '$extensions/logger';
	import { setWarmer, type WarmOutcome } from './warmup.svelte';

	const { renderer, autoRenderTask } = useThrelte();

	/** Frames to draw before quiet counts at all — the extra passes (shadow cascades,
	 *  the rear-view RT, DemoScene's reflector and its 30/15 Hz cube captures) do not
	 *  all run on the first one, and each brings its own variants. */
	const MIN_FRAMES = 6;
	/** Consecutive rendered frames with no new program before the scene counts as warm. */
	const QUIET_FRAMES = 4;
	/** Frame budget. Hit only by a scene that compiles something every frame. */
	const MAX_FRAMES = 180;
	/** Wall-clock cap: a backgrounded tab renders NO frames (rAF is paused), and the
	 *  veil must not outlive the player's patience because of it. */
	const TIMEOUT_MS = 8_000;

	let resolve: ((outcome: WarmOutcome) => void) | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let frames = 0;
	let quiet = 0;
	let programs = -1;
	let lastRenderCalls = -1;

	const { start, stop } = useTask(
		() => {
			// `info.render.calls` is a LIFETIME count — unchanged means the pipeline did
			// not actually draw this tick, so it is not a frame worth counting.
			const info = renderer.info;
			if (info.render.calls === lastRenderCalls) return;
			lastRenderCalls = info.render.calls;
			frames += 1;

			if (info.memory.programs === programs) {
				quiet += 1;
			} else {
				programs = info.memory.programs;
				quiet = 0;
			}

			if (frames >= MIN_FRAMES && quiet >= QUIET_FRAMES) {
				logEngine.info(`Scene warmed (${frames} frames, ${programs} programs)`);
				finish('quiet');
			} else if (frames >= MAX_FRAMES) {
				finish('capped');
			}
		},
		{ after: autoRenderTask, autoStart: false }
	);

	function finish(outcome: WarmOutcome): void {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		stop();
		resolve?.(outcome);
		resolve = null;
	}

	setWarmer(
		() =>
			new Promise<WarmOutcome>((res) => {
				frames = 0;
				quiet = 0;
				programs = -1;
				lastRenderCalls = -1;
				resolve = res;
				timer = setTimeout(() => finish('timeout'), TIMEOUT_MS);
				start();
			})
	);

	onDestroy(() => {
		setWarmer(null);
		if (resolve !== null) finish('capped');
	});
</script>
