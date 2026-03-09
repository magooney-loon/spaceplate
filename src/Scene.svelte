<script lang="ts">
	import { initializeNarrator } from '$lib/game/utils/narrator.svelte';
	import Settings from '$lib/settings/Scene.svelte';
	import Toast from '$lib/components/partials/feedback/Toast.svelte';
	import { isSettingsStage, isHomeStage, isGalaxyStage, cameraActions } from './stage.svelte.js';
	import { HUD } from '@threlte/extras';
	import { T } from '@threlte/core';
	import Planet from '$lib/stages/home/Planet.svelte';
	import HomeStage from '$lib/stages/home/Scene.svelte';
	import PlanetSmoke from '$lib/stages/home/PlanetSmoke.svelte';
	import HomeHud from '$lib/stages/home/HudScene.svelte';
	import GalaxyStage from '$lib/stages/galaxy/Scene.svelte';
	import GalaxyHud from '$lib/stages/galaxy/HudScene.svelte';
	import { TopBar } from '$lib/stages/home/hud';
	import { profileGetters, profileState } from '$lib/game/profile.svelte.js';
	import { audioActions, settingsState } from '$lib/settings/settings.svelte.js';

	initializeNarrator();

	const selectedPlanetData = $derived(profileGetters.selectedPlanetFullData);
	const selectedPlanetBasic = $derived(profileGetters.selectedPlanet);

	const isViewingMoon = $derived(selectedPlanetBasic?.celestialBodyType === 'Moon');

	const parentPlanetBasic = $derived.by(() => {
		if (!isViewingMoon || !profileState.selectedPlanetId) return null;
		return profileGetters.getParentPlanetForMoon(profileState.selectedPlanetId);
	});

	const parentPlanetFullData = $derived.by(() => {
		if (!parentPlanetBasic) return null;
		return profileGetters.getFullPlanetData(parentPlanetBasic.planetId);
	});

	const currentPlanetMoonBasic = $derived.by(() => {
		if (isViewingMoon || !profileState.selectedPlanetId) return null;
		return profileGetters.getMoonForPlanet(profileState.selectedPlanetId);
	});

	const currentPlanetMoonFullData = $derived.by(() => {
		if (!currentPlanetMoonBasic) return null;
		return profileGetters.getFullPlanetData(currentPlanetMoonBasic.planetId);
	});

	// Derived data for rendering - main planet (parent when viewing moon, selected otherwise)
	const mainPlanetData = $derived(isViewingMoon ? parentPlanetFullData : selectedPlanetData);

	// Derived data for moon rendering (selected moon when viewing moon, planet's moon otherwise)
	const moonData = $derived(isViewingMoon ? selectedPlanetData : currentPlanetMoonFullData);

	// Determine if we should show the holographic placeholder moon
	const shouldShowDefaultMoon = $derived(
		isHomeStage() && !isViewingMoon && !moonData && profileState.selectedPlanetId
	);

	// Track current and previous planet for crossfade
	let currentPlanetId = $state<string | undefined>(undefined);
	let previousPlanetId = $state<string | undefined>(undefined);
	let previousFields = $state<number>(300);
	let previousTempMin = $state<number>(-50);
	let previousTempMax = $state<number>(50);
	let previousCelestialType = $state<'Planet' | 'Moon'>('Planet');
	let isTransitioning = $state(false);

	// Track previous moon state for camera transitions
	let wasViewingMoon = $state(false);

	$effect(() => {
		const data = selectedPlanetData;
		const newPlanetId = data?.data.planetId;

		if (newPlanetId && newPlanetId !== currentPlanetId) {
			// Store previous planet data
			if (currentPlanetId) {
				previousPlanetId = currentPlanetId;
				previousFields = data?.data.fields ?? 300;
				previousTempMin = data?.data.temperatureMin ?? -50;
				previousTempMax = data?.data.temperatureMax ?? 50;
				previousCelestialType = selectedPlanetBasic?.celestialBodyType ?? 'Planet';
			}

			// Start transition
			isTransitioning = true;

			// Update current after a delay (during crossfade)
			setTimeout(() => {
				currentPlanetId = newPlanetId;
				// End transition after both planets have crossfaded
				setTimeout(() => {
					isTransitioning = false;
				}, 900);
			}, 400);
		} else if (!currentPlanetId && newPlanetId) {
			// Initial load
			currentPlanetId = newPlanetId;
		}
	});

	$effect(() => {
		const viewingMoon = isViewingMoon;

		// Only trigger camera change if the moon view state changed
		if (viewingMoon !== wasViewingMoon) {
			// Play swoosh sound
			audioActions.playSwooshSound();

			wasViewingMoon = viewingMoon;

			// Apply appropriate camera position
			if (viewingMoon) {
				cameraActions.applyCameraForMoon();
			} else if (isHomeStage()) {
				cameraActions.applyCameraForStage('home');
			}
		}
	});
</script>

<Toast />

<PlanetSmoke />

<!-- Main Planet (always at origin) -->
<!-- When viewing a moon, show the parent planet; otherwise show the selected planet -->
<!-- Falls back to default planet when not logged in -->
{#if mainPlanetData}
	<Planet
		planetId={mainPlanetData.data.planetId}
		fieldsMax={mainPlanetData.data.fields}
		temperatureMin={mainPlanetData.data.temperatureMin}
		temperatureMax={mainPlanetData.data.temperatureMax}
		isCurrent={true}
		celestialType="Planet"
	/>
{:else}
	<!-- Default planet for non-logged-in users -->
	<Planet
		planetId="default"
		fieldsMax={300}
		temperatureMin={-50}
		temperatureMax={50}
		isCurrent={true}
		celestialType="Planet"
	/>
{/if}

<!-- Previous Planet (for crossfade) - only when switching between different planets -->
{#if isTransitioning && previousPlanetId && !isViewingMoon}
	<Planet
		planetId={previousPlanetId}
		fieldsMax={previousFields}
		temperatureMin={previousTempMin}
		temperatureMax={previousTempMax}
		isCurrent={false}
		celestialType={previousCelestialType}
	/>
{/if}

<!-- Moon behind planet (rendered when the current planet has a moon OR when viewing a moon) -->
{#if moonData}
	<T.Group position={[1.2, 3.6, -3]} scale={0.5}>
		<Planet
			planetId={moonData.data.planetId}
			fieldsMax={moonData.data.fields}
			temperatureMin={moonData.data.temperatureMin}
			temperatureMax={moonData.data.temperatureMax}
			isCurrent={true}
			celestialType="Moon"
		/>
	</T.Group>
	<!-- Render holographic placeholder if there's no moon -->
{:else}
	<T.Group position={[1.2, 3.6, -3]} scale={0.25}>
		<Planet
			planetId="default-moon"
			fieldsMax={1}
			temperatureMin={0}
			temperatureMax={0}
			isCurrent={true}
			celestialType="Moon"
			holographic={true}
		/>
	</T.Group>
{/if}

<!-- Stage Rendering -->
{#if isSettingsStage()}
	<Settings />
{:else if isHomeStage()}
	<HomeStage />
{:else if isGalaxyStage()}
	<GalaxyStage />
{/if}

{#if settingsState.general.uiVisible}
	<HUD>
		<T.PerspectiveCamera
			makeDefault
			position={[0, 0, 10]}
			oncreate={(ref) => ref.lookAt(0, 0, 0)}
			far={90}
		/>
		{#if isHomeStage() || isGalaxyStage()}
			<TopBar />
		{/if}
		{#if isHomeStage()}
			<HomeHud />
		{:else if isGalaxyStage()}
			<GalaxyHud />
		{/if}
	</HUD>
{/if}
