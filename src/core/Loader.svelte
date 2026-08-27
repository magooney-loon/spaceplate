<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { useProgress } from '@threlte/extras';
	import { logEngine } from '$extensions/logger/logger.svelte';

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
	<div class="loader">
		<p class="label">Loading</p>

		<!-- Progress bar -->
		<div class="track">
			<div class="fill" style="width: {tweened.current * 100}%;"></div>
		</div>

		<p class="percent">
			{Math.round(tweened.current * 100)}%
		</p>

		{#if $active}
			<p class="item">
				{truncatePath($item)}
			</p>
			<p class="count">
				{$loaded} / {$total}
			</p>
		{/if}
	</div>
{/if}

<style>
	.loader {
		position: absolute;
		inset: 0;
		z-index: 200;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: #000;
		color: #fff;
	}

	.label {
		margin-bottom: 1.5rem;
		font-size: 0.75rem;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		opacity: 0.4;
	}

	.track {
		width: 12.5rem;
		height: 0.125rem;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 9999px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: #fff;
		border-radius: 9999px;
	}

	.percent {
		margin-top: 1rem;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.75rem;
		opacity: 0.25;
	}

	.item {
		margin-top: 0.5rem;
		max-width: 15rem;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 11px;
		text-align: center;
		opacity: 0.2;
	}

	.count {
		margin-top: 0.125rem;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 10px;
		opacity: 0.15;
	}
</style>
