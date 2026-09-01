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
	import type { DirectionalLight, HemisphereLight } from 'three/webgpu';
	import { descriptor } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';

	interface Props {
		/** Distance the light is placed along the key direction. */
		distance?: number;
		/** Half-extent of the orthographic shadow box, in world units. */
		shadowRadius?: number;
		shadowMapSize?: number;
		castShadow?: boolean;
		/**
		 * Scales the descriptor's ambient fill. The model publishes a sky-appropriate
		 * level; how much of it a given scene wants is game-specific, exactly like the
		 * shadow config below.
		 */
		fillScale?: number;
	}

	let {
		distance = 30,
		shadowRadius = 20,
		shadowMapSize = 2048,
		castShadow = true,
		fillScale = 1
	}: Props = $props();

	// $state.raw, not $state: proxying a three.js instance breaks it, and nothing here
	// reads the light reactively -- the task writes it directly each frame.
	let light = $state.raw<DirectionalLight>();
	// The ambient half. A hemisphere rather than a flat ambient light so the fill still
	// has a direction to it -- a uniform ambient flattens every form it touches, which
	// at night is most of the frame.
	let fill = $state.raw<HemisphereLight>();

	const { autoRenderTask } = useThrelte();

	// Reading the descriptor in a task rather than an $effect is the whole point: the
	// descriptor is a plain object, so there is nothing to track and no cycle to form.
	// `before: autoRenderTask` shares the constraint with the driver task in
	// Skybox.svelte, so the DAG orders both before the render.
	useTask(
		() => {
			if (!light) return;

			const { direction, color, intensity, ambient } = descriptor.light;
			light.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
			light.color.setRGB(color[0], color[1], color[2]);
			light.intensity = intensity;

			if (fill) {
				// Same hue as the key, so the fill reads as bounced light from the same
				// source rather than a second, unexplained one. The ground half is a dimmed
				// copy: light coming up off the terrain is the same light, minus most of it.
				fill.color.setRGB(color[0], color[1], color[2]);
				fill.groundColor.setRGB(color[0] * 0.3, color[1] * 0.3, color[2] * 0.35);
				fill.intensity = ambient * fillScale;
			}

			// No invalidate(): the light is a pure function of the descriptor's `light`
			// slice, so Skybox.svelte's driver task covers it. See the note there on
			// Threlte's 'on-demand' renderMode.
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
	userData={SKY_LAYER_USERDATA}
/>

<T.HemisphereLight bind:ref={fill} userData={SKY_LAYER_USERDATA} />
