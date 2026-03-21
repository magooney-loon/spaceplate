<script lang="ts">
	import { T } from '@threlte/core';
	import { PositionalAudio, interactivity } from '@threlte/extras';
	import { World, RigidBody, Collider, Debug, Attractor } from '@threlte/rapier';
	import { useGameTasks } from '$core/tasks';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$extensions/settings/settings.svelte';
	import * as THREE from 'three';
	import { physicsState } from '$extensions/physics/physics.svelte';
	import PhysicsController from '$extensions/physics/PhysicsController.svelte';
	import DemoPhysicsBodies from './DemoPhysicsBodies.svelte';
	import DemoFloor from './DemoFloor.svelte';

	interactivity();

	const { createPhysicsTask } = useGameTasks();
	const { state: soundState } = useSound();

	let bouncingSphere = $state.raw<THREE.Mesh>();
	let time = $state(0);

	createPhysicsTask((delta) => {
		time += delta;
		if (bouncingSphere) {
			bouncingSphere.position.x = Math.sin(time * 0.5) * 15;
			bouncingSphere.position.z = Math.cos(time * 0.5) * 9;
			bouncingSphere.position.y = Math.sin(time) * 1.5 + 2;
			bouncingSphere.rotation.x += delta;
		}
	});

	const POS_URL = `${BASE_URL}sounds/positional.mp3`;
</script>

<World gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]} framerate={physicsState.framerate}>
	<PhysicsController />

	{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
		{#if physicsState.debug}
			<Debug />
		{/if}
	{/if}

	{#if physicsState.attractorEnabled}
		<Attractor
			position={[physicsState.attractorX, physicsState.attractorY, physicsState.attractorZ]}
			strength={physicsState.attractorStrength}
			range={physicsState.attractorRange}
			gravityType={physicsState.attractorGravityType}
		/>
	{/if}

	<DemoFloor />
	<DemoPhysicsBodies />

	<!-- Spawned physics bodies -->
	{#each physicsState.bodies as body (body.id)}
		<T.Group position={body.position}>
			<RigidBody
				type="dynamic"
				ccd={body.ccd}
				canSleep={body.canSleep}
				linearDamping={body.linearDamping}
				angularDamping={body.angularDamping}
				gravityScale={body.gravityScale}
			>
				{#if body.type === 'ball'}
					<Collider shape="ball" args={[0.4]} restitution={body.restitution} friction={body.friction} />
					<T.Mesh castShadow>
						<T.SphereGeometry args={[0.4, 16, 16]} />
						<T.MeshStandardMaterial color={body.color} flatShading />
					</T.Mesh>
				{:else}
					<Collider shape="cuboid" args={[0.4, 0.4, 0.4]} restitution={body.restitution} friction={body.friction} />
					<T.Mesh castShadow>
						<T.BoxGeometry args={[0.8, 0.8, 0.8]} />
						<T.MeshStandardMaterial color={body.color} flatShading />
					</T.Mesh>
				{/if}
			</RigidBody>
		</T.Group>
	{/each}

	<!-- Animated bouncing sphere (non-physics) -->
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

	{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
		{#await import('$extensions/gltf-viewer/GltfViewerScene.svelte') then { default: GltfViewerScene }}
			<GltfViewerScene />
		{/await}
	{/if}
</World>
