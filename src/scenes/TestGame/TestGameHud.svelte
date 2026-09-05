<script lang="ts">
	import { sceneActions } from '$extensions/scene';
	import { soundActions } from '$core';
	import CarCluster from './CarCluster.svelte';
	import { requestCarRestart } from './carInput.svelte';
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

	<!-- Controls hint -->
	<div class="info">
		<p>↑ throttle · ↓ brake · Space handbrake · Q/E shift · L lights · H main beam</p>
		<p>Drag to tilt · right-drag to raise/lower · wheel to zoom</p>
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
