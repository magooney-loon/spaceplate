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
<T.DirectionalLight position={[0, 10, 0]} intensity={Math.PI / 4} castShadow />
