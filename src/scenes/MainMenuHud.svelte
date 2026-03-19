<script lang="ts">
	import { sceneActions } from '$core/SceneManager.svelte.ts';
</script>

<!-- Main Menu HUD -->
<div style="pointer-events: auto;">
	<!-- Menu Title -->
	<div
		style="
		position: absolute;
		top: 20%;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
	"
	>
		<h1
			style="
			font-size: 3rem;
			color: white;
			text-shadow: 0 0 20px #4a90d9;
			margin: 0;
		"
		>
			Spaceplate Engine
		</h1>
		<p style="color: #aaa; margin-top: 0.5rem;">Threlte 5 + Svelte 5</p>
	</div>

	<!-- Menu Buttons -->
	<div
		style="
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	"
	>
		<button
			onclick={() => sceneActions.goToDemoScene()}
			style="
				padding: 1rem 2rem;
				font-size: 1.2rem;
				background: linear-gradient(135deg, #4a90d9, #357abd);
				color: white;
				border: none;
				border-radius: 8px;
				cursor: pointer;
				min-width: 200px;
				transition: transform 0.2s;
			"
			onmouseenter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
			onmouseleave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
		>
			🚀 Start Demo
		</button>

		<button
			onclick={() => sceneActions.goToSettings()}
			style="
				padding: 1rem 2rem;
				font-size: 1.2rem;
				background: rgba(255, 255, 255, 0.1);
				color: white;
				border: 2px solid #4a90d9;
				border-radius: 8px;
				cursor: pointer;
				min-width: 200px;
				transition: transform 0.2s;
			"
			onmouseenter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
			onmouseleave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
		>
			⚙️ Settings
		</button>
	</div>
</div>
