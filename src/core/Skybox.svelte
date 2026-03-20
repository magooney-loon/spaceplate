<script lang="ts">
	import { T } from '@threlte/core';
	import { Sky, Stars as StarsComponent } from '@threlte/extras';

	import { settingsState } from '$extensions/settings/settings.svelte';
	import { skyboxState } from '$extensions/skybox/skybox.svelte';

	const starCounts = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return { stars1: 200, stars2: 180 };
			case 'high':
				return { stars1: 720, stars2: 540 };
			default:
				return { stars1: 720, stars2: 540 };
		}
	});
</script>

<T.Group userData={{ hideInTree: true, selectable: false }}>
	<Sky
		turbidity={skyboxState.turbidity}
		rayleigh={skyboxState.rayleigh}
		azimuth={skyboxState.azimuth}
		elevation={skyboxState.elevation}
		mieCoefficient={skyboxState.mieCoefficient}
		mieDirectionalG={skyboxState.mieDirectionalG}
		setEnvironment={skyboxState.setEnvironment}
		cubeMapSize={skyboxState.cubeMapSize}
		scale={skyboxState.scale}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>

<T.Group userData={{ hideInTree: true, selectable: false }}>
	<StarsComponent
		count={starCounts.stars1}
		radius={4.5}
		depth={12}
		factor={1.45}
		fade={true}
		lightness={0.4}
		opacity={1}
		saturation={0.45}
		speed={0.72}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>

<T.Group userData={{ hideInTree: true, selectable: false }}>
	<StarsComponent
		count={starCounts.stars2}
		radius={4.5}
		depth={9}
		factor={1.9}
		fade={true}
		lightness={0.4}
		opacity={1}
		saturation={0.45}
		speed={0.2}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>
