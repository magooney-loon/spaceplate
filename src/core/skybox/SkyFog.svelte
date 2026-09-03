<script lang="ts">
	// Scene fog, driven by the descriptor's `sky.fogColor` + `fogDensity` and the active
	// camera range -- the consumer that makes the weather `fog` channel visible at ground
	// level. A descriptor consumer like Sky and SkyLight: reads a plain object in a task,
	// writes three objects directly; no $effect, no reactive props, no cycle.
	//
	// THE Fog AND THE NODE ARE EACH CREATED EXACTLY ONCE, then mutated forever: three.js
	// caches the fog node against the fog object's identity, so assigning a *new* Fog
	// (or fogNode) rebuilds the node and invalidates every material's cache key (see
	// ../CLAUDE.md). The Fog instance stays on the scene as the parameter carrier, bound
	// into the node through `reference()` exactly as NodeManager.updateFog() would; our
	// own `scene.fogNode` adds the second, height-based term. `material.fog = false`
	// still opts a material out on this path, so the sky layers are unaffected.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		exponentialHeightFogFactor,
		fog as tslFog,
		rangeFogFactor,
		reference,
		renderGroup,
		uniform
	} from 'three/tsl';
	import { clamp01, descriptor, lerp } from './model';

	interface Props {
		/**
		 * Where clear-weather horizon haze starts, as a fraction of the active camera's
		 * `far` plane. Linear fog is deliberate: it masks the end of the camera range
		 * instead of tinting nearby models the way FogExp2 does. The weather fog channel
		 * pulls this band inward; clear sunset keeps a warm horizon.
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
		/**
		 * Peak density of the GROUND layer -- the height-fog term that makes fog sit in
		 * the world rather than hang at a fixed distance. Units are 1/(world unit²) and
		 * the sane range is small: at a 144-unit far plane and a 20-unit layer, 0.0022 is
		 * a thick bank and 0.0005 a suggestion. Retune against camera range, not by eye.
		 */
		groundFogDensity?: number;
		/**
		 * World-Y the ground layer fades out by, at no fog and at full fog. A dawn mist is
		 * shallow and a fog bank is deep, so the ceiling rises with the same weight the
		 * density does. Assumes the playable ground sits near y = 0.
		 */
		groundFogHeightRange?: [number, number];
		/**
		 * How much ground fog the day curve's own haze may produce with NO weather fog,
		 * as a fraction of the full amount -- mist in the valley at dawn/dusk (where
		 * `fogDensity` peaks) and a clear noon, with no `setWeather` call.
		 */
		clearGroundFogShare?: number;
	}

	let {
		clearNearFraction = 0.72,
		clearFarFraction = 0.98,
		clearDensityRange = [0.015, 0.038],
		weatherNearFraction = 0.08,
		weatherFarFraction = 0.55,
		fallbackFar = 144,
		groundFogDensity = 0.0022,
		groundFogHeightRange = [4, 20],
		clearGroundFogShare = 0.35
	}: Props = $props();

	const { scene, camera, autoRenderTask } = useThrelte();

	const previousFog = scene.fog;
	const previousFogNode = (scene as any).fogNode ?? null;
	const fog = new THREE.Fog(0x000000, 0, 1);

	// The ground layer's two knobs. Plain uniforms rather than `reference()`s, because
	// unlike colour/near/far they have nowhere on THREE.Fog to live.
	// Both start at zero rather than at the props' values: the task writes them before the
	// first render (it is ordered `before: autoRenderTask`), and reading a prop here would
	// capture only its initial value anyway.
	const groundDensityNode = uniform(0).setGroup(renderGroup);
	const groundTopNode = uniform(0).setGroup(renderGroup);

	// @types/three declares these looser than they run (`reference()` without `setGroup`,
	// fog factors as bare `Node`). Node plumbing is `any` on purpose rather than fought
	// (see src/core/postprocessing/CLAUDE.md).
	const node = (value: unknown): any => value;

	// Built once, at mount. `reference` binds by property name, so these track the Fog
	// instance the task mutates below -- the exact wiring NodeManager.updateFog() uses.
	const fogNode = tslFog(
		node(reference('color', 'color', fog)).setGroup(renderGroup),
		// TWO FACTORS, UNIONED AS TRANSMITTANCES: 1 - (1 - range)(1 - height), the same
		// composition webgpu_custom_fog uses for its valley band plus distance haze. `max`
		// would also work but flattens the overlap, and the point of keeping the range term
		// is that the horizon still dissolves for a camera standing ABOVE the ground layer.
		node(rangeFogFactor(reference('near', 'float', fog), reference('far', 'float', fog)))
			.oneMinus()
			.mul(node(exponentialHeightFogFactor(groundDensityNode, groundTopNode)).oneMinus())
			.oneMinus()
	);

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

			// The ground layer answers to the same two signals as the band (weather channel,
			// day-curve haze scaled down); its ceiling rises with its density.
			const groundWeight = clamp01(Math.max(fogWeight, clearHaze * clearGroundFogShare));
			groundDensityNode.value = groundFogDensity * groundWeight;
			groundTopNode.value = lerp(groundFogHeightRange[0], groundFogHeightRange[1], groundWeight);

			// Assigned once. See the header note -- swapping either rebuilds nodes.
			if (scene.fog !== fog) scene.fog = fog;
			// `fogNode` is not in @types/three's Scene; same `any`-for-gaps rule as above.
			if ((scene as any).fogNode !== fogNode) (scene as any).fogNode = fogNode;

			// No invalidate(): the fog is a pure function of the descriptor and the camera's
			// far plane, so Skybox.svelte's driver task covers it. See the note there on
			// Threlte's 'on-demand' renderMode.
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			scene.fog = previousFog;
			// Handed back too, or an HDR/cubemap environment would keep rendering the
			// procedural sky's fog after this component is gone.
			(scene as any).fogNode = previousFogNode;
			// Neither holds GPU resources; three drops the cached node with the scene
			// data once nothing references this instance.
		};
	});
</script>
