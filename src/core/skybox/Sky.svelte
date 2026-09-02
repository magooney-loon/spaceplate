<script lang="ts">
	// WebGPU-native procedural sky. Replaces @threlte/extras' <Sky>, which wraps
	// three/examples/jsm/objects/Sky.js -- a raw ShaderMaterial. NodeLibrary has no
	// ShaderMaterial mapping, so on WebGPURenderer that sky is silently swapped for a
	// blank NodeMaterial and renders wrong. SkyMesh is three's NodeMaterial/TSL port of
	// the same Preetham model. See DOCS/webgpu-notes.md §1.
	//
	// This component is now a pure CONSUMER of the sky descriptor's `sky` + `sun`
	// slices (DOCS/weather-system.md §15.1). It reads a plain object in a task -- there
	// is no reactive prop plumbing and no $effect, so no cycle can form.
	import { T, useThrelte, useTask } from '@threlte/core/webgpu';
	import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
	import * as THREE from 'three/webgpu';
	import { clamp01, descriptor, lerp, skyActions } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';

	interface Props {
		setEnvironment?: boolean;
		cubeMapSize?: number;
		scale?: number;
		/** Minimum wall-clock ms between environment re-bakes. */
		envIntervalMs?: number;
		/** Re-bake early once the sun has moved this many degrees since the last one. */
		envSunDeltaDeg?: number;
		/**
		 * `scene.environmentIntensity` for the baked dome. THIS IS NOT A STYLE KNOB either --
		 * without it the sky is the only thing lighting the scene.
		 *
		 * SkyMesh's output is authored to be looked AT under a tone-mapping exposure, not to
		 * be integrated as an IBL, and its absolute scale (`EE = 1000`, then `* 0.04`) is
		 * arbitrary. Fed to `scene.environment` raw it buries the key light. Measured, by
		 * integrating the dome's radiance against a cosine lobe -- the same quantity three's
		 * `getIBLIrradiance` returns -- for an up-facing normal under a clear sky:
		 *
		 *   time      sky irradiance   key light   key's share of the light on flat ground
		 *   sunrise            0.121       0.003     2.8%
		 *   golden am          1.204       0.021     1.7%
		 *   noon               5.031       0.745    12.9%
		 *
		 * A shadow at noon therefore rendered rgb(102,136,223) against a lit rgb(111,141,225)
		 * -- a 4% difference, i.e. no directional lighting in the scene at any hour, plus a
		 * heavy blue cast (noon irradiance was [1.78, 5.19, 13.08], a 7:1 blue:red).
		 *
		 * 0.25 puts the key back in charge without making the ambient a hard black: shadow
		 * over lit lands at 0.27-0.33 through the day and 0.10-0.15 at night.
		 *
		 * IT IS PAIRED WITH `SUN_INTENSITY` in the model. Lowering this alone darkens every
		 * daylit scene; the sun constant was raised to absorb exactly what this removes.
		 * Move them together or re-measure. Do NOT compensate with the day curve's exposure
		 * -- that is renderer-global, so it drags the dome up with the scene and the sky
		 * blows out (the noon horizon tone-mapped past white even at the old 0.78, which is
		 * why the daylight keyframes now sit around 0.65).
		 */
		environmentIntensity?: number;
		/**
		 * Ceiling on SkyMesh's `cloudCoverage` uniform. THIS IS NOT A STYLE KNOB -- see the
		 * cloud mapping in the task below. Past ~0.6 the cloud mask saturates to 1 across the
		 * entire dome and the clouds become invisible, so the weather channel is remapped
		 * into a band that always renders as cloud.
		 */
		maxCloudCoverage?: number;
		/** Exponent on the coverage remap. Below 1 it spends more of the channel's range low. */
		cloudCoverageCurve?: number;
		/** SkyMesh `cloudDensity` at zero and at full weight -- how opaque the clouds read. */
		cloudDensityRange?: [number, number];
		/** SkyMesh `cloudElevation` at zero and at full weight -- how low the deck sits. */
		cloudElevationRange?: [number, number];
	}

	let {
		setEnvironment = true,
		cubeMapSize = 128,
		scale = 1000,
		envIntervalMs = 250,
		envSunDeltaDeg = 1,
		environmentIntensity = 0.25,
		maxCloudCoverage = 0.52,
		cloudCoverageCurve = 0.42,
		cloudDensityRange = [0.45, 0.97],
		cloudElevationRange = [0.6, 1]
	}: Props = $props();

	const { scene, renderer, autoRenderTask } = useThrelte();

	const sky = new SkyMesh();
	// The dome sits at radius 1000 while scene fog is tuned for a 144-unit far plane, so
	// any exponential fog at all would resolve the entire sky to a flat fog colour. The
	// sky is what the fog is a haze *toward*, never something the fog is applied to --
	// which is exactly why the day curve authors `fogColor` per keyframe.
	(sky.material as THREE.NodeMaterial).fog = false;
	const sunPosition = new THREE.Vector3();
	const originalEnvironment = scene.environment;
	const originalEnvironmentIntensity = scene.environmentIntensity;
	// toneMappingExposure is renderer-global. This component drives it from the day
	// curve while it is mounted, so it has to hand it back on unmount -- otherwise
	// switching to the HDR or cubemap mode leaves the renderer stuck on whatever
	// exposure the sky happened to want at that instant (e.g. 0.62 at midnight).
	const originalExposure = renderer.toneMappingExposure;

	// CubeRenderTarget is the WebGPU-native cube target (three/webgpu). It carries the
	// same texture.generateMipmaps / needsPMREMUpdate surface CubeCamera touches, so it
	// drops straight in where WebGLCubeRenderTarget would have gone.
	let renderTarget: THREE.CubeRenderTarget | undefined;
	let cubeCamera: THREE.CubeCamera | undefined;

	const initEnvironmentTarget = (size: number) => {
		renderTarget?.dispose();
		renderTarget = new THREE.CubeRenderTarget(size, {
			type: THREE.HalfFloatType,
			generateMipmaps: true,
			minFilter: THREE.LinearMipmapLinearFilter
		});
		// CubeCamera.update() branches on renderer.coordinateSystem and explicitly
		// supports WebGPU's Renderer, so this path works on both backends.
		cubeCamera = new THREE.CubeCamera(1, 1.1, renderTarget as never);
	};

	// Plain variables, not $state: they are written and read by the task only. Making
	// them reactive would recreate the self-invalidating cycle phase 1 removed.
	let activeCubeMapSize = 0;
	let msSinceBake = Infinity;
	let hasBaked = false;
	let lastBakeElevation = 0;
	let lastBakeAzimuth = 0;
	let lastBakeCloudCover = 0;

	// THE TRAP (DOCS/weather-system.md §15.2): the old code re-baked the env cube
	// whenever a sky parameter changed. That was correct for a static sky and ruinous
	// for a moving one -- at 60x time scale it is a full cube bake every frame. The
	// bake is now on a budget: at most one per envIntervalMs, or earlier if the sun has
	// swung more than envSunDeltaDeg. The descriptor stays fresh every frame; only this
	// expensive derivative of it steps.
	const shouldBake = (deltaMs: number): boolean => {
		msSinceBake += deltaMs;

		// A time scrub or clock swap must land immediately, not on the next interval.
		if (skyActions.consumeDiscontinuity()) return true;
		if (!hasBaked || activeCubeMapSize !== cubeMapSize) return true;

		const dElevation = Math.abs(descriptor.sun.elevation - lastBakeElevation);
		// Azimuth is cyclic: a raw difference reads 359 degrees as the sun crosses due
		// north, which would force a bake on a movement of one.
		const dAzimuth = Math.abs(((descriptor.sun.azimuth - lastBakeAzimuth + 540) % 360) - 180);
		if (dElevation > envSunDeltaDeg || dAzimuth > envSunDeltaDeg) return true;

		// Nothing that feeds the dome has moved since the last bake, so the interval has
		// nothing to deliver. Without this a FROZEN sky -- which is the boot default, a
		// manual clock at timeScale 0 -- re-baked six identical cube faces every 250 ms
		// forever. Cloud coverage is in the comparison because it is a dome uniform too.
		if (
			dElevation === 0 &&
			dAzimuth === 0 &&
			descriptor.weather.cloudCover === lastBakeCloudCover
		) {
			return false;
		}

		return msSinceBake >= envIntervalMs;
	};

	// Ordered before the render so a changed sky reaches the environment map in the
	// same frame. CubeCamera.update() saves and restores the active render target, so
	// it can safely run inside the render stage.
	useTask(
		(delta) => {
			const { sky: baseline, sun } = descriptor;

			// Uniform writes are free and trigger no recompile, so the dome tracks the
			// descriptor every frame regardless of the environment budget.
			sky.scale.setScalar(scale);
			sky.turbidity.value = baseline.turbidity;
			sky.rayleigh.value = baseline.rayleigh;
			sky.mieCoefficient.value = baseline.mieCoefficient;
			sky.mieDirectionalG.value = baseline.mieDirectionalG;
			sunPosition.set(sun.direction.x, sun.direction.y, sun.direction.z);
			sky.sunPosition.value.copy(sunPosition);

			// CLOUDS. All three uniforms are weather-driven, and the coverage one is REMAPPED
			// rather than passed straight through. That remap is load-bearing.
			//
			// SkyMesh builds its cloud mask as
			//     smoothstep(1 - coverage, 1 - coverage + 0.3, cloudNoise)
			// and `cloudNoise` is a 5-octave fbm rescaled to `n * 0.5 + 0.5`, which puts it at
			// mean 0.833, sd 0.088 and -- crucially -- a hard MINIMUM of 0.584. Sampled over
			// the dome:
			//
			//   coverage 0.27  mask mean 0.35, sd 0.29   27% clear gaps   <- most structure
			//   coverage 0.37  mask mean 0.70, sd 0.31    7% clear gaps   <- the three.js demo
			//   coverage 0.52  mask mean 0.96, sd 0.13    0% clear gaps
			//   coverage 0.70+ mask IDENTICALLY 1, sd 0   no clouds visible at all
			//
			// Above ~0.6 every sample clears the upper edge of the smoothstep, so the mask is
			// a constant 1 and the dome is uniformly blended to `cloudColor` -- which is
			// scaled by `vSunE * 0.00002` and therefore nearly black at low sun. Passing the
			// channel through raw meant `rain` (0.8), `snow` (0.9) and `storm` (1.0) rendered
			// as a flat, cloudless, slightly darker sky. They looked CLEARER than `cloudy`.
			//
			// So the semantic channel (0 = clear, 1 = solid storm) is remapped into the band
			// that actually draws clouds, and "heavier weather" is expressed through density
			// and a lower deck rather than through coverage it cannot use. At full weight
			// this lands on density 0.97 / elevation 1.0, the values three's own Sky demo
			// uses for its dramatic overcast.
			const cover = clamp01(descriptor.weather.cloudCover);
			// cloudType leans the look toward heavy stratus/storm towers, giving that channel
			// its first actual job.
			const heaviness = clamp01(cover * 0.75 + clamp01(descriptor.weather.cloudType) * 0.25);
			// Exactly 0 short-circuits SkyMesh's whole cloud branch, so `clear` is an empty sky.
			sky.cloudCoverage.value =
				cover <= 0 ? 0 : maxCloudCoverage * Math.pow(cover, cloudCoverageCurve);
			sky.cloudDensity.value = lerp(cloudDensityRange[0], cloudDensityRange[1], heaviness);
			sky.cloudElevation.value = lerp(cloudElevationRange[0], cloudElevationRange[1], heaviness);

			// WIND IS DELIBERATELY NOT BOUND TO cloudSpeed, even though it is the obvious
			// target. SkyMesh scrolls its cloud plane with `cloudUV += time * cloudSpeed`,
			// so the offset is proportional to ABSOLUTE elapsed time. Changing the speed
			// therefore teleports the pattern by `elapsed * delta_speed` -- a barely visible
			// hitch a few seconds in, a total scramble of the sky an hour into a session.
			// There is no offset uniform to compensate with. Driving cloud motion from wind
			// needs a cloud layer that accumulates its own offset, which is phase 4's
			// problem (DOCS/weather-system.md §17).

			// The curve's exposure drives the renderer's tone-mapping exposure -- the
			// classic three.js sky pattern (SkyMesh has no exposure uniform of its own).
			// This task is its single owner: nothing else writes toneMappingExposure, and
			// the tone-mapping MODE stays Threlte's (set from the <Canvas> option).
			renderer.toneMappingExposure = baseline.exposure;

			// No invalidate() here. The dome is a pure function of the descriptor, so the
			// driver task in Skybox.svelte invalidates whenever the model actually moved
			// -- which is the only time any of these writes produce a different frame.
			// See the note there on Threlte's 'on-demand' renderMode.

			if (!setEnvironment) {
				scene.environment = originalEnvironment;
				scene.environmentIntensity = originalEnvironmentIntensity;
				return;
			}

			// Written every frame rather than only on a bake, so the prop stays live. It is a
			// plain number three tracks as a uniform (NodeMaterialObserver), so an unchanged
			// value costs nothing and a changed one triggers no recompile.
			scene.environmentIntensity = environmentIntensity;

			if (!shouldBake(delta * 1000)) return;

			if (!renderTarget || !cubeCamera || activeCubeMapSize !== cubeMapSize) {
				initEnvironmentTarget(cubeMapSize);
				activeCubeMapSize = cubeMapSize;
			}

			// Hiding the solar disc avoids a blown-out hotspot baked into the env map.
			sky.showSunDisc.value = 0;
			cubeCamera!.update(renderer, sky as unknown as THREE.Scene);
			sky.showSunDisc.value = 1;

			scene.environment = renderTarget!.texture;
			hasBaked = true;
			msSinceBake = 0;
			lastBakeElevation = sun.elevation;
			lastBakeAzimuth = sun.azimuth;
			lastBakeCloudCover = descriptor.weather.cloudCover;
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			scene.environment = originalEnvironment;
			scene.environmentIntensity = originalEnvironmentIntensity;
			renderer.toneMappingExposure = originalExposure;
			renderTarget?.dispose();
			sky.geometry.dispose();
			(sky.material as THREE.Material).dispose();
		};
	});
</script>

<T is={sky} userData={SKY_LAYER_USERDATA} />
