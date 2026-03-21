<script lang="ts">
	import { T } from '@threlte/core';
	import { AutoColliders } from '@threlte/rapier';
</script>

<T.Group position={[0, -0.5, 0]}>
	<AutoColliders shape="cuboid">
		<T.Mesh receiveShadow>
			<T.BoxGeometry args={[20, 1, 20]} />
			<T.MeshStandardMaterial color="gray" />
		</T.Mesh>
	</AutoColliders>
</T.Group>
