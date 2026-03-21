<script lang="ts">
	import { T } from '@threlte/core';
	import { AutoColliders, RigidBody } from '@threlte/rapier';
</script>

<T.Group position={[0, -0.5, 0]} userData={{ selectable: false, hideInTree: true }}>
	<RigidBody type="fixed" userData={{ selectable: false, hideInTree: true }}>
		<T.Group userData={{ selectable: false, hideInTree: true }}>
			<AutoColliders shape="cuboid">
				<T.Mesh receiveShadow>
					<T.BoxGeometry args={[20, 0.001, 20]} />
					<T.MeshStandardMaterial color="gray" />
				</T.Mesh>
			</AutoColliders>
		</T.Group>
	</RigidBody>
</T.Group>
