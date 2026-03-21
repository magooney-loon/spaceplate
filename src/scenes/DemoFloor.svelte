<script lang="ts">
	import { T } from '@threlte/core';
	import { Collider } from '@threlte/rapier';
</script>

<T.Group userData={{ selectable: false, hideInTree: true }}>
	<Collider shape="cuboid" args={[10, 0.5, 10]} />
	<T.Mesh position={[0, 0.5, 0]} receiveShadow userData={{ selectable: false, hideInTree: true }}>
		<T.BoxGeometry args={[20, 0.001, 20]} />
		<T.MeshStandardMaterial color="gray" />
	</T.Mesh>
</T.Group>
