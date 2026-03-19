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
<div class="pointer-events-auto">
	<!-- Back Button -->
	<button
		onclick={() => sceneActions.goToMainMenu()}
		class="absolute top-4 left-4 px-4 py-2 bg-black/50 text-white border border-[#4a90d9] rounded cursor-pointer hover:bg-black/60 transition-colors"
	>
		← Back to Menu
	</button>

	<!-- FPS Counter -->
	{#if demoStatsVisible}
		<div class="absolute top-4 right-4 px-4 py-2 bg-black/50 rounded text-[#4ad94a] font-mono">
			FPS: {frameCount}
			<div class="text-xs text-[#aaa]">Scene: Demo</div>
		</div>
	{/if}

	<!-- Demo Instructions -->
	<div
		class="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 rounded text-white text-center"
	>
		<p class="m-0 text-sm">🎮 Physics running at 60 FPS | Objects update in physics stage</p>
	</div>
</div>
