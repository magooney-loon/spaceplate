<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener } from '@threlte/extras';
</script>

<T.PerspectiveCamera
	fov={60}
	near={0.001}
	far={144}
	makeDefault
	position={[0, 5, 12]}
	oncreate={(ref) => {
		ref.lookAt(0, 0, 0);
	}}
>
	<AudioListener />
</T.PerspectiveCamera>
<T.DirectionalLight
	position={[0, 10, 0]}
	intensity={Math.PI / 4}
	castShadow
	shadow.camera.left={-20}
	shadow.camera.right={20}
	shadow.camera.top={20}
	shadow.camera.bottom={-20}
	shadow.camera.near={0.1}
	shadow.camera.far={50}
	shadow.mapSize.width={2048}
	shadow.mapSize.height={2048}
	oncreate={(ref) => ref.shadow.camera.updateProjectionMatrix()}
/>
