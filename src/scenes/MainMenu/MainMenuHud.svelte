<script lang="ts">
	import { sceneActions } from '$extensions/scene';
	import { soundActions } from '$core';
	import { overlayState, BASE_URL } from '$extensions/settings';
</script>

<!-- Main Menu HUD -->
<div class="hud">
	<!-- Menu Title. The wordmark carries its own glow, so no text-shadow stand-in; the
	     alt text keeps the old title for anyone who never sees the image. -->
	<div class="title">
		<img class="logo" src="{BASE_URL}logo.png" alt="Spaceplate Engine" />
	</div>

	<!-- Menu Buttons -->
	<div class="menu-buttons">
		<button
			onclick={() => {
				soundActions.playClick();
				sceneActions.goToTestGame();
			}}
			class="menu-button"
		>
			🚗 Test Game
		</button>

		<button
			onclick={() => {
				soundActions.playClick();
				sceneActions.goToDemoScene();
			}}
			class="menu-button"
		>
			🚀 Demo Scene
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
		top: 16.5%;
		left: 50%;
		transform: translateX(-50%);
		text-align: center;
	}

	/* Width-driven, capped against the viewport so the wordmark never crowds the edges
	   on a phone or blow up past its 2172px source on a wide monitor. The source is
	   3:1, so height follows from the aspect ratio. */
	.logo {
		display: block;
		width: min(38rem, 72vw);
		height: auto;
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
