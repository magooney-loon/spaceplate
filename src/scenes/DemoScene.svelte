<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { PositionalAudio, HTML, interactivity } from '@threlte/extras';
	import { useGameTasks } from '$core/tasks';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$core/settings.svelte.js';
	import { Spring } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import * as THREE from 'three';

	interactivity();

	const { createPhysicsTask } = useGameTasks();
	const { state: soundState } = useSound();

	const scale = new Spring(1);
	const colors = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
	let colorIndex = $state(0);

	let rotatingIco = $state.raw<THREE.Mesh>();
	let bouncingSphere = $state.raw<THREE.Mesh>();
	let time = $state(0);
	let introT = $state(0);
	let rotation = $state(0);

	useTask((delta) => {
		rotation += delta * 0.5;
		if (introT < 1) introT = Math.min(1, introT + delta * 2.5);
	});

	createPhysicsTask((delta) => {
		time += delta;

		if (rotatingIco) {
			rotatingIco.rotation.y += delta * 0.5;
		}

		if (bouncingSphere) {
			bouncingSphere.position.z = Math.sin(time * 2) * 18;
			bouncingSphere.position.y = Math.sin(time * 1) * 1.5 + 2;
			bouncingSphere.rotation.x += delta;
		}
	});

	const POS_URL = `${BASE_URL}sounds/positional.mp3`;
</script>

<T.Group scale={cubicOut(introT)}>
	<T.DirectionalLight position={[0, 10, 0]} intensity={0.5} castShadow />

	<T.Mesh
		bind:ref={rotatingIco}
		rotation.y={rotation}
		position.y={1.5}
		scale={scale.current}
		onpointerenter={() => (scale.target = 1.5)}
		onpointerleave={() => (scale.target = 1)}
		onclick={() => {
			colorIndex = (colorIndex + 1) % colors.length;
		}}
		castShadow
	>
		<T.IcosahedronGeometry args={[1, 1]} />
		<T.MeshStandardMaterial color={colors[colorIndex]} flatShading />
	</T.Mesh>

	<HTML position.y={3.6} center zIndexRange={[0, 0]}>
		<div
			style="
			color: {colors[colorIndex]};
			font-size: 42px;
			font-weight: bold;
			font-family: monospace;
			text-shadow: 0 0 6px {colors[colorIndex]}, 0 1px 3px rgba(0,0,0,0.8);
			white-space: nowrap;
			pointer-events: none;
		"
		>
			{colors[colorIndex]}
		</div>
	</HTML>

	<T.Mesh bind:ref={bouncingSphere} position={[2.5, 0, 0]} castShadow>
		<T.SphereGeometry args={[0.5, 32, 32]} />
		<T.MeshStandardMaterial color="#d94a4a" flatShading />

		<PositionalAudio
			src={POS_URL}
			volume={settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0}
			refDistance={soundState.refDistance}
			maxDistance={soundState.maxDistance}
			rolloffFactor={soundState.rolloffFactor}
			panningModel={soundState.panningModel}
			loop
			autoplay={settingsState.audio.sfxEnabled}
		/>
	</T.Mesh>

	<T.Mesh position.y={-1} position.z={-0.9} rotation.x={-Math.PI / 2} receiveShadow>
		<T.CircleGeometry args={[2, 40]} />
		<T.MeshStandardMaterial color="white" />
	</T.Mesh>
</T.Group>
