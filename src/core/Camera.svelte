<script lang="ts">
	import { T, useTask } from '@threlte/core/webgpu';
	import { AudioListener } from '@threlte/extras';
	import type { PerspectiveCamera } from 'three/webgpu';
	import { sceneState } from '$extensions/scene';
	import { mouseLookState } from '$core/mouseLook.svelte';

	let camera = $state.raw<PerspectiveCamera>();

	// Demo scene: orbit the origin with mouse look; framing at yaw/pitch = 0
	// matches the default [0, 5, 12] vantage.
	const ORBIT_RADIUS = 13;
	const ORBIT_BASE_PITCH = Math.asin(5 / 13);

	useTask(() => {
		if (!camera) return;
		if (sceneState.currentScene === 'demoScene') {
			camera.rotation.order = 'YXZ';
			const pitch = ORBIT_BASE_PITCH + mouseLookState.pitch;
			const cp = Math.cos(pitch);
			camera.position.set(
				ORBIT_RADIUS * cp * Math.sin(mouseLookState.yaw),
				ORBIT_RADIUS * Math.sin(pitch),
				ORBIT_RADIUS * cp * Math.cos(mouseLookState.yaw)
			);
			camera.lookAt(0, 0, 0);
		} else {
			camera.position.set(0, 5, 12);
			camera.lookAt(0, 0, 0);
		}
	});
</script>

<T.PerspectiveCamera
	fov={60}
	near={0.001}
	far={144}
	makeDefault
	position={[0, 5, 12]}
	bind:ref={camera}
>
	<AudioListener />
</T.PerspectiveCamera>
<T.DirectionalLight
	position={[0, 10, 0]}
	intensity={Math.PI / 4}
	castShadow
	shadow.camera.left={-20}
	shadow.camera.right={20}
	shadow.camera.top={20}
	shadow.camera.bottom={-20}
	shadow.camera.near={0.1}
	shadow.camera.far={50}
	shadow.mapSize.width={2048}
	shadow.mapSize.height={2048}
	oncreate={(ref) => ref.shadow.camera.updateProjectionMatrix()}
/>
