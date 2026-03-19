<script lang="ts">
	import { sceneActions } from '$core/SceneManager.svelte.ts';
	import SettingsHud from '$scenes/SettingsHud.svelte';

	let showSettings = $state(false);
</script>

<!-- Main Menu HUD -->
{#if !showSettings}
	<div class="pointer-events-auto">
		<!-- Menu Title -->
		<div class="absolute top-[20%] left-1/2 -translate-x-1/2 text-center">
			<h1 class="text-5xl text-white font-bold m-0" style="text-shadow: 0 0 20px #4a90d9;">
				SPACEPLATE ENGINE
			</h1>
			<p class="text-[#aaa] mt-2">Threlte/Svelte/Spacetime</p>
		</div>

		<!-- Menu Buttons -->
		<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-4">
			<button
				onclick={() => sceneActions.goToDemoScene()}
				class="px-8 py-4 text-xl bg-linear-to-br from-[#4a90d9] to-[#357abd] text-white border-none rounded-lg cursor-pointer min-w-50"
			>
				🚀 Start Demo
			</button>

			<button
				onclick={() => (showSettings = true)}
				class="px-8 py-4 text-xl bg-white/10 text-white border-2 border-[#4a90d9] rounded-lg cursor-pointer min-w-50"
			>
				⚙️ Settings
			</button>
		</div>
	</div>
{:else}
	<SettingsHud onBack={() => (showSettings = false)} />
{/if}
