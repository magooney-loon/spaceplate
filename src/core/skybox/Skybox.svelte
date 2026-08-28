<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { Environment, CubeEnvironment } from '@threlte/extras';
	import Sky from './Sky.svelte';
	import SkyLight from './SkyLight.svelte';
	import Moon from './Moon.svelte';
	import Nebula from './Nebula.svelte';
	import Stars from './Stars.svelte';
	import { skyActions } from './model';

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
	<!-- Procedural sky (default).

	     Order inside the group is cosmetic; what actually decides draw order is that the
	     dome is opaque while Nebula, Stars and Moon are transparent, so all three land in
	     the later queue, with renderOrder 1 (Nebula, Stars) and 2 (Moon) settling them
	     between themselves.

	     None of these reach the environment map: Sky bakes by passing the dome
	     mesh alone to CubeCamera.update(), so neither the smoke nor the moon burns a
	     hotspot into the ambient term the way the sun disc would. -->
	<T.Group userData={{ hideInTree: true, selectable: false }}>
		<Sky setEnvironment={true} cubeMapSize={128} scale={1000} />
		<Nebula radius={1000} />
		<Stars radius={1000} />
		<Moon radius={1000} />
	</T.Group>
{/if}
