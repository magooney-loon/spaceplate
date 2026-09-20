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
	/* 	import Birds from './layers/fauna/Birds.svelte'; */
	import Rain from './layers/precipitation/Rain.svelte';
	import RainCurtains from './layers/precipitation/RainCurtains.svelte';
	import Snow from './layers/precipitation/Snow.svelte';
	import LensDriver from './layers/precipitation/LensDriver.svelte';
	import WetnessDriver from './layers/precipitation/WetnessDriver.svelte';
	import CloudDeck from './layers/clouds/CloudDeck.svelte';
	import Lightning from './layers/lightning/Lightning.svelte';
	import HeightField from './layers/precipitation/HeightField.svelte';
	import DustMotes from './layers/atmosphere/DustMotes.svelte';
	import type { Group } from 'three/webgpu';
	import { descriptor, skyActions, CHANNEL_NAMES } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';

	import { environmentState, ENV_TEXTURES, CUBE_TEXTURES } from './environment';
	import { settingsState, type QualityLevel } from '$extensions/settings';

	const { autoRenderTask, invalidate } = useThrelte();

	// Shadow map resolution PER CASCADE, per graphics preset -- the key light is a
	// SunLight and its two cascades share an atlas twice this wide. Engine-wide on
	// purpose: this is the one key light and it mounts in every scene and mode, so the
	// preset reaches it from here. Halving is a 4x cut in shadow fill; safe to change at
	// runtime (the shadow node re-applies the atlas size on every render -- see
	// SkyLight's shadowMapSize note).
	const SHADOW_MAP_SIZE: Record<QualityLevel, number> = { high: 2048, low: 1024 };
	const shadowMapSize = $derived(SHADOW_MAP_SIZE[settingsState.graphics.quality]);

	// Precipitation budgets per preset. Count is the ONE knob that moves cost: motion is
	// closed-form in the vertex node (layers/CLAUDE.md), so the bill is rasterising tens
	// of thousands of blended quads; splashes carry two more instanced layers each. Both
	// layers bake buffers and materials ONCE at mount from these props, so a change
	// remounts them ({#key} below) -- fine for a settings click, never animate it.
	// Snow's counts came DOWN with its box (Snow.svelte's `width`): what reads is
	// flakes per unit3 near the camera, and the old box spent a third of the field on
	// 2-pixel flakes 25-45 units out.
	const PRECIPITATION: Record<QualityLevel, { rain: number; splashes: number; snow: number }> = {
		high: { rain: 9000, splashes: 1500, snow: 7000 },
		low: { rain: 4000, splashes: 600, snow: 3200 }
	};
	// Identity is stable per preset (a reference into the table), so keying on it is safe.
	const precipitation = $derived(PRECIPITATION[settingsState.graphics.quality]);

	// The precipitation height field's resolution, per preset (heightField.ts's
	// `HEIGHT_MAP_SIZE` note: more resolution buys sharper object edges and nothing
	// else, which is exactly what a splash landing a texel inside a barrier needs).
	// Cheap either way -- the pass runs a few times a second at most, and only while
	// something is falling -- so this is a smaller cut than the shadow map's, safe to
	// resize at runtime the same way (`setHeightMapSize`'s note).
	const HEIGHT_FIELD_SIZE: Record<QualityLevel, number> = { high: 320, low: 192 };
	const heightFieldSize = $derived(HEIGHT_FIELD_SIZE[settingsState.graphics.quality]);

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

<!-- Ground water, and the second thing here that mounts in EVERY environment mode. It
     renders nothing: it integrates the film and the pooling that every material patched
     with `applyWetness()` reads. Outside the procedural group on purpose — a scene's
     materials go on being rendered whatever is in the sky, so a driver that unmounted
     with the sky would freeze them and then have to dump the whole floor's albedo in one
     frame on teardown. Same reasoning that puts the weather audio outside the layers. -->
<WetnessDriver />

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
	     2.2 (Birds), 2.5 (CloudDeck), 2.55 (RainCurtains — below the deck they fall
	     from, in front of the bolt's own plane), 2.6 (the bolt), 3 (Rain streaks,
	     Snow), 3.1 (Rain rings), 3.2 (Rain burst), 3.25 (Rain near field), 3.3 (Dust
	     Motes) and 4 (the lightning wash) -- the deck over the moon because a deck
	     occludes it, near-camera layers last because they are nearest.

	     TASK order falls back to mount order among the `before: autoRenderTask` tasks,
	     and the dependencies that live here all point the same way: Lightning publishes
	     the flash to `flashState` and CloudDeck, RainCurtains and Rain all read it, so
	     Lightning mounts first and every one of them lights up in the same frame the
	     bolt appears.

	     None of these reach the environment map: Sky bakes the dome mesh alone, so no
	     layer burns a hotspot into the ambient term. -->
	<!-- The precipitation height field. Mounted OUTSIDE the group it hides, and before it,
	     so its pass has run by the time Rain and Snow read the map. Renders nothing
	     itself. -->
	<HeightField exclude={() => skyGroup} mapSize={heightFieldSize} />

	<T.Group bind:ref={skyGroup} userData={SKY_LAYER_USERDATA}>
		<Sky setEnvironment={true} cubeMapSize={128} scale={1000} />
		<Nebula radius={1000} />
		<Stars radius={1000} />
		<Meteors radius={1000} />
		<Moon radius={1000} />
		<!-- <Birds /> -->
		<Lightning />
		<CloudDeck radius={1000} />
		<!-- Distant rain, as a veil on the horizon band rather than as particles: the
		     storm's geography, which the camera-boxed Rain layer cannot express at any
		     count. Outside the {#key} below because it bakes no counts — it is one
		     cylinder and a shader, so a preset change has nothing to reset. -->
		<RainCurtains radius={1000} />
		<!-- Remounted on preset change: counts are baked at mount (see PRECIPITATION).
		     A visible reset of the curtain, on a settings click only. -->
		{#key precipitation}
			<Rain count={precipitation.rain} splashCount={precipitation.splashes} />
			<Snow count={precipitation.snow} />
		{/key}
		<!-- Sparse, near-camera, backlit only -- see layers/CLAUDE.md's `atmosphere/`
		     family note and the component header for why this is neither precipitation
		     nor a dome layer. -->
		<DustMotes />
		<!-- The CPU half of both lens effects. Renders NOTHING -- the lenses themselves are
		     post-processing chain effects now (rainLens.ts / snowLens.ts); this measures the
		     camera and the weather and writes the uniforms they read. It is here, inside the
		     group, so the lenses follow the environment mode exactly as the old meshes did:
		     no procedural sky, no driver, no wet glass. See lensState.svelte.ts. -->
		<LensDriver />
		<!-- Scene fog, procedural-mode only: its colour comes from the day curve, and an
		     HDR environment brings its own horizon. Renders nothing; drives scene.fog. -->
		<SkyFog />
	</T.Group>
{/if}
