<script lang="ts">
	import { T } from '@threlte/core';
</script>

<!-- Example: Home Stage 3D scene -->
<!-- Replace this with your actual home/main stage content -->

<T.AmbientLight intensity={0.4} />
<T.DirectionalLight position={[5, 10, 5]} intensity={1.2} />

<!-- Example object - replace with your scene content -->
<T.Mesh position={[0, 0, 0]}>
	<T.IcosahedronGeometry args={[1, 2]} />
	<T.MeshStandardMaterial color="#4488ff" wireframe={false} />
</T.Mesh>
