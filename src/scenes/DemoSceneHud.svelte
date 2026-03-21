<script lang="ts">
	import { sceneActions } from '$extensions/scene/scene.svelte';
	import { soundActions } from '$core/GlobalAudio.svelte';
	import { physicsState } from '$extensions/physics/physics.svelte';

	const framerateLabel = $derived(
		physicsState.framerate === 'varying' ? 'Varying' : `${physicsState.framerate} Hz`
	);
</script>

<!-- Demo Scene HUD -->
<div class="pointer-events-auto">
	<!-- Back Button -->
	<button
		onclick={() => {
			soundActions.playClick();
			sceneActions.goToMainMenu();
		}}
		class="absolute top-4 left-4 px-4 py-2 bg-black/50 text-white border border-[#4a90d9] rounded cursor-pointer hover:bg-black/60 transition-colors"
	>
		← Back to Menu
	</button>

	<!-- Demo Instructions -->
	<div
		class="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 rounded text-white text-center"
	>
		<p class="m-0 text-sm">Physics running at {framerateLabel} | Objects update in physics stage</p>
	</div>
</div>
