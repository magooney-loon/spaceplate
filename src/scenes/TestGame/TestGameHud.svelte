<script lang="ts">
	import { sceneActions } from '$extensions/scene';
	import { soundActions } from '$core';
	import CarCluster from './CarCluster.svelte';
	import { requestCarRestart } from './sim/carInput.svelte';
	import { carHud } from './sim/carTelemetry.svelte';

	// The launch flash's tier names — latched at the catch (carSim.launchTier),
	// never read off the live revs. The boost itself is continuous; the names
	// are how the player learns the window.
	const LAUNCH_LABELS = ['STREET LAUNCH', 'JUICY LAUNCH', 'PERFECT LAUNCH'] as const;
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

	<!-- Controls hint. -->
	<div class="info">
		<p>
			↑ throttle · ↓ brake · Space handbrake · Q/E shift · ⇧ nitrous · M ignition · L/K lights/beams
		</p>
		<p>G setup (Grip / Drift) · B view (model / rig / both) · drag tilt · right-drag raise/lower · wheel zoom</p>
	</div>

	<!-- Speed / gear / rpm — bottom right. -->
	<CarCluster />

	<!-- Launch flash — upper middle of the screen (between centre and top, so
	     it clears the car the chase cam frames), one-shot when a rev-match
	     launch lands. The label is the caught band (STREET / JUICY / PERFECT);
	     the element's lifetime is the carSim countdown (~1.5 s), so the keyframe
	     runs once and the unmount ends it — no transitions (repo rule). -->
	{#if carHud.perfectLaunch}
		<div class="launch-flash">{LAUNCH_LABELS[carHud.launchTier] ?? 'PERFECT LAUNCH'}</div>
	{/if}
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

	/* ── Launch flash ───────────────────────────────────────────────────── */
	.launch-flash {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-bottom: 40vh;
		font-size: 2.4rem;
		font-weight: 700;
		letter-spacing: 0.22em;
		color: #a8dcff;
		text-shadow:
			0 0 18px rgba(122, 200, 255, 0.9),
			0 0 4px #fff;
		white-space: nowrap;
		pointer-events: none;
		animation: launch-pop 1.5s ease-out forwards;
	}

	@keyframes launch-pop {
		0% {
			opacity: 0;
			transform: scale(0.6);
		}
		12% {
			opacity: 1;
			transform: scale(1.06);
		}
		22% {
			transform: scale(1);
		}
		70% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: scale(1.02);
		}
	}
</style>
