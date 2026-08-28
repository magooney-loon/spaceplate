<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { Environment, CubeEnvironment } from '@threlte/extras';
	import Sky from './Sky.svelte';

	import { skyboxState, environmentState, ENV_TEXTURES, CUBE_TEXTURES } from '$extensions/skybox';

	// REMOVED: the scene/global skybox preset-resolution $effect that used to live here.
	// It called skyboxActions.loadUserPreset() from inside an effect, which reaches
	// applyPresetObject() -- and that function READS transitionState.transitionDuration
	// and then WRITES transitionState.isTransitioning. Reading and writing the same
	// state inside one effect is an unconditional infinite loop, and it was a direct
	// cause of the effect_update_depth_exceeded crash.
	//
	// Nothing is lost: every bundled preset list is currently empty, and the whole
	// preset layer is replaced by the time-driven sky. See DOCS/weather-system.md §10.

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
		/>
	</T.Group>

	<!-- Stars are intentionally absent: @threlte/extras' <Stars> builds a raw
	     ShaderMaterial and cannot render on WebGPU (DOCS/webgpu-notes.md §1).
	     starsState is left in place for now because sky presets embed star presets,
	     and that whole preset layer is replaced by the time-driven sky -- rewiring it
	     here would be thrown away. Star rendering returns as TSL point sprites:
	     DOCS/weather-system.md §15.4. -->
{/if}
