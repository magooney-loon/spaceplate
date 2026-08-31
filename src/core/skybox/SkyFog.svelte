<script lang="ts">
	// Scene fog, driven by the descriptor's `sky.fogColor` and active camera range.
	//
	// Those two fields have been authored on all twelve day-curve keyframes since phase 1
	// and nothing consumed them, so a `fog` or `storm` target had nothing to show for
	// itself at ground level. This is the consumer that makes the weather visible.
	//
	// A descriptor consumer like Sky and SkyLight: reads a plain object in a task, writes
	// three objects directly. No $effect, no reactive prop plumbing, no cycle.
	//
	// WHY THIS WORKS ON WEBGPU, AND WHY THE Fog IS CREATED EXACTLY ONCE:
	// three's NodeManager.updateFog() converts `scene.fog` into a `fog()` node, binding
	// colour and distances through `reference()` -- so mutating this instance every frame
	// is a uniform write and costs nothing. But it caches that node against the fog
	// OBJECT's identity (`sceneData.fog !== sceneFog`), so assigning a *new* Fog
	// would rebuild the node and invalidate every material's cache key. One instance,
	// mutated forever.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { descriptor } from './model';

	interface Props {
		/**
		 * Where clear-weather horizon haze starts, as a fraction of the active camera's
		 * `far` plane. Linear fog is deliberate for the boilerplate: it masks the end of
		 * the camera range instead of tinting nearby models the way FogExp2 does.
		 *
		 * The weather fog channel pulls this band inward; clear sunset still gets a warm
		 * horizon, while explicit fog can still close visibility down.
		 */
		clearNearFraction?: number;
		clearFarFraction?: number;
		/**
		 * Day-curve fog density is converted into this far-end band weight. Defaults span
		 * the shipped noon-to-sunset densities, so authored clear haze still varies by time.
		 */
		clearDensityRange?: [number, number];
		weatherNearFraction?: number;
		weatherFarFraction?: number;
		/** Used before a default camera is registered, or for unusual cameras without `far`. */
		fallbackFar?: number;
	}

	let {
		clearNearFraction = 0.72,
		clearFarFraction = 0.98,
		clearDensityRange = [0.015, 0.038],
		weatherNearFraction = 0.08,
		weatherFarFraction = 0.55,
		fallbackFar = 144
	}: Props = $props();

	const { scene, camera, autoRenderTask, invalidate } = useThrelte();

	const previousFog = scene.fog;
	const fog = new THREE.Fog(0x000000, 0, 1);

	const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

	const cameraFar = () => {
		const active = camera.current;
		return 'far' in active && typeof active.far === 'number' && Number.isFinite(active.far)
			? active.far
			: fallbackFar;
	};

	useTask(
		() => {
			const { fogColor, fogDensity } = descriptor.sky;
			const far = Math.max(1, cameraFar());
			const clearDensitySpan = Math.max(0.0001, clearDensityRange[1] - clearDensityRange[0]);
			const clearHaze = clamp01((fogDensity - clearDensityRange[0]) / clearDensitySpan);
			const fogWeight = clamp01(descriptor.weather.fog);
			const clearNear = lerp(clearFarFraction, clearNearFraction, clearHaze);
			const nearFraction = lerp(clearNear, weatherNearFraction, fogWeight);
			const farFraction = lerp(clearFarFraction, weatherFarFraction, fogWeight);
			// Interpreted as sRGB, not as working-space linear: the curve's fog colours are
			// authored by eye alongside hex swatches, so [0.7, 0.78, 0.9] has to mean the
			// pale blue it looks like. Reading them as linear would render every one of
			// them noticeably darker and more saturated than authored.
			fog.color.setRGB(fogColor[0], fogColor[1], fogColor[2], THREE.SRGBColorSpace);
			fog.near = far * nearFraction;
			fog.far = Math.max(fog.near + 1, far * farFraction);

			// Assigned once. See the header note -- swapping the object rebuilds nodes.
			if (scene.fog !== fog) scene.fog = fog;
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			scene.fog = previousFog;
			// Fog holds no GPU resources; three drops the cached node with the scene
			// data once nothing references this instance.
		};
	});
</script>
