<script lang="ts">
	import { sceneActions } from '$extensions/scene';
	import { engineSounds } from '$core';
	import CarCluster from './CarCluster.svelte';
	import PaintShop from './PaintShop.svelte';
	import Garage from './Garage.svelte';
	import TrackMinimap from './TrackMinimap.svelte';
	import DebugHud from './debug/DebugHud.svelte';
	import { requestCarRestart } from './sim/carSwitches.svelte';
	import { togglePaintShop } from './sim/carPaint.svelte';
	import { toggleGarageShop } from './sim/garageShop.svelte';
	import { carHud } from './sim/carTelemetry.svelte';
	import { carGarage } from './cars';

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
				engineSounds.click.play();
				sceneActions.goToMainMenu();
			}}
		>
			← Back to Menu
		</button>
		<button
			onclick={() => {
				engineSounds.click.play();
				requestCarRestart();
			}}
		>
			↻ Restart
		</button>
		<button
			onclick={() => {
				engineSounds.click.play();
				togglePaintShop();
			}}
		>
			◈ Paint Shop
		</button>
		<button
			onclick={() => {
				engineSounds.click.play();
				toggleGarageShop();
			}}
		>
			▣ Garage
		</button>
	</div>

	<!-- Controls hint. -->
	<div class="info">
		<p>
			↑ throttle · ↓ brake · Space handbrake · Q/E shift · ⇧ nitrous · M ignition · L/K lights/beams
		</p>
		<p>
			G traction control · H gearbox (manual / auto) · U km/h ↔ mph · B debug view · mouse
			left/right/wheel (camera)
		</p>
	</div>

	<!-- Speed / gear / rpm — bottom right. Keyed on the garage's chosen car, same
	     as Scene.svelte keys <TestGame />: CarCluster reads its car's spec ONCE
	     at mount (maxRpm, hasTurbo, shift points…), and this HUD is routed on
	     `visibleScene`, not on the car — switching cars via the Garage never
	     remounts it on its own, so without this key the cluster would keep
	     showing the PREVIOUS car's dial forever (e.g. a turbo car's boost gauge
	     stuck reading NO TURBO after switching off the GR86). -->
	{#key carGarage.currentId}
		<CarCluster />
	{/key}

	<!-- Launch flash — upper middle of the screen (between centre and top, so
	     it clears the car the chase cam frames), one-shot when a rev-match
	     launch lands. The label is the caught band (STREET / JUICY / PERFECT);
	     the element's lifetime is the carSim countdown (~1.5 s), so the keyframe
	     runs once and the unmount ends it — no transitions (repo rule). -->
	{#if carHud.perfectLaunch}
		<div class="launch-flash">{LAUNCH_LABELS[carHud.launchTier] ?? 'PERFECT LAUNCH'}</div>
	{/if}

	<!-- Bottom-left, stacked bottom-up: the track map, and above it the debug
	     telemetry (debug/DebugHud — the numbers behind the rig's geometry).
	     DebugHud is mounted unconditionally and self-gates on the same
	     `carView.mode` B switch the rig is on, so this shell still does not know
	     about the debug view; the column just collapses to the map alone when the
	     panel renders nothing. The corner is anchored at the BOTTOM so the map
	     holds its place and the panel grows upward into the free screen. -->
	<div class="corner">
		<!-- Same stale-spec hazard as CarCluster above: DebugHud reads its car's
		     spec once at mount too. TrackMinimap doesn't (car-agnostic), so it
		     stays outside the key. -->
		{#key carGarage.currentId}
			<DebugHud />
		{/key}
		<TrackMinimap />
	</div>

	<!-- The paint shop — self-gates on paintShop.open (sim/carPaint.svelte).
	     Here rather than the scene because it is pure UI: it touches no object,
	     it writes the latched paint id/finish the scene's material effect reads.
	     A top bar with no backdrop — it never covers the car it re-colours. -->
	<PaintShop />

	<!-- The garage — self-gates on garageShop.open (sim/garageShop.svelte).
	     Picking a car writes carGarage.currentId (cars/garage.svelte.ts);
	     Scene.svelte keys the TestGame mount on that id, so the pick remounts
	     the scene fresh against the new car's spec. -->
	<Garage />
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

	/* The bottom-left corner, shared. Column, bottom-anchored, laid out so the
	   map keeps one position and the debug panel grows upward off it. */
	.corner {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		pointer-events: none;
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
