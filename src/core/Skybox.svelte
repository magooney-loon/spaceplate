<script lang="ts">
	import { T } from '@threlte/core';
	import { Sky, Stars as StarsComponent, Environment, CubeEnvironment } from '@threlte/extras';

	import {
		skyboxState,
		starsState,
		skyboxPresetsState,
		skyboxActions,
		environmentState,
		ENV_TEXTURES,
		CUBE_TEXTURES
	} from '$extensions/skybox/skybox.svelte';
	import { SCENES, sceneState, scenePresetsOverrides } from '$extensions/scene/scene.svelte';

	$effect(() => {
		const override = scenePresetsOverrides[sceneState.currentScene];
		const scenePresetId =
			override && 'skybox' in override
				? (override.skybox ?? null)
				: (SCENES.find((sc) => sc.id === sceneState.currentScene)?.presets?.skybox ?? null);
		const presetId = scenePresetId ?? skyboxPresetsState.globalPresetId;
		if (presetId) skyboxActions.loadUserPreset(presetId);
	});

	const effectiveLayer1Count = $derived(Math.round(starsState.layer1Count));
	const effectiveLayer2Count = $derived(Math.round(starsState.layer2Count));

	const activeEnvTexture = $derived(
		environmentState.envTextureId
			? (ENV_TEXTURES.find((t) => t.id === environmentState.envTextureId) ?? null)
			: null
	);

	const activeCubeTexture = $derived(
		environmentState.cubeTextureId
			? (CUBE_TEXTURES.find((t) => t.id === environmentState.cubeTextureId) ?? null)
			: null
	);
</script>

<!-- Environment texture mode -->
{#if environmentState.mode === 'environment' && activeEnvTexture}
	<Environment
		url={activeEnvTexture.url}
		isBackground={environmentState.envIsBackground}
		ground={environmentState.envGround}
	/>
{:else if environmentState.mode === 'cube' && activeCubeTexture}
	<CubeEnvironment urls={activeCubeTexture.urls} isBackground={environmentState.cubeIsBackground} />
{:else}
	<!-- Procedural sky (default) -->
	<T.Group userData={{ hideInTree: true, selectable: false }}>
		<Sky
			turbidity={skyboxState.turbidity}
			rayleigh={skyboxState.rayleigh}
			azimuth={skyboxState.azimuth}
			elevation={skyboxState.elevation}
			mieCoefficient={skyboxState.mieCoefficient}
			mieDirectionalG={skyboxState.mieDirectionalG}
			setEnvironment={skyboxState.setEnvironment}
			cubeMapSize={skyboxState.cubeMapSize}
			scale={skyboxState.scale}
			userData={{ hideInTree: true, selectable: false }}
		/>
	</T.Group>

	{#if starsState.enabled && effectiveLayer1Count > 0}
		<T.Group userData={{ hideInTree: true, selectable: false }}>
			<StarsComponent
				count={effectiveLayer1Count}
				radius={starsState.radius}
				depth={starsState.depth * 0.8}
				factor={starsState.layer1Factor}
				fade={starsState.fade}
				lightness={starsState.lightness}
				opacity={starsState.opacity}
				saturation={starsState.saturation}
				speed={starsState.layer1Speed}
				userData={{ hideInTree: true, selectable: false }}
			/>
		</T.Group>
	{/if}

	{#if starsState.enabled && effectiveLayer2Count > 0}
		<T.Group userData={{ hideInTree: true, selectable: false }}>
			<StarsComponent
				count={effectiveLayer2Count}
				radius={starsState.radius}
				depth={starsState.depth * 0.6}
				factor={starsState.layer2Factor}
				fade={starsState.fade}
				lightness={starsState.lightness * 0.8}
				opacity={starsState.opacity * 0.8}
				saturation={starsState.saturation}
				speed={starsState.layer2Speed}
				userData={{ hideInTree: true, selectable: false }}
			/>
		</T.Group>
	{/if}
{/if}
