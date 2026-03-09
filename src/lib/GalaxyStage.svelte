<script lang="ts">
	import { T } from '@threlte/core';
</script>

<!-- Example: Galaxy Stage 3D scene -->
<!-- Replace this with your actual galaxy/map stage content -->

<T.AmbientLight intensity={0.2} />

<!-- Example object - replace with your scene content -->
<T.Mesh position={[0, 7, -14]}>
	<T.TorusGeometry args={[3, 0.4, 16, 60]} />
	<T.MeshStandardMaterial color="#ff8844" emissive="#441100" emissiveIntensity={0.5} />
</T.Mesh>
