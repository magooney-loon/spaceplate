<script lang="ts">
	import { T } from '@threlte/core';
	import { Audio, PositionalAudio } from '@threlte/extras';
	import { useSound } from '$extensions/sound/useSound';
	import { useGameTasks } from '$core/tasks';
	import * as THREE from 'three';

	const { state: soundState } = useSound();
	const { createPhysicsTask } = useGameTasks();

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

	// Base URL for sounds in /public/sounds/
	const base = import.meta.env.BASE_URL;
	const AMBIENCE_URL = `${base}sounds/ambience.ogg`;
	const CLICK_URL = `${base}sounds/click.mp3`;
</script>

<!-- Demo Scene 3D Content -->
<T.Group>
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
			src={CLICK_URL}
			volume={soundState.sfxMuted ? 0 : soundState.sfxVolume}
			refDistance={soundState.refDistance}
			maxDistance={soundState.maxDistance}
			rolloffFactor={soundState.rolloffFactor}
			panningModel={soundState.panningModel}
			loop
			autoplay={!soundState.sfxMuted}
		/>
	</T.Mesh>

	<!-- Ground Plane -->
	<T.Mesh position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
		<T.PlaneGeometry args={[10, 10]} />
		<T.MeshStandardMaterial color="#333333" />
	</T.Mesh>

	<!-- Lighting -->
	<T.DirectionalLight position={[5, 5, 5]} intensity={1} />
	<T.AmbientLight intensity={0.5} />
</T.Group>

<!-- Global ambient sound (non-positional) -->
<Audio
	src={AMBIENCE_URL}
	loop
	volume={soundState.ambientMuted ? 0 : soundState.ambientVolume}
	autoplay={!soundState.ambientMuted}
/>
