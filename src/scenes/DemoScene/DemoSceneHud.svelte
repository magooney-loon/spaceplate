<script lang="ts">
	import { sceneActions } from '$extensions/scene';
	import { soundActions } from '$core';
	import { physicsState } from '$extensions/physics';

	const framerateLabel = $derived(
		physicsState.framerate === 'varying' ? 'Varying' : `${physicsState.framerate} Hz`
	);
</script>

<!-- Demo Scene HUD -->
<div class="hud">
	<!-- Back Button -->
	<button
		onclick={() => {
			soundActions.playClick();
			sceneActions.goToMainMenu();
		}}
		class="back-button"
	>
		← Back to Menu
	</button>

	<!-- Demo Instructions -->
	<div class="info">
		<p>Physics running at {framerateLabel}</p>
	</div>
</div>

<style>
	.hud {
		pointer-events: auto;
	}

	.back-button {
		position: absolute;
		bottom: 3.5rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.5);
		color: #fff;
		border: 1px solid #4a90d9;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.back-button:hover {
		background: rgba(0, 0, 0, 0.6);
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
