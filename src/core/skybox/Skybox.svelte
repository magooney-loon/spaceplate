<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { Environment, CubeEnvironment } from '@threlte/extras';
	import Sky from './Sky.svelte';
	import SkyFog from './SkyFog.svelte';
	import SkyLight from './SkyLight.svelte';
	import Moon from './layers/celestial/Moon.svelte';
	import Nebula from './layers/celestial/Nebula.svelte';
	import Stars from './layers/celestial/Stars.svelte';
	import Meteors from './layers/celestial/Meteors.svelte';
	import Birds from './layers/fauna/Birds.svelte';
	import Rain from './layers/precipitation/Rain.svelte';
	import RainLens from './layers/precipitation/RainLens.svelte';
	import Snow from './layers/precipitation/Snow.svelte';
	import SnowLens from './layers/precipitation/SnowLens.svelte';
	import CloudDeck from './layers/clouds/CloudDeck.svelte';
	import Lightning from './layers/lightning/Lightning.svelte';
	import HeightField from './layers/precipitation/HeightField.svelte';
	import type { Group } from 'three/webgpu';
	import { descriptor, skyActions, CHANNEL_NAMES } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';

	import { environmentState, ENV_TEXTURES, CUBE_TEXTURES } from './environment';
	import { settingsState, type QualityLevel } from '$extensions/settings';

	const { autoRenderTask, invalidate } = useThrelte();

	// Shadow map resolution per graphics preset. Engine-wide on purpose: this is the one
	// key light and it mounts in every scene and every environment mode, so the preset
	// has to reach it from here rather than from a scene.
	//
	// Halving the size is a 4x cut in shadow fill, and it is safe to change at runtime on
	// this renderer: three's ShadowNode.renderShadow() re-applies shadow.mapSize with
	// shadowMap.setSize() on EVERY shadow render, and the backend reallocates the depth
	// attachment when the size differs. (The old "dispose the map and null it" dance is a
	// WebGLRenderer-only caveat — that path never re-read mapSize.) SkyLight arms
	// shadow.needsUpdate every frame, so the new size lands on the next rendered frame.
	const SHADOW_MAP_SIZE: Record<QualityLevel, number> = { high: 2048, low: 1024 };
	const shadowMapSize = $derived(SHADOW_MAP_SIZE[settingsState.graphics.quality]);

	// Precipitation budgets per preset. The count is the ONE knob that moves what rain and
	// snow actually cost: their motion is closed-form in the vertex node and costs nothing
	// per drop (layers/CLAUDE.md), so the bill is rasterising tens of thousands of
	// transparent, blended quads. Splashes are counted separately because each one carries
	// two more instanced layers (ring + burst).
	//
	// Both layers bake their instance buffers, per-particle randoms and materials ONCE at
	// mount from these props, so a change has to remount them — hence the {#key} below.
	// That is a rebuild plus a shader compile: fine for a settings click, never something
	// to animate.
	const PRECIPITATION: Record<QualityLevel, { rain: number; splashes: number; snow: number }> = {
		high: { rain: 9000, splashes: 1500, snow: 11000 },
		low: { rain: 4000, splashes: 600, snow: 5000 }
	};
	// Identity is stable per preset (it is a reference into the table above), which is what
	// makes it safe to key on.
	const precipitation = $derived(PRECIPITATION[settingsState.graphics.quality]);

	// Shadow copies of everything the model can change, so the driver can tell a frame
	// that moved from one that did not. Plain variables, never reactive -- see §14.1.
	let lastT = Number.NaN;
	const lastChannels = CHANNEL_NAMES.map(() => Number.NaN);

	// THE MODEL DRIVER. Exactly one task ticks the sky model, and it must run before
	// anything that reads the descriptor. Both consumers (Sky's env task, SkyLight's
	// light task) are also `before: autoRenderTask`, and among tasks sharing a
	// constraint Threlte's DAG falls back to registration order -- this component
	// registers before its own children, so the ordering holds by construction.
	// Worst case if that ever changed: a consumer reads a one-frame-stale descriptor,
	// which is invisible. See DOCS/weather-system.md §18 q1.
	//
	// IT ALSO OWNS THE INVALIDATION FOR EVERY DESCRIPTOR-ONLY CONSUMER. Threlte's
	// `renderMode` defaults to 'on-demand' and the <Canvas> in App.svelte does not
	// override it, so a frame is only drawn when something calls `invalidate()`. Every
	// sky layer used to call it unconditionally, every frame, which quietly turned the
	// whole app into 'always' -- including at the boot default, which is a MANUAL clock
	// at timeScale 0 (sky.svelte.ts). A menu sitting on a frozen sunset rendered at full
	// rate to produce identical frames.
	//
	// The split is now by what actually animates. Sky, SkyFog, SkyLight and Moon are
	// pure functions of the descriptor, so they no longer invalidate at all -- this task
	// does it for them, and only when the model produced different numbers. The layers
	// that run off the TSL `time` node (Stars, Nebula, Meteors, CloudDeck, Rain, Snow)
	// keep their own `invalidate()`, gated on being visible at all. Lightning gates on a
	// live strike, as it always did.
	//
	// Comparing `t` and the six weather channels is sufficient: sun, moon, the sampled
	// baseline and every light hint derive from exactly those seven numbers.
	useTask(
		(delta) => {
			skyActions.tick(delta * 1000);

			let moved = descriptor.meta.t !== lastT;
			lastT = descriptor.meta.t;
			for (let i = 0; i < CHANNEL_NAMES.length; i++) {
				const value = descriptor.weather[CHANNEL_NAMES[i]];
				if (value !== lastChannels[i]) moved = true;
				lastChannels[i] = value;
			}

			if (moved) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

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

	// Handed to HeightField so it can hide the whole sky for the duration of its pass --
	// the dome, the celestial layers AND the precipitation itself, none of which is a
	// surface rain should land on. See HeightField.svelte.
	let skyGroup = $state.raw<Group>();
</script>

<!-- The key light is descriptor-driven and mounts in every mode: an HDR or cubemap
     environment still needs a sun. Shadow resolution follows the graphics preset. -->
<SkyLight {shadowMapSize} />

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
	     between themselves by renderOrder 1 (Nebula, Stars, Meteors), 2 (Moon), 2.2
	     (Birds -- below the deck, in front of the moon), 2.5 (CloudDeck), 2.6 (the
	     lightning bolt), 3 (Rain, Snow) and 4 (the lightning wash, very faint). The deck
	     sits over the moon because a cloud deck occludes it; the precipitation draws last
	     because it is nearest.

	     TASK order falls back to mount order among the `before: autoRenderTask` tasks,
	     and ONE dependency lives here: Lightning publishes the flash to `flashState`, and
	     CloudDeck reads it, so Lightning mounts first and the deck lights up the same
	     frame the bolt appears. A swapped order would cost one stale frame -- invisible,
	     but free to get right.

	     None of these reach the environment map: Sky bakes by passing the dome mesh
	     alone to CubeCamera.update(), so neither the smoke, the deck, the moon nor a
	     lightning flash burns a hotspot into the ambient term the way the sun disc
	     would. -->
	<!-- The precipitation height field. Mounted OUTSIDE the group it hides, and before it,
	     so its pass has run by the time Rain and Snow read the map. Renders nothing
	     itself. -->
	<HeightField exclude={() => skyGroup} />

	<T.Group bind:ref={skyGroup} userData={SKY_LAYER_USERDATA}>
		<Sky setEnvironment={true} cubeMapSize={128} scale={1000} />
		<Nebula radius={1000} />
		<Stars radius={1000} />
		<Meteors radius={1000} />
		<Moon radius={1000} />
		<Birds />
		<Lightning />
		<CloudDeck radius={1000} />
		<!-- Remounted when the graphics preset changes: the counts are baked at mount (see
		     PRECIPITATION above). Both layers dispose their geometries and materials on
		     unmount, and their accumulators restart — a visible reset of the curtain, on a
		     settings click only. -->
		{#key precipitation}
			<Rain count={precipitation.rain} splashCount={precipitation.splashes} />
			<Snow count={precipitation.snow} />
		{/key}
		<!-- Water on the lens. Mounted LAST in the group and drawn at renderOrder 10, which
		     is load-bearing rather than tidy: it reads back the framebuffer, so every layer
		     whose output it is supposed to refract has to have drawn already. Being inside
		     this group also means HeightField hides it for the collision pass, which is
		     what it wants -- a screen-space quad is not a surface rain can land on. -->
		<RainLens />
		<!-- Frost on the lens, the snow counterpart. Drawn at renderOrder 11, after RainLens,
		     for the same reason RainLens sits above the sky: each reads back the frame, so
		     the later one composites over the earlier. Both are only ever live at once
		     during sleet. -->
		<SnowLens />
		<!-- Scene fog. Mounted only in procedural mode because its colour comes from the
		     day curve, which is the procedural sky's authored look -- an HDR environment
		     brings its own horizon and would fight it. Renders nothing itself; it drives
		     scene.fog, so its position in the group is immaterial. -->
		<SkyFog />
	</T.Group>
{/if}
