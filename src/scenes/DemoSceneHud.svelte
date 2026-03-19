<script lang="ts">
	import { sceneActions } from '$core/SceneManager.svelte.ts';

	let demoStatsVisible = $state(true);
	let frameCount = $state(0);

	// Simple FPS counter
	$effect(() => {
		const interval = setInterval(() => {
			frameCount++;
		}, 1000);

		return () => clearInterval(interval);
	});
</script>

<!-- Demo Scene HUD -->
<div style="pointer-events: auto;">
	<!-- Back Button -->
	<button
		onclick={() => sceneActions.goToMainMenu()}
		style="
			position: absolute;
			top: 1rem;
			left: 1rem;
			padding: 0.5rem 1rem;
			background: rgba(0, 0, 0, 0.5);
			color: white;
			border: 1px solid #4a90d9;
			border-radius: 4px;
			cursor: pointer;
		"
	>
		← Back to Menu
	</button>

	<!-- FPS Counter -->
	{#if demoStatsVisible}
		<div
			style="
			position: absolute;
			top: 1rem;
			right: 1rem;
			background: rgba(0, 0, 0, 0.5);
			padding: 0.5rem 1rem;
			border-radius: 4px;
			color: #4ad94a;
			font-family: monospace;
		"
		>
			FPS: {frameCount}
			<div style="font-size: 0.8rem; color: #aaa;">Scene: Demo</div>
		</div>
	{/if}

	<!-- Demo Instructions -->
	<div
		style="
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.5);
		padding: 0.5rem 1rem;
		border-radius: 4px;
		color: white;
		text-align: center;
	"
	>
		<p style="margin: 0; font-size: 0.9rem;">
			🎮 Physics running at 60 FPS | Objects update in physics stage
		</p>
	</div>
</div>
