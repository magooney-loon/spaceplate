<script lang="ts">
	import { T } from '@threlte/core';
	import { interactivity } from '@threlte/extras';
	import { World, RigidBody, Collider, Debug, Attractor } from '@threlte/rapier';
	import { physicsState } from '$extensions/physics/physics.svelte';
	import PhysicsController from '$extensions/physics/PhysicsController.svelte';
	import DemoPhysicsBodies from './DemoPhysicsBodies.svelte';
	import DemoFloor from './DemoFloor.svelte';

	interactivity();
</script>

<World
	gravity={[physicsState.gravityX, physicsState.gravityY, physicsState.gravityZ]}
	framerate={physicsState.framerate}
>
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
		<T.Group position={body.position} userData={{ selectable: false, hideInTree: true }}>
			<RigidBody
				type="dynamic"
				ccd={body.ccd}
				canSleep={body.canSleep}
				linearDamping={body.linearDamping}
				angularDamping={body.angularDamping}
				gravityScale={body.gravityScale}
				userData={{ selectable: false, hideInTree: true }}
			>
				{#if body.type === 'ball'}
					<Collider
						shape="ball"
						args={[0.4]}
						restitution={body.restitution}
						friction={body.friction}
					/>
					<T.Mesh castShadow>
						<T.SphereGeometry args={[0.4, 16, 16]} />
						<T.MeshStandardMaterial color={body.color} flatShading />
					</T.Mesh>
				{:else}
					<Collider
						shape="cuboid"
						args={[0.4, 0.4, 0.4]}
						restitution={body.restitution}
						friction={body.friction}
					/>
					<T.Mesh castShadow>
						<T.BoxGeometry args={[0.8, 0.8, 0.8]} />
						<T.MeshStandardMaterial color={body.color} flatShading />
					</T.Mesh>
				{/if}
			</RigidBody>
		</T.Group>
	{/each}

	{#if import.meta.env.VITE_GAME_ENGINE === 'true'}
		{#await import('$extensions/gltf-viewer/GltfViewerScene.svelte') then { default: GltfViewerScene }}
			<GltfViewerScene />
		{/await}
	{/if}
</World>
