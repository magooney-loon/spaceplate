<script lang="ts">
	import { T } from '@threlte/core';
	import { useRapier } from '@threlte/rapier';

	const { world, rapier } = useRapier();

	// Imperative creation — bypasses T.Group transform inheritance issues
	const desc = rapier.ColliderDesc.cylinder(0.1, 20).setTranslation(0, -0.1, -0.9);
	const collider = world.createCollider(desc);

	$effect(() => {
		return () => world.removeCollider(collider, false);
	});
</script>

<T.Mesh position={[0, 0, -0.9]} rotation.x={-Math.PI / 2} receiveShadow>
	<T.CircleGeometry args={[20, 40]} />
	<T.MeshStandardMaterial color="white" opacity={0.45} transparent={true} />
</T.Mesh>
