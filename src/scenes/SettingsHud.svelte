<script lang="ts">
	import { fly } from 'svelte/transition';
	import { sceneActions } from '$core/SceneManager.svelte.ts';
	import { settingsState, graphicsActions, audioActions } from '$core/settings.svelte.js';
	import type { QualityLevel } from '$core/settings.svelte.js';
</script>

<!-- Settings overlay -->
<div
	transition:fly={{ y: -16, duration: 220 }}
	class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md pointer-events-auto"
>
	<div class="bg-white/8 border border-white/15 rounded-2xl p-8 min-w-[320px] text-white">
		<h2 class="m-0 mb-6 text-2xl font-semibold">Settings</h2>

		<!-- Graphics Quality -->
		<div class="mb-6">
			<p class="m-0 mb-2 opacity-70 text-sm">Graphics Quality</p>
			<div class="flex gap-2">
				{#each ['low', 'high'] as level}
					<button
						onclick={() => graphicsActions.setQuality(level as QualityLevel)}
						class="flex-1 px-4 py-2 rounded-lg border transition-all capitalize cursor-pointer
							{settingsState.graphics.quality === level
							? 'border-white/60 bg-white/20'
							: 'border-white/20 bg-transparent hover:bg-white/10'}"
					>
						{level}
					</button>
				{/each}
			</div>
		</div>

		<!-- Audio -->
		<div class="mb-6">
			<p class="m-0 mb-2 opacity-70 text-sm">Audio</p>
			<div class="flex flex-col gap-3">
				<!-- Music -->
				<div class="flex flex-col gap-1">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={settingsState.audio.musicEnabled}
							onchange={() => audioActions.toggleMusic()}
							class="w-4 h-4"
						/>
						Music
					</label>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						aria-label="Music volume"
						value={settingsState.audio.musicVolume}
						oninput={(e) => audioActions.setMusicVolume(+(e.target as HTMLInputElement).value)}
						class="w-full accent-white/80"
					/>
				</div>

				<!-- Ambience -->
				<div class="flex flex-col gap-1">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={settingsState.audio.ambienceEnabled}
							onchange={() => audioActions.toggleAmbience()}
							class="w-4 h-4"
						/>
						Ambience
					</label>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						aria-label="Ambience volume"
						value={settingsState.audio.ambienceVolume}
						oninput={(e) => audioActions.setAmbienceVolume(+(e.target as HTMLInputElement).value)}
						class="w-full accent-white/80"
					/>
				</div>

				<!-- Sound Effects -->
				<div class="flex flex-col gap-1">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={settingsState.audio.effectsEnabled}
							onchange={() => audioActions.toggleEffects()}
							class="w-4 h-4"
						/>
						Sound Effects
					</label>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						aria-label="Effects volume"
						value={settingsState.audio.effectsVolume}
						oninput={(e) => audioActions.setEffectsVolume(+(e.target as HTMLInputElement).value)}
						class="w-full accent-white/80"
					/>
				</div>
			</div>
		</div>

		<!-- Keybinds -->
		<div class="mb-6">
			<p class="m-0 mb-2 opacity-70 text-sm">Keybinds</p>
			<div class="flex justify-between items-center text-sm opacity-60">
				<span>Toggle HUD</span>
				<kbd class="bg-white/8 border border-white/20 rounded px-2 py-0.5 font-mono text-xs">
					Ctrl+H
				</kbd>
			</div>
		</div>

		<!-- Back Button -->
		<button
			onclick={() => sceneActions.goBack()}
			class="w-full px-4 py-2.5 bg-white/15 text-white border border-white/30 rounded-lg cursor-pointer hover:bg-white/20 transition-colors"
		>
			Back
		</button>
	</div>
</div>
