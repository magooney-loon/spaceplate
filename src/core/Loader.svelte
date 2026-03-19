<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { useProgress } from '@threlte/extras';
	import { logEngine } from './logger.svelte.js';

	const { progress, finishedOnce, active, item, loaded, total } = useProgress();

	const isFinished = $derived($finishedOnce || ($total === 0 && !$active));

	const tweened = new Tween(0, { duration: 600, easing: cubicOut });
	$effect(() => {
		tweened.target = $total === 0 ? 1 : $progress;
	});

	$effect(() => {
		if (isFinished) logEngine.info('Assets loaded');
	});

	function truncatePath(path: string | undefined): string {
		if (!path) return '';
		const file = path.split(/[/\\]/).pop() ?? path;
		return file.length > 36 ? file.slice(0, 33) + '...' : file;
	}
</script>

{#if !isFinished}
	<div
		transition:fade={{ duration: 400 }}
		class="absolute inset-0 z-200 flex flex-col items-center justify-center bg-black text-white"
	>
		<p class="m-0 mb-6 text-xs tracking-[0.15em] uppercase opacity-40">Loading</p>

		<!-- Progress bar -->
		<div class="w-50 h-0.5 bg-white/10 rounded-full overflow-hidden">
			<div class="h-full bg-white rounded-full" style="width: {tweened.current * 100}%;"></div>
		</div>

		<p class="mt-4 text-xs opacity-25 font-mono">
			{Math.round(tweened.current * 100)}%
		</p>

		{#if $active}
			<p class="mt-2 text-[11px] opacity-20 max-w-60 text-center font-mono">
				{truncatePath($item)}
			</p>
			<p class="mt-0.5 text-[10px] opacity-15 font-mono">
				{$loaded} / {$total}
			</p>
		{/if}
	</div>
{/if}
