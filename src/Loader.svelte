<script lang="ts">
	import { fade } from 'svelte/transition';
	import { useProgress } from '@threlte/extras';

	const { active, progress, finishedOnce } = useProgress();
</script>

{#if !$finishedOnce}
	<div
		transition:fade={{ duration: 400 }}
		style="position: absolute; inset: 0; z-index: 200; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #000; color: white;"
	>
		<p style="margin: 0 0 1.5rem; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; opacity: 0.4;">
			Loading
		</p>

		<!-- Progress bar -->
		<div style="width: 200px; height: 2px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
			<div style="height: 100%; background: white; border-radius: 999px; width: {$progress * 100}%; transition: width 0.15s ease;"></div>
		</div>

		<p style="margin: 1rem 0 0; font-size: 0.75rem; opacity: 0.25; font-variant-numeric: tabular-nums;">
			{Math.round($progress * 100)}%
		</p>
	</div>
{/if}
