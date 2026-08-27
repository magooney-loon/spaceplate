<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { useProgress } from '@threlte/extras';
	import { logEngine } from '$extensions/logger';
	import { audioActions } from '$extensions/settings';

	const { progress, finishedOnce, active, item, loaded, total } = useProgress();

	const isFinished = $derived($finishedOnce || ($total === 0 && !$active));

	let readyToHide = $state(false);
	let showPrompt = $state(false);

	const tweened = new Tween(0, { duration: 600, easing: cubicOut });
	$effect(() => {
		tweened.target = $total === 0 ? 1 : $progress;
	});

	$effect(() => {
		if (isFinished) {
			logEngine.info('Assets loaded');
			const timeout = setTimeout(() => {
				showPrompt = true;
			}, 1200);
			return () => clearTimeout(timeout);
		}
	});

	function handleEnableSounds() {
		audioActions.toggleMusic();
		audioActions.toggleAmbience();
		audioActions.toggleSfx();
		logEngine.info('Sounds enabled by user');
		readyToHide = true;
	}

	function handleSkipSounds() {
		logEngine.info('Sounds skipped by user');
		readyToHide = true;
	}

	function truncatePath(path: string | undefined): string {
		if (!path) return '';
		const file = path.split(/[/\\]/).pop() ?? path;
		return file.length > 36 ? file.slice(0, 33) + '...' : file;
	}
</script>

{#if !readyToHide}
	<div class="loader">
		{#if showPrompt}
			<!-- Sound enable prompt -->
			<div class="prompt">
				<p class="prompt-title">Enable sounds?</p>
				<p class="prompt-hint">
					Change audio, graphics, and controls settings<br />
					via the <strong>Settings</strong> button in the Main Menu.
				</p>

				<div class="prompt-buttons">
					<button onclick={handleEnableSounds} class="prompt-yes">Yes</button>
					<button onclick={handleSkipSounds} class="prompt-no">No</button>
				</div>
			</div>
		{:else}
			<!-- Loading screen -->
			<p class="label">{isFinished ? 'Preparing the game...' : 'Loading'}</p>

			<!-- Progress bar -->
			<div class="track">
				<div class="fill" style="width: {tweened.current * 100}%;"></div>
			</div>

			<p class="percent">
				{Math.round(tweened.current * 100)}%
			</p>

			<div class="status">
				{#if isFinished}
					<p class="done">All assets loaded</p>
				{:else if $active}
					<p class="item">
						{truncatePath($item)}
					</p>
					<p class="count">
						{$loaded} / {$total}
					</p>
				{/if}
			</div>
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

	.status {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 2rem;
		margin-top: 0.5rem;
	}

	.item {
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

	.done {
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 11px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.2;
	}

	.prompt {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.prompt-title {
		font-size: 0.875rem;
		letter-spacing: 0.025em;
		opacity: 0.7;
	}

	.prompt-hint {
		max-width: 18rem;
		font-size: 11px;
		line-height: 1.625;
		text-align: center;
		opacity: 0.3;
	}

	.prompt-hint strong {
		opacity: 0.6;
		font-weight: 600;
	}

	.prompt-buttons {
		display: flex;
		gap: 1rem;
	}

	.prompt-yes,
	.prompt-no {
		padding: 0.5rem 1.5rem;
		font-size: 0.875rem;
		letter-spacing: 0.025em;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.prompt-yes {
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.15);
	}

	.prompt-yes:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.prompt-no {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		opacity: 0.5;
	}

	.prompt-no:hover {
		background: rgba(255, 255, 255, 0.1);
	}
</style>
