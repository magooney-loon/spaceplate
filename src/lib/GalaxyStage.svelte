<script module lang="ts">
	export type CharacterAction =
		| 'idle'
		| 'walk'
		| 'run'
		| 'agree'
		| 'headShake'
		| 'sad_pose'
		| 'sneak_pose';

	export const galaxyState = $state({ action: 'idle' as CharacterAction });
</script>

<script lang="ts">
	import { T } from '@threlte/core';
	import { GLTF, useGltfAnimations } from '@threlte/extras';

	const { gltf, actions } = useGltfAnimations<CharacterAction>();

	let currentAction: CharacterAction = 'idle';

	$effect(() => {
		$actions?.['idle']?.play();
	});

	$effect(() => {
		const next = galaxyState.action;
		const current = $actions[currentAction];
		const nextAction = $actions[next];
		if (!nextAction || current === nextAction) return;
		nextAction.enabled = true;
		if (current) current.crossFadeTo(nextAction, 0.3, true);
		nextAction.play();
		currentAction = next;
	});
</script>

<!-- Example: Galaxy Stage — animated GLTF character -->
<T.Group>
	<T.AmbientLight intensity={0.5} />
	<T.DirectionalLight position={[10, 5, 5]} castShadow />

	<GLTF
		bind:gltf={$gltf}
		url="https://threejs.org/examples/models/gltf/Xbot.glb"
		oncreate={(scene) => {
			scene.traverse((child) => {
				child.castShadow = true;
			});
		}}
		scale={10}
	/>

	<T.Mesh rotation.x={-Math.PI / 2} receiveShadow>
		<T.CircleGeometry args={[5, 72]} />
		<T.MeshStandardMaterial color="white" />
	</T.Mesh>
</T.Group>
