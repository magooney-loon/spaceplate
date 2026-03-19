<script lang="ts">
	import { sceneActions } from '$core/SceneManager.svelte.ts';
</script>

<!-- Settings HUD -->
<div style="pointer-events: auto;">
	<div
		style="
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: rgba(0, 0, 0, 0.8);
		padding: 2rem;
		border-radius: 8px;
		color: white;
	"
	>
		<h2>Settings</h2>
		<p>Settings panel placeholder</p>
		<button
			onclick={() => sceneActions.goBack()}
			style="
				margin-top: 1rem;
				padding: 0.5rem 1rem;
				background: #4a90d9;
				color: white;
				border: none;
				border-radius: 4px;
				cursor: pointer;
				pointer-events: auto;
			"
		>
			Back
		</button>
	</div>
</div>
