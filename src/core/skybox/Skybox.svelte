<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { Environment, CubeEnvironment } from '@threlte/extras';
	import Sky from './Sky.svelte';
	import SkyFog from './SkyFog.svelte';
	import SkyLight from './SkyLight.svelte';
	import Moon from './Moon.svelte';
	import Nebula from './Nebula.svelte';
	import Stars from './Stars.svelte';
	import Meteors from './Meteors.svelte';
	import Rain from './Rain.svelte';
	import Snow from './Snow.svelte';
	import CloudDeck from './CloudDeck.svelte';
	import Lightning from './Lightning.svelte';
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

	     Two orders live in this group and they are different things:

	     DRAW order is decided by the render queue + renderOrder: the dome is opaque while
	     everything else is transparent, so all of it lands in the later queue, settled
	     between themselves by renderOrder 1 (Nebula, Stars, Meteors), 2 (Moon), 2.5
	     (CloudDeck), 2.6 (the lightning bolt), 3 (Rain, Snow) and 4 (the lightning wash,
	     very faint). The deck sits over the moon because a cloud deck occludes it; the
	     precipitation draws last because it is nearest.

	     TASK order falls back to mount order among the `before: autoRenderTask` tasks,
	     and ONE dependency lives here: Lightning publishes the flash to `flashState`, and
	     CloudDeck reads it, so Lightning mounts first and the deck lights up the same
	     frame the bolt appears. A swapped order would cost one stale frame -- invisible,
	     but free to get right.

	     None of these reach the environment map: Sky bakes by passing the dome mesh
	     alone to CubeCamera.update(), so neither the smoke, the deck, the moon nor a
	     lightning flash burns a hotspot into the ambient term the way the sun disc
	     would. -->
	<T.Group userData={{ hideInTree: true, selectable: false }}>
		<Sky setEnvironment={true} cubeMapSize={128} scale={1000} />
		<Nebula radius={1000} />
		<Stars radius={1000} />
		<Meteors radius={1000} />
		<Moon radius={1000} />
		<Lightning />
		<CloudDeck radius={1000} />
		<Rain />
		<Snow />
		<!-- Scene fog. Mounted only in procedural mode because its colour comes from the
		     day curve, which is the procedural sky's authored look -- an HDR environment
		     brings its own horizon and would fight it. Renders nothing itself; it drives
		     scene.fog, so its position in the group is immaterial. -->
		<SkyFog />
	</T.Group>
{/if}
