<script lang="ts">
	// Installs the engine clock (all reasoning in core/utils/engineClock.ts — read its
	// header). Renders nothing and REGISTERS NO TASK: it wraps `scheduler.run`, upstream
	// of every stage and task, so it needs no ordering and does not disturb the
	// render-task order the capture grab depends on (DOCS/webgpu-notes.md §2). Mounts
	// first, before anything that integrates a delta. Not dev-only — with no source
	// installed it is a pass-through; only `extensions/capture/` (dev-only) ever
	// installs one.

	import { useThrelte } from '@threlte/core/webgpu';
	import { installEngineClock } from './engineClock';

	const { scheduler, renderer, invalidate } = useThrelte();

	$effect(() => installEngineClock(scheduler, renderer, invalidate));
</script>
