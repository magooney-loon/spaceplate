<script lang="ts">
	import { T } from '@threlte/core';
	import { Audio, PositionalAudio } from '@threlte/extras';
	import { useGameTasks } from '$core/tasks';
	import { useSound } from '$extensions/sound/useSound';
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

	// Base URL for sounds in /public/sounds/
	const base = import.meta.env.BASE_URL;
	const AMBIENCE_URL = `${base}sounds/ambience.ogg`;
	const SWOOSH_URL = `${base}sounds/swoosh.mp3`;

	// Computed volumes with master applied
	const sfxVolume = $derived(
		soundState.masterMuted ? 0 : soundState.sfxVolume * soundState.masterVolume
	);
	const ambientVolume = $derived(
		soundState.masterMuted ? 0 : soundState.ambienceVolume * soundState.masterVolume
	);
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
			volume={soundState.sfxMuted ? 0 : sfxVolume}
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
	<T.DirectionalLight position={[3, 10, 7]} intensity={Math.PI} />
</T.Group>

<!-- Global ambient sound (non-positional) -->
<Audio
	src={AMBIENCE_URL}
	loop
	volume={soundState.ambienceMuted ? 0 : ambientVolume}
	autoplay={!soundState.ambienceMuted}
/>
