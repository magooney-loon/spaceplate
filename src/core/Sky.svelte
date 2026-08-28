<script lang="ts">
	// WebGPU-native procedural sky. Replaces @threlte/extras' <Sky>, which wraps
	// three/examples/jsm/objects/Sky.js -- a raw ShaderMaterial. NodeLibrary has no
	// ShaderMaterial mapping, so on WebGPURenderer that sky is silently swapped for a
	// blank NodeMaterial and renders wrong. SkyMesh is three's NodeMaterial/TSL port of
	// the same Preetham model. See DOCS/webgpu-notes.md §1.
	import { T, useThrelte, useTask } from '@threlte/core/webgpu';
	import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
	import * as THREE from 'three/webgpu';

	interface Props {
		turbidity?: number;
		rayleigh?: number;
		azimuth?: number;
		elevation?: number;
		mieCoefficient?: number;
		mieDirectionalG?: number;
		setEnvironment?: boolean;
		cubeMapSize?: number;
		scale?: number;
	}

	let {
		turbidity = 10,
		rayleigh = 3,
		azimuth = 180,
		elevation = 2,
		mieCoefficient = 0.005,
		mieDirectionalG = 0.7,
		setEnvironment = true,
		cubeMapSize = 128,
		scale = 1000
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

	// Deliberately a plain variable, not $state: the task reads it and the effect
	// writes it. Making it reactive would recreate the self-invalidating cycle that
	// phase 1 removed from Renderer.svelte.
	let dirty = true;
	let activeCubeMapSize = 0;

	$effect(() => {
		// Touch every parameter so any change re-flags the sky for an update.
		void turbidity;
		void rayleigh;
		void azimuth;
		void elevation;
		void mieCoefficient;
		void mieDirectionalG;
		void setEnvironment;
		void cubeMapSize;
		void scale;
		dirty = true;
		invalidate();
	});

	// The update runs as a task rather than directly in the effect: WebGPURenderer is
	// initialised asynchronously, and tasks only run once the animation loop is going.
	// Driving CubeCamera from an effect can fire before the device exists.
	useTask(
		() => {
			if (!dirty) return;
			dirty = false;

			sky.scale.setScalar(scale);
			sky.turbidity.value = turbidity;
			sky.rayleigh.value = rayleigh;
			sky.mieCoefficient.value = mieCoefficient;
			sky.mieDirectionalG.value = mieDirectionalG;

			const phi = THREE.MathUtils.degToRad(90 - elevation);
			const theta = THREE.MathUtils.degToRad(azimuth);
			sunPosition.setFromSphericalCoords(1, phi, theta);
			sky.sunPosition.value.copy(sunPosition);

			if (!setEnvironment) {
				scene.environment = originalEnvironment;
				return;
			}

			if (!renderTarget || !cubeCamera || activeCubeMapSize !== cubeMapSize) {
				initEnvironmentTarget(cubeMapSize);
				activeCubeMapSize = cubeMapSize;
			}

			// Hiding the solar disc avoids a blown-out hotspot baked into the env map.
			sky.showSunDisc.value = 0;
			cubeCamera!.update(renderer, sky as unknown as THREE.Scene);
			sky.showSunDisc.value = 1;

			scene.environment = renderTarget!.texture;
		},
		// Ordered before the render so a changed sky reaches the environment map in the
		// same frame. CubeCamera.update() saves and restores the active render target,
		// so it can safely run inside the render stage.
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
