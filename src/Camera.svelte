<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener } from '@threlte/extras';
	import { CameraControls, type CameraControlsRef } from '@threlte/extras';
	import { cameraActions } from './stage.svelte.js';
	import { log } from './settings.svelte.js';
	import type { PerspectiveCamera } from 'three';

	let controls = $state<CameraControlsRef>();

	const handleCameraCreate = (camera: PerspectiveCamera) => {
		camera.lookAt(0, 0, 0);
		return () => {
			log.info('Camera disposed');
		};
	};

	const handleControlsCreate = (controlsRef: CameraControlsRef) => {
		controls = controlsRef;
		cameraActions.setCameraControls(controlsRef);
		return () => {
			cameraActions.setCameraControls(undefined);
			controls = undefined;
		};
	};
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
	<CameraControls enabled={true} bind:ref={controls} oncreate={handleControlsCreate} />
</T.PerspectiveCamera>
