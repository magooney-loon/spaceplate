<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { AudioListener } from '@threlte/extras';
</script>

<!-- The key light lives in core/skybox/SkyLight.svelte, driven by the sky descriptor
     (sun by day, moon by night) — it never belonged in the camera component. -->
<!-- Boot framing: the model's default clock is manual, frozen at t = 0.75 (sunset) —
     the sun sits on the horizon due west, direction (-1, 0, 0). The camera hangs back
     east and high, tilted down ~24 degrees so the sun rides the top of the frame and
     the playground fills the rest. If the default clock ever changes, this aim needs
     to change with it. -->
<T.PerspectiveCamera
	fov={60}
	near={0.001}
	far={144}
	makeDefault
	position={[24, 10, 0]}
	oncreate={(ref) => {
		ref.lookAt(-12, 0, 0);
	}}
>
	<AudioListener />
</T.PerspectiveCamera>
