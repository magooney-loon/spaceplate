<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { Environment, CubeEnvironment } from '@threlte/extras';
	import Sky from './Sky.svelte';
	import SkyLight from './SkyLight.svelte';
	import { skyActions } from './sky';

	import { environmentState, ENV_TEXTURES, CUBE_TEXTURES } from '$extensions/skybox';

	const { autoRenderTask } = useThrelte();

	// THE MODEL DRIVER. Exactly one task ticks the sky model, and it must run before
	// anything that reads the descriptor. Both consumers (Sky's env task, SkyLight's
	// light task) are also `before: autoRenderTask`, and among tasks sharing a
	// constraint Threlte's DAG falls back to registration order -- this component
	// registers before its own children, so the ordering holds by construction.
	// Worst case if that ever changed: a consumer reads a one-frame-stale descriptor,
	// which is invisible. See DOCS/weather-system.md §18 q1.
	useTask((delta) => skyActions.tick(delta * 1000), {
		before: autoRenderTask,
		autoInvalidate: false
	});

	// The old skybox preset layer (skyboxState scalars, stars, transitions) is deleted;
	// those values are derived outputs of the day curve now. The extension keeps only
	// the environment-mode state still read below, and its Studio panel drives time
	// through skyActions -- the same engine API a game would use (§8). See
	// DOCS/weather-system.md §10.

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

<!-- The key light is descriptor-driven and mounts in every mode: an HDR or cubemap
     environment still needs a sun. -->
<SkyLight />

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
		<Sky setEnvironment={true} cubeMapSize={128} scale={1000} />
	</T.Group>

	<!-- Stars are intentionally absent: @threlte/extras' <Stars> builds a raw
	     ShaderMaterial and cannot render on WebGPU (DOCS/webgpu-notes.md §1).
	     The descriptor already carries sky.starVisibility; the renderer behind it is a
	     TSL point-sprite field and is separate work. See weather-system.md §15.4. -->
{/if}
