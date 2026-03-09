<script lang="ts">
	import { isSettingsStage, isHomeStage, isGalaxyStage } from './stage.svelte.js';
	import { settingsState } from './settings.svelte.js';
	import { HUD } from '@threlte/extras';
	import { T } from '@threlte/core';
	import HomeStage from '$lib/HomeStage.svelte';
	import GalaxyStage from '$lib/GalaxyStage.svelte';
	import HomeHud from '$lib/HomeHud.svelte';
	import GalaxyHud from '$lib/GalaxyHud.svelte';
	import Settings from '$lib/Settings.svelte';
</script>

<!-- Stage Rendering (3D content inside Canvas) -->
{#if isSettingsStage()}
	<HomeStage />
{:else if isHomeStage()}
	<HomeStage />
{:else if isGalaxyStage()}
	<GalaxyStage />
{/if}

<!-- 2D HUD overlay -->
{#if settingsState.general.uiVisible}
	<HUD>
		<T.PerspectiveCamera
			makeDefault
			position={[0, 0, 10]}
			oncreate={(ref) => ref.lookAt(0, 0, 0)}
			far={90}
		/>
		{#if isSettingsStage()}
			<Settings />
		{:else if isHomeStage()}
			<HomeHud />
		{:else if isGalaxyStage()}
			<GalaxyHud />
		{/if}
	</HUD>
{/if}
