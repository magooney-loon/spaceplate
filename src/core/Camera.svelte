<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { AudioListener } from '@threlte/extras';
</script>

<!-- Boot framing: the default clock is frozen at t = 0.75 (sunset, sun due west) — this
     aim needs to change if that default ever does. Key light is core/skybox/SkyLight.svelte. -->
<T.PerspectiveCamera
	fov={60}
	near={1}
	far={1000}
	makeDefault
	position={[-24, 10, 0]}
	oncreate={(ref) => {
		ref.lookAt(24, 0, 0);
	}}
>
	<AudioListener />
</T.PerspectiveCamera>
