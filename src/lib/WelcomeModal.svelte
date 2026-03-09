<script lang="ts">
	import { settingsState, generalActions } from '../settings.svelte.js';

	let dontShowAgain = $state(false);

	function close() {
		if (dontShowAgain) generalActions.setHideWelcomeModal(true);
		settingsState.general.hideWelcomeModal = true;
	}
</script>

{#if !settingsState.general.hideWelcomeModal}
	<div
		style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 100; background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);"
	>
		<div
			style="background: rgba(10,10,20,0.92); border: 1px solid rgba(255,255,255,0.12); border-radius: 1.25rem; padding: 2.5rem; max-width: 480px; width: 90%; color: white; display: flex; flex-direction: column; gap: 1.25rem;"
		>
			<div>
				<h1
					style="margin: 0 0 0.25rem; font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em;"
				>
					Spaceplate
				</h1>
				<p
					style="margin: 0; font-size: 0.8rem; opacity: 0.45; letter-spacing: 0.08em; text-transform: uppercase;"
				>
					Svelte 5 · Threlte · SpacetimeDB
				</p>
			</div>

			<p style="margin: 0; line-height: 1.65; opacity: 0.8; font-size: 0.95rem;">
				A boilerplate for building real-time 3D web apps. It wires together
				<strong>Threlte</strong> (Three.js for Svelte) and
				<strong>SpacetimeDB</strong> (a real-time relational database with server-side logic) so you can
				focus on your game or app instead of the plumbing.
			</p>

			<ul
				style="margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; opacity: 0.75; font-size: 0.9rem; line-height: 1.5;"
			>
				<li>Two example 3D stages with HUD overlays</li>
				<li>Persistent settings (graphics quality, audio volumes)</li>
				<li>Sound system with music, ambience &amp; SFX</li>
				<li>Stage state machine with animated transitions</li>
				<li>SpacetimeDB client bindings ready to wire up</li>
			</ul>

			<div
				style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 0.25rem;"
			>
				<label
					style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem; opacity: 0.6;"
				>
					<input type="checkbox" bind:checked={dontShowAgain} />
					Don't show again
				</label>
				<button
					onclick={close}
					style="padding: 0.5rem 1.75rem; background: rgba(255,255,255,0.12); color: white; border: 1px solid rgba(255,255,255,0.25); border-radius: 0.5rem; cursor: pointer; font-size: 0.95rem;"
				>
					Got it
				</button>
			</div>
		</div>
	</div>
{/if}
