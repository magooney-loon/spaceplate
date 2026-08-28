<script lang="ts">
	// The scene's single key light, driven by the sky descriptor's `light` slice.
	// Replaces the hardcoded <T.DirectionalLight> that used to live in Camera.svelte,
	// where it never belonged. See DOCS/weather-system.md §15.3.
	//
	// One light, not two: it follows the sun by day and the moon by night, crossfading
	// colour and intensity across the horizon band. The model publishes hints; this
	// component applies them and owns the shadow configuration, which is game-specific
	// and deliberately stays out of the descriptor.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import type { DirectionalLight } from 'three/webgpu';
	import { descriptor } from './sky';

	interface Props {
		/** Distance the light is placed along the key direction. */
		distance?: number;
		/** Half-extent of the orthographic shadow box, in world units. */
		shadowRadius?: number;
		shadowMapSize?: number;
		castShadow?: boolean;
	}

	let {
		distance = 30,
		shadowRadius = 20,
		shadowMapSize = 2048,
		castShadow = true
	}: Props = $props();

	// $state.raw, not $state: proxying a three.js instance breaks it, and nothing here
	// reads the light reactively -- the task writes it directly each frame.
	let light = $state.raw<DirectionalLight>();

	const { invalidate, autoRenderTask } = useThrelte();

	// Reading the descriptor in a task rather than an $effect is the whole point: the
	// descriptor is a plain object, so there is nothing to track and no cycle to form.
	// `before: autoRenderTask` shares the constraint with the driver task in
	// Skybox.svelte, so the DAG orders both before the render.
	useTask(
		() => {
			if (!light) return;

			const { direction, color, intensity } = descriptor.light;
			light.position.set(
				direction.x * distance,
				direction.y * distance,
				direction.z * distance
			);
			light.color.setRGB(color[0], color[1], color[2]);
			light.intensity = intensity;
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);
</script>

<T.DirectionalLight
	bind:ref={light}
	{castShadow}
	shadow.camera.left={-shadowRadius}
	shadow.camera.right={shadowRadius}
	shadow.camera.top={shadowRadius}
	shadow.camera.bottom={-shadowRadius}
	shadow.camera.near={0.1}
	shadow.camera.far={distance * 2.5}
	shadow.mapSize.width={shadowMapSize}
	shadow.mapSize.height={shadowMapSize}
	oncreate={(ref) => ref.shadow.camera.updateProjectionMatrix()}
	userData={{ hideInTree: true, selectable: false }}
/>
