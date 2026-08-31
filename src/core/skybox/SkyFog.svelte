<script lang="ts">
	// Scene fog, driven by the descriptor's `sky.fogColor` / `sky.fogDensity`.
	//
	// Those two fields have been authored on all twelve day-curve keyframes since phase 1
	// and nothing consumed them, so a `fog` or `storm` target had nothing to show for
	// itself at ground level. This is the consumer that makes the weather visible.
	//
	// A descriptor consumer like Sky and SkyLight: reads a plain object in a task, writes
	// three objects directly. No $effect, no reactive prop plumbing, no cycle.
	//
	// WHY THIS WORKS ON WEBGPU, AND WHY THE FogExp2 IS CREATED EXACTLY ONCE:
	// three's NodeManager.updateFog() converts `scene.fog` into a `fog()` node, binding
	// colour and density through `reference()` -- so mutating this instance every frame
	// is a uniform write and costs nothing. But it caches that node against the fog
	// OBJECT's identity (`sceneData.fog !== sceneFog`), so assigning a *new* FogExp2
	// would rebuild the node and invalidate every material's cache key. One instance,
	// mutated forever.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { descriptor } from './model';

	interface Props {
		/**
		 * Scales the day curve's authored density. The curve describes the *shape* of the
		 * haze through the day; how far a given game wants to see through it depends
		 * entirely on that game's world scale, so it lives here rather than in the model,
		 * exactly like SkyLight's shadow config.
		 *
		 * The 0.5 default is calibrated against the curve's own numbers and this camera's
		 * 144-unit far plane. Taken raw, sunset's authored 0.038 puts 44% fog at 20 world
		 * units on a *clear* evening -- readable as a look, far too thick as a default.
		 * Halved, it gives 13% at 20 units and 60% by 50: honest aerial perspective on a
		 * clear day, while a `fog` target still white-outs to 76% at 20 units.
		 */
		densityScale?: number;
		/** Hard ceiling, so no combination of channels can ever fog the camera solid. */
		maxDensity?: number;
	}

	let { densityScale = 0.5, maxDensity = 0.12 }: Props = $props();

	const { scene, autoRenderTask, invalidate } = useThrelte();

	const previousFog = scene.fog;
	const fog = new THREE.FogExp2(0x000000, 0);

	useTask(
		() => {
			const { fogColor, fogDensity } = descriptor.sky;
			// Interpreted as sRGB, not as working-space linear: the curve's fog colours are
			// authored by eye alongside hex swatches, so [0.7, 0.78, 0.9] has to mean the
			// pale blue it looks like. Reading them as linear would render every one of
			// them noticeably darker and more saturated than authored.
			fog.color.setRGB(fogColor[0], fogColor[1], fogColor[2], THREE.SRGBColorSpace);
			fog.density = Math.min(maxDensity, fogDensity * densityScale);

			// Assigned once. See the header note -- swapping the object rebuilds nodes.
			if (scene.fog !== fog) scene.fog = fog;
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			scene.fog = previousFog;
			// FogExp2 holds no GPU resources; three drops the cached node with the scene
			// data once nothing references this instance.
		};
	});
</script>
