<script lang="ts">
	import { sceneActions } from '$extensions/scene/scene.svelte';
	import { soundActions } from '$core/GlobalAudio.svelte';
	import SettingsHud from '$scenes/SettingsHud.svelte';
	import { planetDemoActions, planetDemoState } from '$lib/PlanetDemo/planetDemoState.svelte';
	import { getPlanetVariantName, hashCode } from '$lib/PlanetDemo/procedural.svelte';
	import PlanetIcon from '$lib/PlanetDemo/PlanetIcon.svelte';

	let showSettings = $state(false);

	const planetName = $derived(
		getPlanetVariantName(planetDemoState.temperature, hashCode(planetDemoState.planetId))
	);
</script>

<!-- Main Menu HUD -->
{#if !showSettings}
	<div class="pointer-events-auto">
		<!-- Menu Title -->
		<div class="absolute top-[20%] left-1/2 -translate-x-1/2 text-center">
			<PlanetIcon
				planetId={planetDemoState.planetId}
				temperature={planetDemoState.temperature}
				size={80}
				class="mx-auto mb-4"
				getSvgDataUri={(uri) => (planetDemoState.faviconUri = uri)}
			/>
			<h1 class="text-5xl text-white font-bold m-0" style="text-shadow: 0 0 20px #4a90d9;">
				SPACEPLATE ENGINE
			</h1>
			<p class="text-[#aaa] mt-2">Threlte/Svelte/Spacetime</p>
			<p class="text-[#888] text-sm mt-1 italic">{planetName} · {planetDemoState.temperature}°C</p>
		</div>

		<!-- Menu Buttons -->
		<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-4">
			<button
				onclick={() => {
					soundActions.playClick();
					sceneActions.goToDemoScene();
				}}
				class="px-8 py-4 text-xl bg-black/70 text-white/70 border border-white/20 rounded-lg cursor-pointer min-w-50 hover:bg-white/70 hover:text-black transition-colors"
			>
				🚀 Start Demo
			</button>

			<button
				onclick={() => {
					soundActions.playClick();
					showSettings = true;
				}}
				class="px-8 py-4 text-xl bg-black/70 text-white/70 border border-white/20 rounded-lg cursor-pointer min-w-50 hover:bg-white/70 hover:text-black transition-colors"
			>
				⚙️ Settings
			</button>

			<button
				onclick={() => {
					soundActions.playClick();
					planetDemoActions.randomize();
				}}
				class="px-8 py-4 text-xl bg-black/70 text-white/70 border border-white/20 rounded-lg cursor-pointer min-w-50 hover:bg-white/70 hover:text-black transition-colors"
			>
				🌍 Randomize Planet
			</button>
		</div>
	</div>
{:else}
	<SettingsHud
		onBack={() => {
			soundActions.playClick();
			showSettings = false;
		}}
	/>
{/if}
