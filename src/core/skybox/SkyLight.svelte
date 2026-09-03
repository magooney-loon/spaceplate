<script lang="ts">
	// The scene's single key light, driven by the sky descriptor's `light` slice. One
	// light, not two: sun by day, moon by night, crossfading colour and intensity across
	// the horizon band (the model aims it no lower than KEY_MIN_ELEVATION). This
	// component applies the hints and owns the game-specific shadow config, which
	// deliberately stays out of the descriptor.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import type { DirectionalLight, HemisphereLight } from 'three/webgpu';
	import { descriptor } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';

	interface Props {
		/** Distance the light is placed along the key direction. */
		distance?: number;
		/** Half-extent of the orthographic shadow box, in world units. */
		shadowRadius?: number;
		/**
		 * Shadow map resolution, passed by Skybox.svelte from the graphics preset. Changing
		 * it at runtime works: ShadowNode.renderShadow() re-applies mapSize with setSize()
		 * on every shadow render (the "dispose the map first" rule is WebGLRenderer-only),
		 * so a new size lands on the next rendered frame.
		 */
		shadowMapSize?: number;
		castShadow?: boolean;
		/**
		 * Scales the descriptor's ambient fill. The model publishes a sky-appropriate
		 * level; how much a scene wants is game-specific, like the shadow config.
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
	// The ambient half: the env map bakes black at night (see MOON_AMBIENT), so the
	// model publishes a fill and this mounts it. A hemisphere rather than a flat ambient
	// so the fill still has a direction -- uniform ambient flattens every form it touches.
	let fill = $state.raw<HemisphereLight>();

	const { autoRenderTask } = useThrelte();

	// Reading the descriptor in a task, not an $effect: the descriptor is a plain
	// object, so there is nothing to track and no cycle to form. `before:
	// autoRenderTask` shares the constraint with Skybox.svelte's driver task, so the DAG
	// orders both before the render.
	useTask(
		() => {
			if (!light) return;

			// ONE shadow render per frame, shared by every render pass. Node shadows are
			// deduped only per camera per render() call, so extra cameras (cube faces, the
			// reflector's virtual camera, Studio's PiP/selection) otherwise re-render this
			// 2048² map per pass. With autoUpdate off and needsUpdate armed here, the first
			// pass renders it once and every later pass reuses it.
			light.shadow.autoUpdate = false;
			light.shadow.needsUpdate = true;

			const { direction, color, intensity, ambient } = descriptor.light;
			light.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
			light.color.setRGB(color[0], color[1], color[2]);
			light.intensity = intensity;

			if (fill) {
				// Same hue as the key, so the fill reads as bounced light from the same source;
				// the ground half is that light minus most of it.
				fill.color.setRGB(color[0], color[1], color[2]);
				fill.groundColor.setRGB(color[0] * 0.3, color[1] * 0.3, color[2] * 0.35);
				fill.intensity = ambient * fillScale;
			}

			// No invalidate(): the light is a pure function of the descriptor, so
			// Skybox.svelte's driver task covers it. See the note there on Threlte's
			// 'on-demand' renderMode.
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
