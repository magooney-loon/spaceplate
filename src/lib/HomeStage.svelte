<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { interactivity, HTML } from '@threlte/extras';
	import { Spring } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { soundActions } from '../Sound.svelte';

	interactivity();

	const scale = new Spring(1);

	const colors = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
	let colorIndex = $state(0);

	let rotation = $state(0);
	let introT = $state(0);
	useTask((delta) => {
		rotation += delta * 0.5;
		if (introT < 1) introT = Math.min(1, introT + delta * 2.5);
	});
</script>

<!-- Example: Home Stage 3D scene -->
<T.Group scale={cubicOut(introT)}>
	<T.DirectionalLight position={[0, 10, 0]} intensity={0.5} castShadow />

	<!-- Interactive rotating planet — hover to scale, click to change color -->
	<T.Mesh
		rotation.y={rotation}
		position.y={1.5}
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

	<!-- Color label above the sphere -->
	<HTML position.y={3.6} center zIndexRange={[0, 0]}>
		<div
			style="
			color: {colors[colorIndex]};
			font-size: 69px;
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

	<!-- Ground -->
	<T.Mesh position.y={-1} position.z={-0.9} rotation.x={-Math.PI / 2} receiveShadow>
		<T.CircleGeometry args={[2, 40]} />
		<T.MeshStandardMaterial color="white" />
	</T.Mesh>
</T.Group>
