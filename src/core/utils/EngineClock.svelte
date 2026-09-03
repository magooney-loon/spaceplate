<script lang="ts">
	// Installs the engine clock (core/utils/engineClock.ts — read the header there; all of
	// the reasoning lives in it). Renders nothing, draws nothing, and REGISTERS NO TASK: it
	// wraps `scheduler.run` itself, which is upstream of every stage and therefore of every
	// task in the app, so it does not need to be ordered against anything.
	//
	// That is also why it can sit above <Renderer /> without touching the render-task order
	// the capture grab depends on (src/CLAUDE.md, DOCS/webgpu-notes.md §2) — there is no task
	// here to take a slot. It mounts first because reading first is the point: the clock
	// should be installed before anything that integrates a delta exists.
	//
	// Not dev-only. The clock is engine infrastructure in every build; what is dev-only is
	// the only thing that ever takes it over — `extensions/capture/`, which installs a
	// fixed-step source for the duration of an offline take. With no source installed this
	// is a pass-through and the app runs exactly as it did before.

	import { useThrelte } from '@threlte/core/webgpu';
	import { installEngineClock } from './engineClock';

	const { scheduler, renderer, invalidate } = useThrelte();

	$effect(() => installEngineClock(scheduler, renderer, invalidate));
</script>
