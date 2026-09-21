<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { useThrelte } from '@threlte/core/webgpu';
	import { World } from '@threlte/rapier';

	// `<World>`, with Rapier's synchronization stage pinned ahead of the main stage.
	// That one edge is the whole component; everything else passes straight through.
	//
	// @threlte/rapier only constrains synchronization to `after: simulation, before:
	// renderStage`, so by default it sorts AFTER the main stage — every main-stage
	// task (including Threlte's own `useFollow`/`<CameraControls>`, which TestGame's
	// chase camera uses) reads a body transform a full frame stale. Moving the STAGE
	// fixes every main-stage consumer at once, including third-party ones that hard-code
	// the main stage and expose no ordering option — the alternative (moving every
	// physics-reading task to the render stage) can't reach those.
	//
	// Safe: both of Rapier's real ordering guarantees are kept (this option merges
	// with the built-in `before: renderStage`, and `after: simulation` is untouched),
	// so main-stage tasks now just see this frame's pose instead of last frame's —
	// strictly fresher data, no behavioural risk. Full detail: `core/utils/CLAUDE.md`.

	let { children, ...rest }: ComponentProps<typeof World> = $props();

	const { mainStage } = useThrelte();
</script>

<World {...rest} synchronizationStageOptions={{ before: mainStage }}>
	{@render children?.()}
</World>
