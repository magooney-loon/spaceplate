<script lang="ts">
	import { sceneActions } from '$extensions/scene';
	import { soundActions } from '$core';
	import CarCluster from './CarCluster.svelte';
	import { carHandling, requestCarRestart, setHandlingMode } from './carInput.svelte';
	import { HANDLING_MODES, HANDLING_TUNES } from './handling';

	// The setup switch. A segmented control rather than a cycle button so the tune you
	// are NOT in is visible too — the two drive so differently that "which one is this"
	// has to be answerable at a glance. G does the same thing from the keyboard.
	const tunes = HANDLING_MODES.map((mode) => ({ mode, label: HANDLING_TUNES[mode].label }));
</script>

<!-- Test Game HUD -->
<div class="hud">
	<!-- Back / Restart -->
	<div class="buttons">
		<button
			onclick={() => {
				soundActions.playClick();
				sceneActions.goToMainMenu();
			}}
		>
			← Back to Menu
		</button>
		<button
			onclick={() => {
				soundActions.playClick();
				requestCarRestart();
			}}
		>
			↻ Restart
		</button>
	</div>

	<!-- Setup switch — Grip (the real car) vs Drift (loose rear, real oversteer). -->
	<div class="tune" role="group" aria-label="Handling setup">
		<span class="tune-label">Setup</span>
		{#each tunes as t (t.mode)}
			<button
				class:active={carHandling.mode === t.mode}
				aria-pressed={carHandling.mode === t.mode}
				onclick={() => {
					soundActions.playClick();
					setHandlingMode(t.mode);
				}}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<!-- Controls hint -->
	<div class="info">
		<p>↑ throttle · ↓ brake · Space handbrake · Q/E shift · L lights · H main beam</p>
		<p>G setup (Grip / Drift) · drag to tilt · right-drag to raise/lower · wheel to zoom</p>
	</div>

	<!-- Speed / gear / rpm — bottom right. -->
	<CarCluster />
</div>

<style>
	.hud {
		pointer-events: auto;
	}

	.buttons {
		position: absolute;
		bottom: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.5rem;
	}

	.buttons button {
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.5);
		color: #fff;
		border: 1px solid #4a90d9;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.buttons button:hover {
		background: rgba(0, 0, 0, 0.6);
	}

	/* Setup switch — sits above the Back/Restart row, out of the cluster's corner. */
	.tune {
		position: absolute;
		bottom: 7.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.45rem;
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid rgba(74, 144, 217, 0.45);
		border-radius: 0.25rem;
	}

	.tune-label {
		font-size: 0.6875rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.45);
	}

	.tune button {
		padding: 0.2rem 0.7rem;
		font-size: 0.8125rem;
		background: transparent;
		color: rgba(255, 255, 255, 0.6);
		border: 1px solid transparent;
		border-radius: 0.2rem;
		cursor: pointer;
	}

	.tune button:hover {
		color: #fff;
	}

	.tune button.active {
		background: rgba(74, 144, 217, 0.25);
		border-color: #4a90d9;
		color: #fff;
	}

	.info {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.5);
		border-radius: 0.25rem;
		color: #fff;
		text-align: center;
	}

	.info p {
		font-size: 0.875rem;
	}
</style>
