<script lang="ts">
	import { T } from '@threlte/core';
	import { PositionalAudio } from '@threlte/extras';
	import { soundTriggers } from '../sound.svelte.js';
	import { settingsState } from '../settings.svelte.js';

	// Place your swoosh sound at /public/sounds/swoosh.ogg
	const SWOOSH_URL = '/sounds/swoosh.ogg';

	let swooshRef = $state<{ play: () => Promise<unknown> }>();

	$effect(() => {
		if (soundTriggers.swoosh > 0 && settingsState.audio.effectsEnabled) swooshRef?.play();
	});
</script>

<!-- Example: Home Stage 3D scene -->
<!-- Replace this with your actual home/main stage content -->

<T.AmbientLight intensity={0.4} />
<T.DirectionalLight position={[5, 10, 5]} intensity={1.2} />

<!-- Example object - replace with your scene content -->
<T.Mesh position={[0, 0, 0]}>
	<T.IcosahedronGeometry args={[1, 2]} />
	<T.MeshStandardMaterial color="#4488ff" wireframe={false} />

	<!-- Swoosh: positional audio anchored to the main object -->
	<PositionalAudio
		src={SWOOSH_URL}
		refDistance={2}
		volume={0.8}
		bind:this={swooshRef}
	/>
</T.Mesh>
