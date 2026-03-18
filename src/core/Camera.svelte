<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener, CameraControls } from '@threlte/extras';
	import { log } from '$core/settings.svelte.js';
	import { useCameraControls } from '$extensions/camera/useCameraControls';
	import type { PerspectiveCamera } from 'three';

	let controlsRef = $state<any>(null);
	const ext = useCameraControls();

	// Create derived values for reactive camera properties
	const position = $derived([ext.state.positionX, ext.state.positionY, ext.state.positionZ] as [
		number,
		number,
		number
	]);
	const fov = $derived(ext.state.fov);
	const near = $derived(ext.state.near);
	const far = $derived(ext.state.far);

	const handleCameraCreate = (camera: PerspectiveCamera) => {
		camera.position.set(position[0], position[1], position[2]);
		camera.lookAt(0, 0, 0);
		return () => {
			log.info('Camera disposed');
		};
	};

	const handleControlsCreate = (ref: any) => {
		controlsRef = ref;
	};
</script>

<T.PerspectiveCamera {position} {fov} {near} {far} makeDefault oncreate={handleCameraCreate}>
	<AudioListener />
	<CameraControls enabled={true} bind:ref={controlsRef} oncreate={handleControlsCreate} />
</T.PerspectiveCamera>
