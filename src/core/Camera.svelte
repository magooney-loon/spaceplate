<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener, CameraControls } from '@threlte/extras';
	import { log } from '$core/settings.svelte.js';
	import { useCameraControls } from '$extensions/camera/useCameraControls';
	import type { PerspectiveCamera } from 'three';

	let controlsRef = $state<any>(null);
	const { state: cameraState } = useCameraControls();

	const handleCameraCreate = (camera: PerspectiveCamera) => {
		camera.lookAt(0, 0, 0);
		return () => {
			log.info('Camera disposed');
		};
	};

	const handleControlsCreate = (ref: any) => {
		controlsRef = ref;
	};

	$effect(() => {
		if (!controlsRef) return;

		const state = cameraState;
		controlsRef.enabled = state.enabled;
		controlsRef.minPolarAngle = state.minPolarAngle;
		controlsRef.maxPolarAngle = state.maxPolarAngle;
		controlsRef.minAzimuthAngle = state.minAzimuthAngle;
		controlsRef.maxAzimuthAngle = state.maxAzimuthAngle;
		controlsRef.minDistance = state.minDistance;
		controlsRef.maxDistance = state.maxDistance;
		controlsRef.minZoom = state.minZoom;
		controlsRef.maxZoom = state.maxZoom;
		controlsRef.smoothTime = state.smoothTime;
		controlsRef.draggingSmoothTime = state.draggingSmoothTime;
		controlsRef.maxSpeed = state.maxSpeed;
		controlsRef.azimuthRotateSpeed = state.azimuthRotateSpeed;
		controlsRef.polarRotateSpeed = state.polarRotateSpeed;
		controlsRef.dollySpeed = state.dollySpeed;
		controlsRef.truckSpeed = state.truckSpeed;
		controlsRef.dollyToCursor = state.dollyToCursor;
	});
</script>

<T.PerspectiveCamera
	position={[0, 0, 10]}
	fov={60}
	near={0.001}
	far={144}
	makeDefault
	oncreate={handleCameraCreate}
>
	<AudioListener />
	<CameraControls enabled={false} bind:ref={controlsRef} oncreate={handleControlsCreate} />
</T.PerspectiveCamera>
