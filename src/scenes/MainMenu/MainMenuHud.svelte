<script lang="ts">
	import { sceneActions } from '$extensions/scene/scene.svelte';
	import { soundActions } from '$core/GlobalAudio.svelte';
	import { overlayState } from '$extensions/settings/settings.svelte';
</script>

<!-- Main Menu HUD -->
<div class="hud">
	<!-- Menu Title -->
	<div class="title">
		<h1 style="text-shadow: 0 0 20px #4a90d9;">SPACEPLATE ENGINE</h1>
		<p class="subtitle">Threlte/Svelte/Spacetime</p>
	</div>

	<!-- Menu Buttons -->
	<div class="menu-buttons">
		<button
			onclick={() => {
				soundActions.playClick();
				sceneActions.goToDemoScene();
			}}
			class="menu-button"
		>
			🚀 Start Demo
		</button>

		<button
			onclick={() => {
				soundActions.playClick();
				overlayState.settingsOpen = true;
			}}
			class="menu-button"
		>
			⚙️ Settings
		</button>
	</div>
</div>

<style>
	.hud {
		pointer-events: auto;
	}

	.title {
		position: absolute;
		top: 20%;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
	}

	.title h1 {
		font-size: 3rem;
		font-weight: 700;
		color: #fff;
	}

	.subtitle {
		margin-top: 0.5rem;
		color: #aaa;
	}

	.menu-buttons {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.menu-button {
		min-width: 12.5rem;
		padding: 1rem 2rem;
		font-size: 1.25rem;
		background: rgba(0, 0, 0, 0.7);
		color: rgba(255, 255, 255, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		cursor: pointer;
	}

	.menu-button:hover {
		background: rgba(255, 255, 255, 0.7);
		color: #000;
	}
</style>
