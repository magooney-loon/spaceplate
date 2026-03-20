<script lang="ts">
	import { T } from '@threlte/core';
	import { PositionalAudio, HTML, interactivity } from '@threlte/extras';
	import { useGameTasks } from '$core/tasks';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$extensions/settings/settings.svelte';
	import { soundActions } from '$core/GlobalAudio.svelte';
	import { Spring } from 'svelte/motion';
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

	createPhysicsTask((delta) => {
		time += delta;

		if (rotatingIco) {
			rotatingIco.rotation.y += delta * 0.5;
		}

		if (bouncingSphere) {
			bouncingSphere.position.x = Math.sin(time * 0.5) * 15;
			bouncingSphere.position.z = Math.cos(time * 0.5) * 9;
			bouncingSphere.position.y = Math.sin(time) * 1.5 + 2;
			bouncingSphere.rotation.x += delta;
		}
	});

	const POS_URL = `${BASE_URL}sounds/positional.mp3`;
</script>

{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
	{#await import('$extensions/gltf-viewer/GltfViewerScene.svelte') then { default: GltfViewerScene }}
		<GltfViewerScene />
	{/await}
{/if}

<T.Group>
	<T.DirectionalLight position={[0, 10, 0]} intensity={0.5} castShadow />

	<T.Mesh
		bind:ref={rotatingIco}
		position.y={2.5}
		scale={scale.current}
		onpointerenter={() => (scale.target = 1.5)}
		onpointerleave={() => (scale.target = 1)}
		onclick={() => {
			colorIndex = (colorIndex + 1) % colors.length;
			soundActions.playClick();
		}}
		castShadow
	>
		<T.IcosahedronGeometry args={[1, 1]} />
		<T.MeshStandardMaterial color={colors[colorIndex]} flatShading />
	</T.Mesh>

	<HTML position.y={4.5} center transform zIndexRange={[0, 0]}>
		<div
			class="text-[18px] font-bold"
			style="color: {colors[colorIndex]}; text-shadow: 0 0 6px {colors[
				colorIndex
			]}, 0 1px 3px rgba(0,0,0,0.8);"
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

	<T.Mesh position.z={-0.9} rotation.x={-Math.PI / 2} receiveShadow>
		<T.CircleGeometry args={[2, 40]} />
		<T.MeshStandardMaterial color="white" />
	</T.Mesh>
</T.Group>
