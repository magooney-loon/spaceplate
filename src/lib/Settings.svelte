<script lang="ts">
	import { stageActions } from '../stage.svelte.js';
	import { settingsState, graphicsActions, audioActions } from '../settings.svelte.js';
	import type { QualityLevel } from '../settings.svelte.js';
</script>

<!-- Example: Settings overlay -->
<!-- Replace this with your actual settings UI -->

<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);">
	<div style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 1rem; padding: 2rem; min-width: 320px; color: white;">
		<h2 style="margin: 0 0 1.5rem; font-size: 1.5rem; font-weight: 600;">Settings</h2>

		<!-- Graphics Quality -->
		<div style="margin-bottom: 1.5rem;">
			<label style="display: block; margin-bottom: 0.5rem; opacity: 0.7; font-size: 0.875rem;">Graphics Quality</label>
			<div style="display: flex; gap: 0.5rem;">
				{#each (['low', 'mid', 'high'] as QualityLevel[]) as level}
					<button
						onclick={() => graphicsActions.setQuality(level)}
						style="flex: 1; padding: 0.4rem; border-radius: 0.375rem; border: 1px solid rgba(255,255,255,{settingsState.graphics.quality === level ? '0.6' : '0.2'}); background: {settingsState.graphics.quality === level ? 'rgba(255,255,255,0.2)' : 'transparent'}; color: white; cursor: pointer; text-transform: capitalize;"
					>
						{level}
					</button>
				{/each}
			</div>
		</div>

		<!-- Audio -->
		<div style="margin-bottom: 1.5rem;">
			<label style="display: block; margin-bottom: 0.5rem; opacity: 0.7; font-size: 0.875rem;">Audio</label>
			<div style="display: flex; flex-direction: column; gap: 0.5rem;">
				<label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
					<input type="checkbox" checked={settingsState.audio.musicEnabled} onchange={() => audioActions.toggleMusic()} />
					Music
				</label>
				<label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
					<input type="checkbox" checked={settingsState.audio.ambienceEnabled} onchange={() => audioActions.toggleAmbience()} />
					Ambience
				</label>
				<label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
					<input type="checkbox" checked={settingsState.audio.effectsEnabled} onchange={() => audioActions.toggleEffects()} />
					Sound Effects
				</label>
			</div>
		</div>

		<button
			onclick={() => stageActions.goBack()}
			style="width: 100%; padding: 0.6rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer;"
		>
			Back
		</button>
	</div>
</div>
