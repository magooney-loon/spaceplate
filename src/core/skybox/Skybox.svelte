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

	// Shadow map resolution per graphics preset. Engine-wide on purpose: this is the
	// one key light and it mounts in every scene and mode, so the preset reaches it from
	// here. Halving is a 4x cut in shadow fill; safe to change at runtime (ShadowNode
	// re-applies mapSize on every render -- see SkyLight's shadowMapSize note).
	const SHADOW_MAP_SIZE: Record<QualityLevel, number> = { high: 2048, low: 1024 };
	const shadowMapSize = $derived(SHADOW_MAP_SIZE[settingsState.graphics.quality]);

	// Precipitation budgets per preset. Count is the ONE knob that moves cost: motion is
	// closed-form in the vertex node (layers/CLAUDE.md), so the bill is rasterising tens
	// of thousands of blended quads; splashes carry two more instanced layers each. Both
	// layers bake buffers and materials ONCE at mount from these props, so a change
	// remounts them ({#key} below) -- fine for a settings click, never animate it.
	const PRECIPITATION: Record<QualityLevel, { rain: number; splashes: number; snow: number }> = {
		high: { rain: 9000, splashes: 1500, snow: 11000 },
		low: { rain: 4000, splashes: 600, snow: 5000 }
	};
	// Identity is stable per preset (a reference into the table), so keying on it is safe.
	const precipitation = $derived(PRECIPITATION[settingsState.graphics.quality]);

	// Shadow copies of everything the model can change, so the driver can tell a frame
	// that moved from one that did not. Plain variables, never reactive.
	let lastT = Number.NaN;
	const lastChannels = CHANNEL_NAMES.map(() => Number.NaN);

	// THE MODEL DRIVER (see ../CLAUDE.md). Exactly one task ticks the sky model, before
	// anything that reads the descriptor: consumers share the `before: autoRenderTask`
	// constraint and the DAG falls back to registration order, and this component
	// registers before its children -- worst case is a one-frame-stale read, invisible.
	//
	// IT ALSO OWNS THE INVALIDATION for every descriptor-only consumer: renderMode is
	// 'on-demand', so a frame is drawn only when something invalidates. Sky, SkyFog,
	// SkyLight and Moon are pure functions of the descriptor and never invalidate
	// themselves -- this task does it for them, only when the model produced different
	// numbers. Layers animated by the TSL `time` node keep their own invalidate(), gated
	// on visibility. Comparing `t` + the weather channels is sufficient: everything else
	// derives from those numbers.
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

	// The old skybox preset layer is deleted -- its values are derived outputs of the
	// day curve now. The Studio panel drives time through skyActions, the same engine
	// API a game would use.

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

	     DRAW order is the render queue + renderOrder: the dome is opaque, everything
	     else transparent, settled by renderOrder 1 (Nebula, Stars, Meteors), 2 (Moon),
	     2.2 (Birds), 2.5 (CloudDeck), 2.6 (the bolt), 3 (Rain, Snow) and 4 (the
	     lightning wash) -- the deck over the moon because a deck occludes it,
	     precipitation last because it is nearest.

	     TASK order falls back to mount order among the `before: autoRenderTask` tasks,
	     and ONE dependency lives here: Lightning publishes the flash to `flashState`
	     and CloudDeck reads it, so Lightning mounts first and the deck lights up the
	     same frame the bolt appears.

	     None of these reach the environment map: Sky bakes the dome mesh alone, so no
	     layer burns a hotspot into the ambient term. -->
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
		<!-- Remounted on preset change: counts are baked at mount (see PRECIPITATION).
		     A visible reset of the curtain, on a settings click only. -->
		{#key precipitation}
			<Rain count={precipitation.rain} splashCount={precipitation.splashes} />
			<Snow count={precipitation.snow} />
		{/key}
		<!-- Water on the lens. Mounted LAST in the group and drawn at renderOrder 10,
		     load-bearing: it reads back the framebuffer, so every layer it refracts must
		     have drawn already. Inside the group so HeightField hides it for the
		     collision pass -- a screen-space quad is not a surface rain lands on. -->
		<RainLens />
		<!-- Frost on the lens, at renderOrder 11 after RainLens: each reads back the
		     frame, so the later one composites over the earlier. Both are only live at
		     once during sleet. -->
		<SnowLens />
		<!-- Scene fog, procedural-mode only: its colour comes from the day curve, and an
		     HDR environment brings its own horizon. Renders nothing; drives scene.fog. -->
		<SkyFog />
	</T.Group>
{/if}
