<script lang="ts">
	import { T } from '@threlte/core';
	import { HTML } from '@threlte/extras';
	import { RigidBody, Collider, usePhysicsTask } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat';
	import * as THREE from 'three';
	import { Spring } from 'svelte/motion';
	import { soundActions } from '$core/GlobalAudio.svelte';

	const colors = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
	let colorIndex = $state(0);
	const scale = new Spring(1);

	let icoRb = $state.raw<RapierRigidBody>();
	let icoAngle = 0;

	usePhysicsTask((delta) => {
		if (!icoRb) return;
		icoAngle += delta * 0.5;
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, icoAngle, 0));
		icoRb.setNextKinematicTranslation({ x: 0, y: 2.5, z: 0 });
		icoRb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
	});
</script>

<!-- Rotating icosahedron — kinematic, spins in place, spawned bodies bounce off it -->
<RigidBody type="kinematicPosition" bind:rigidBody={icoRb}>
	<Collider shape="ball" args={[1]} />
	<T.Mesh
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

	<HTML position.y={2} center transform zIndexRange={[0, 0]}>
		<div
			class="text-[18px] font-bold"
			style="color: {colors[colorIndex]}; text-shadow: 0 0 6px {colors[colorIndex]}, 0 1px 3px rgba(0,0,0,0.8);"
		>
			{colors[colorIndex]}
		</div>
	</HTML>
</RigidBody>
