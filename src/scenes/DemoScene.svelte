<script lang="ts">
	import { T } from '@threlte/core';
	import { PositionalAudio } from '@threlte/extras';
	import { useGameTasks } from '$core/tasks';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$core/settings.svelte.js';
	import * as THREE from 'three';

	const { createPhysicsTask } = useGameTasks();
	const { state: soundState } = useSound();

	// Demo scene objects
	let rotatingCube = $state.raw<THREE.Mesh>();
	let bouncingSphere = $state.raw<THREE.Mesh>();
	let time = $state(0);

	// Physics task - runs before render, only in demo scene
	createPhysicsTask((delta) => {
		time += delta;

		// Rotate cube
		if (rotatingCube) {
			rotatingCube.rotation.x += delta * 0.5;
			rotatingCube.rotation.y += delta * 0.3;
		}

		// Bounce sphere
		if (bouncingSphere) {
			bouncingSphere.position.y = Math.sin(time * 2) * 1.5;
			bouncingSphere.rotation.x += delta;
		}
	});

	const SWOOSH_URL = `${BASE_URL}sounds/swoosh.mp3`;
</script>

<!-- Demo Scene 3D Content -->
<T.Group position={[0, 2, 0]}>
	<!-- Rotating Cube -->
	<T.Mesh bind:ref={rotatingCube} position={[0, 0, 0]}>
		<T.BoxGeometry args={[1, 1, 1]} />
		<T.MeshStandardMaterial color="#4a90d9" />
	</T.Mesh>

	<!-- Bouncing Sphere with Positional Audio -->
	<T.Mesh bind:ref={bouncingSphere} position={[2, 0, 0]}>
		<T.SphereGeometry args={[0.5, 32, 32]} />
		<T.MeshStandardMaterial color="#d94a4a" />

		<!-- Positional audio that moves with the sphere -->
		<PositionalAudio
			src={SWOOSH_URL}
			volume={settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0}
			refDistance={soundState.refDistance}
			maxDistance={soundState.maxDistance}
			rolloffFactor={soundState.rolloffFactor}
			panningModel={soundState.panningModel}
			loop
			autoplay={settingsState.audio.sfxEnabled}
		/>
	</T.Mesh>

	<!-- Ground Plane -->
	<T.Mesh position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
		<T.PlaneGeometry args={[10, 10]} />
		<T.MeshStandardMaterial color="#333333" />
	</T.Mesh>

	<!-- Lighting -->
	<T.DirectionalLight position={[3, 10, 7]} intensity={Math.PI} />
</T.Group>
