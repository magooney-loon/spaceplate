<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { useProgress } from '@threlte/extras';
	import { log } from './settings.svelte.js';

	const { progress, finishedOnce, active, item, loaded, total } = useProgress();

	const tweened = new Tween(0, { duration: 600, easing: cubicOut });
	$effect(() => { tweened.target = $progress; });

	$effect(() => {
		if ($finishedOnce) log.info('Assets loaded');
	});

	function truncatePath(path: string | undefined): string {
		if (!path) return '';
		const file = path.split(/[/\\]/).pop() ?? path;
		return file.length > 36 ? file.slice(0, 33) + '...' : file;
	}
</script>

{#if !$finishedOnce}
	<div
		transition:fade={{ duration: 400 }}
		style="position: absolute; inset: 0; z-index: 200; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #000; color: white;"
	>
		<p
			style="margin: 0 0 1.5rem; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; opacity: 0.4;"
		>
			Loading
		</p>

		<!-- Progress bar -->
		<div
			style="width: 200px; height: 2px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;"
		>
			<div
				style="height: 100%; background: white; border-radius: 999px; width: {tweened.current * 100}%;"
			></div>
		</div>

		<p
			style="margin: 1rem 0 0; font-size: 0.75rem; opacity: 0.25; font-variant-numeric: tabular-nums;"
		>
			{Math.round(tweened.current * 100)}%
		</p>

		{#if $active}
			<p
				style="margin: 0.5rem 0 0; font-size: 0.7rem; opacity: 0.2; max-width: 240px; text-align: center; font-variant-numeric: tabular-nums;"
			>
				{truncatePath($item)}
			</p>
			<p
				style="margin: 0.2rem 0 0; font-size: 0.65rem; opacity: 0.15; font-variant-numeric: tabular-nums;"
			>
				{$loaded} / {$total}
			</p>
		{/if}
	</div>
{/if}
