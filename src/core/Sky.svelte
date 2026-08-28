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
	import { descriptor, skyActions } from './sky';

	interface Props {
		setEnvironment?: boolean;
		cubeMapSize?: number;
		scale?: number;
		/** Minimum wall-clock ms between environment re-bakes. */
		envIntervalMs?: number;
		/** Re-bake early once the sun has moved this many degrees since the last one. */
		envSunDeltaDeg?: number;
	}

	let {
		setEnvironment = true,
		cubeMapSize = 128,
		scale = 1000,
		envIntervalMs = 250,
		envSunDeltaDeg = 1
	}: Props = $props();

	const { scene, renderer, invalidate, autoRenderTask } = useThrelte();

	const sky = new SkyMesh();
	const sunPosition = new THREE.Vector3();
	const originalEnvironment = scene.environment;

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
	let lastBakeElevation = Infinity;
	let lastBakeAzimuth = Infinity;

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
		if (activeCubeMapSize !== cubeMapSize) return true;

		const dElevation = Math.abs(descriptor.sun.elevation - lastBakeElevation);
		const dAzimuth = Math.abs(descriptor.sun.azimuth - lastBakeAzimuth);
		if (dElevation > envSunDeltaDeg || dAzimuth > envSunDeltaDeg) return true;

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

			// The curve's exposure drives the renderer's tone-mapping exposure -- the
			// classic three.js sky pattern (SkyMesh has no exposure uniform of its own).
			// This task is its single owner: nothing else writes toneMappingExposure, and
			// the tone-mapping MODE stays Threlte's (set from the <Canvas> option).
			renderer.toneMappingExposure = baseline.exposure;
			invalidate();

			if (!setEnvironment) {
				scene.environment = originalEnvironment;
				return;
			}

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
			msSinceBake = 0;
			lastBakeElevation = sun.elevation;
			lastBakeAzimuth = sun.azimuth;
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			scene.environment = originalEnvironment;
			renderTarget?.dispose();
			sky.geometry.dispose();
			(sky.material as THREE.Material).dispose();
		};
	});
</script>

<T is={sky} userData={{ hideInTree: true, selectable: false }} />
