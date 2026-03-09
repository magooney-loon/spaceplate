<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { interactivity } from '@threlte/extras';
	import { Spring } from 'svelte/motion';

	interactivity();

	const scale = new Spring(1);

	let rotation = $state(0);
	useTask((delta) => {
		rotation += delta * 0.5;
	});
</script>

<!-- Example: Home Stage 3D scene -->
<T.DirectionalLight position={[0, 10, 0]} intensity={0.5} castShadow />

<!-- Interactive rotating planet — hover to scale -->
<T.Mesh
	rotation.y={rotation}
	position.y={1.5}
	scale={scale.current}
	onpointerenter={() => (scale.target = 1.5)}
	onpointerleave={() => (scale.target = 1)}
	castShadow
>
	<T.IcosahedronGeometry args={[1, 1]} />
	<T.MeshNormalMaterial flatShading />
</T.Mesh>

<!-- Ground -->
<T.Mesh position.y={-1} position.z={-0.9} rotation.x={-Math.PI / 2} receiveShadow>
	<T.CircleGeometry args={[2, 40]} />
	<T.MeshStandardMaterial color="white" />
</T.Mesh>
