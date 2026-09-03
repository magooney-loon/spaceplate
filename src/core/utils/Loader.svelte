<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { useProgress } from '@threlte/extras';
	import { logEngine } from '$extensions/logger';
	import { audioActions } from '$extensions/settings';
	import { sceneActions } from '$extensions/scene';
	import { bootState } from './boot.svelte';
	import { capabilityState, isBlocked, WEBGPU_REPORT_URL } from './capabilities.svelte';

	const { progress, active, item, loaded, total, errors } = useProgress();

	// Boot probe verdict (settled before mount). blocked: nothing to load into, so
	// this screen replaces the loader. degraded: WebGL2 fallback — playable, so it
	// gets a dismissible badge that outlives the loading screen.
	const blocked = $derived(isBlocked());
	const degraded = $derived(capabilityState.tier === 'webgl');
	let noticeDismissed = $state(false);

	// 'Done' here is a quiet period, not finishedOnce: three's manager has no 'queue
	// drained' event — loaded catches up with total transiently BETWEEN items, so
	// finishedOnce latches on the first catch-up and would arm the prompt while
	// assets were still streaming. settled = quiet for a grace period (covers the
	// nothing-to-load case too); any new item restarts the wait.
	let settled = $state(false);
	$effect(() => {
		// Never start the warmup sweep on a blocked device — with no <Canvas> mounted
		// (App.svelte) it would wait on warm frames that can never be rendered.
		if (blocked || settled || $active) return;
		const timeout = setTimeout(() => {
			settled = true;
			// Assets done — kick the scene warmup sweep (visits + warm-renders every
			// scene behind this screen). Its scenesWarmed latch arms the prompt below.
			void sceneActions.warmupScenes();
		}, 500);
		return () => clearTimeout(timeout);
	});

	let readyToHide = $state(false);
	let showPrompt = $state(false);

	const tweened = new Tween(0, { duration: 600, easing: cubicOut });
	$effect(() => {
		// Two passes, two sources: while assets stream the LoadingManager drives the
		// bar; once settled, ownership flips to the warmup sweep (warmProgress) — the
		// bar rolls back and climbs again, reading as the shader compilation it is.
		// Straggler loads the sweep discovers no longer touch the bar.
		if (settled) {
			tweened.target = bootState.warmProgress;
			return;
		}
		tweened.target = $total === 0 ? 1 : $progress;
	});

	$effect(() => {
		// Only after the warmup sweep finished: the prompt must never appear (let
		// alone let the loader hide) mid-sweep, or the scene flipping behind it shows.
		if (settled && bootState.scenesWarmed) {
			const timeout = setTimeout(() => {
				showPrompt = true;
			}, 1200);
			return () => clearTimeout(timeout);
		}
	});

	// One line, once, when the load cycle has settled. Counts are read via .current
	// on purpose — $-reads here would re-trigger the effect per item.
	$effect(() => {
		if (!settled) return;
		logEngine.info(`Assets loaded (${loaded.current})`);
		if (errors.current.length > 0) {
			logEngine.error(
				`Assets failed to load (${errors.current.length}/${total.current}):`,
				...errors.current.map(truncatePath)
			);
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

{#if blocked}
	<!-- Dead end: no WebGPU and no WebGL2 fallback, or no WASM (Rapier). Replaces the
	     loader outright — there is nothing behind it to reveal. -->
	<div class="loader">
		<div class="unsupported">
			<p class="prompt-title">This browser can't run the app</p>

			<ul class="checks">
				<li class:ok={capabilityState.tier === 'webgpu'}>
					WebGPU — {capabilityState.tier === 'webgpu' ? 'available' : 'no adapter'}
				</li>
				<li class:ok={capabilityState.webgl2}>
					WebGL 2 — {capabilityState.webgl2 ? 'available' : 'unavailable'}
				</li>
				<li class:ok={capabilityState.wasm}>
					WebAssembly — {capabilityState.wasm ? 'available' : 'unavailable'}
				</li>
			</ul>

			<p class="prompt-hint">
				Rendering needs WebGPU, or WebGL 2 as a fallback; physics needs WebAssembly.<br />
				Try a current Chrome, Edge, Firefox or Safari, and check that hardware acceleration is enabled.
			</p>

			<a class="report" href={WEBGPU_REPORT_URL} target="_blank" rel="noopener noreferrer">
				See what your browser reports → webgpureport.org
			</a>
		</div>
	</div>
{:else if !readyToHide}
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
			<p class="label">{settled ? 'Compiling shaders...' : 'Loading'}</p>

			<!-- Progress bar -->
			<div class="track">
				<div class="fill" style="width: {tweened.current * 100}%;"></div>
			</div>

			<p class="percent">
				{Math.round(tweened.current * 100)}%
			</p>

			<div class="status">
				{#if settled}
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

{#if degraded && !blocked && !noticeDismissed}
	<!-- Sits above the loader and outlives it (this component never unmounts), so the
	     badge stays until it is dismissed rather than vanishing with the load screen. -->
	<div class="notice">
		<p>
			<strong>WebGL fallback.</strong> WebGPU isn't available here, so the renderer fell back to WebGL
			2 — expect lower performance.
		</p>
		<a href={WEBGPU_REPORT_URL} target="_blank" rel="noopener noreferrer">webgpureport.org</a>
		<button class="notice-close" onclick={() => (noticeDismissed = true)} aria-label="Dismiss">
			×
		</button>
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

	.unsupported {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
		max-width: 26rem;
		padding: 0 1.5rem;
		text-align: center;
	}

	.checks {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 11px;
		opacity: 0.35;
	}

	.checks li::before {
		content: '✕ ';
	}

	.checks li.ok::before {
		content: '✓ ';
	}

	.report {
		font-size: 0.75rem;
		color: #fff;
		opacity: 0.55;
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}

	.report:hover {
		opacity: 0.9;
	}

	.notice {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		z-index: 210;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		max-width: 24rem;
		padding: 0.75rem 0.875rem;
		background: rgba(0, 0, 0, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 0.25rem;
		color: #fff;
		font-size: 11px;
		line-height: 1.6;
	}

	.notice p {
		opacity: 0.6;
	}

	.notice strong {
		font-weight: 600;
		opacity: 0.9;
	}

	.notice a {
		flex-shrink: 0;
		color: #fff;
		opacity: 0.5;
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}

	.notice a:hover {
		opacity: 0.9;
	}

	.notice-close {
		flex-shrink: 0;
		padding: 0 0.25rem;
		background: none;
		border: none;
		color: #fff;
		font-size: 0.875rem;
		line-height: 1;
		opacity: 0.4;
		cursor: pointer;
	}

	.notice-close:hover {
		opacity: 0.9;
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
