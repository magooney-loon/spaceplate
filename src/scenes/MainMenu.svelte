<script lang="ts">
	import { T } from '@threlte/core';
	import { useGameTasks } from '$core/tasks';

	const { createUiTask } = useGameTasks();

	let menuRotation = $state(0);

	createUiTask((delta) => {
		// Slowly rotate the menu background
		menuRotation += delta * 0.1;
	});
</script>

<!-- Main Menu 3D Content -->
<T.Group rotation={[0, menuRotation, 0]}>
	<!-- Decorative rotating geometry for menu background -->
	<T.Mesh position={[0, 0, -5]}>
		<T.IcosahedronGeometry args={[2, 1]} />
		<T.MeshBasicMaterial color="#4a90d9" wireframe />
	</T.Mesh>

	<T.Mesh position={[-3, 0, -5]}>
		<T.BoxGeometry args={[1, 1, 1]} />
		<T.MeshBasicMaterial color="#d94a4a" wireframe />
	</T.Mesh>

	<T.Mesh position={[3, 0, -5]}>
		<T.BoxGeometry args={[1, 1, 1]} />
		<T.MeshBasicMaterial color="#4ad94a" wireframe />
	</T.Mesh>
</T.Group>
