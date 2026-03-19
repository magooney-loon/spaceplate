<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener } from '@threlte/extras';
</script>

<T.PerspectiveCamera
	makeDefault
	position={[10, 10, 10]}
	oncreate={(ref) => {
		ref.lookAt(0, 1, 0);
	}}
>
	<AudioListener />
</T.PerspectiveCamera>
