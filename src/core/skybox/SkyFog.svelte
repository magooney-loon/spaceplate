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
		cameraPosition,
		float,
		fog as tslFog,
		positionWorld,
		rangeFogFactor,
		reference,
		renderGroup,
		select,
		uniform
	} from 'three/tsl';
	import { clamp01, descriptor, lerp, rainAmount } from './model';
	import { flashState } from './layers/lightning/flashState';
	import { uFogFar, uFogNear, uFogScatter } from './fogScatter.svelte';
	import { uWeatherCool, uWeatherDesaturate } from './weatherGrade.svelte';

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
		 * Density of the GROUND layer AT ITS BASE -- the height-fog term that makes fog sit
		 * in the world rather than hang at a fixed distance. Units are 1/(world unit): the
		 * optical depth of a horizontal ray at the base is `density × length`, so 0.05 puts
		 * a ray at ~95% fogged by 60 units and 0.01 leaves it at 45% after 60.
		 */
		groundFogDensity?: number;
		/**
		 * SCALE HEIGHT of the ground layer, at no fog and at full fog -- the rise over which
		 * density falls by 1/e. A dawn mist is shallow and a fog bank is deep, so it grows
		 * with the same weight the density does.
		 *
		 * Not a ceiling: the layer has none, it thins forever (see the node below). Roughly
		 * three scale heights up is where it stops reading as fog at all, so 6 is a bank
		 * that laps at a car and 18 one that swallows trees.
		 */
		groundFogFalloffRange?: [number, number];
		/** World-Y the ground layer's base sits at — where `groundFogDensity` is measured. */
		groundFogBase?: number;
		/**
		 * How much ground fog the day curve's own haze may produce with NO weather fog,
		 * as a fraction of the full amount -- mist in the valley at dawn/dusk (where
		 * `fogDensity` peaks) and a clear noon, with no `setWeather` call.
		 */
		clearGroundFogShare?: number;
		/**
		 * How much ground fog a full downpour throws up on its own, as a fraction of
		 * `groundFogDensity` — the shallow haze of bounce spray that makes heavy rain read
		 * as HITTING something rather than passing through it. Rain's splash layers draw
		 * the individual impacts; this is the churned air above them, which no number of
		 * rings can produce.
		 *
		 * It is an approximation in one specific way worth knowing: it is global, while
		 * the spray is really only over surfaces the rain is reaching. The height field
		 * knows where those are and `scene.fog` does not, and under a roof the drops
		 * already stop — so the error is a little haze in a covered space, which reads as
		 * damp air rather than as a bug.
		 */
		rainSprayShare?: number;
		/**
		 * SCALE HEIGHT of the spray specifically, and the reason it cannot simply be folded
		 * into `groundFogFalloffRange`: that range grows with weight because a thicker fog
		 * BANK is a deeper one, and spray is the opposite — a downpour churns a couple of
		 * metres of air at the surface however hard it falls. Folding spray into the same
		 * weight would make heavy rain produce a bank that swallows trees.
		 */
		rainSprayFalloff?: number;
		/**
		 * How much forward-scattered key light the fog glows with when you look TOWARD the
		 * sun (or the moon — `descriptor.light` is one vector across the crossover). 0 is the
		 * old flat-coloured fog. This is the term that makes a misty sunrise read as a
		 * sunrise rather than as grey haze at a warm time of day, and it costs a dot and a
		 * pow per fogged fragment.
		 */
		sunInscatter?: number;
		/**
		 * Exponent on the forward-scattering lobe. Low is a broad wash across half the sky,
		 * high is a tight halo around the body. Mie forward scattering is genuinely narrow,
		 * but a lobe this cheap has no disc to sit on, so keep it wide enough to read as air.
		 */
		inscatterSharpness?: number;
		/**
		 * How far toward white a full lightning flash lifts the fog. A strike illuminates
		 * the whole bank at once — the fog is what makes the flash have a SHAPE, and without
		 * this the bolt lights the scene and the clouds while the air it travels through
		 * stays dead. Applied uniformly, not directionally: a bank lit from inside has no
		 * single direction, and `flashState.flash` is already amplitude-capped at the source.
		 */
		flashFogLift?: number;
	}

	let {
		clearNearFraction = 0.72,
		clearFarFraction = 0.98,
		clearDensityRange = [0.015, 0.038],
		weatherNearFraction = 0.08,
		weatherFarFraction = 0.55,
		fallbackFar = 144,
		groundFogDensity = 0.05,
		groundFogFalloffRange = [3, 11],
		groundFogBase = 0,
		clearGroundFogShare = 0.35,
		rainSprayShare = 0.45,
		rainSprayFalloff = 1.4,
		sunInscatter = 0.5,
		inscatterSharpness = 6,
		flashFogLift = 0.85
	}: Props = $props();

	const { scene, camera, autoRenderTask } = useThrelte();

	const previousFog = scene.fog;
	const previousFogNode = (scene as any).fogNode ?? null;
	const fog = new THREE.Fog(0x000000, 0, 1);

	// The ground layer's knobs. Plain uniforms rather than `reference()`s, because
	// unlike colour/near/far they have nowhere on THREE.Fog to live.
	// Both start at zero rather than at the props' values: the task writes them before the
	// first render (it is ordered `before: autoRenderTask`), and reading a prop here would
	// capture only its initial value anyway.
	const groundDensityNode = uniform(0).setGroup(renderGroup);
	const groundFalloffNode = uniform(1).setGroup(renderGroup);
	const groundBaseNode = uniform(0).setGroup(renderGroup);

	// The inscatter term's three knobs. `inscatterColorNode` carries the key light's colour
	// ALREADY SCALED by the gain, so there is one uniform instead of two and the whole term
	// vanishes numerically (black × anything) at night, at noon, and at `sunInscatter` 0 --
	// no branch in the shader for a case the uniform can express.
	const keyDirectionNode = uniform(new THREE.Vector3(0, 1, 0)).setGroup(renderGroup);
	const inscatterColorNode = uniform(new THREE.Color(0, 0, 0)).setGroup(renderGroup);
	const inscatterSharpnessNode = uniform(1).setGroup(renderGroup);

	// Scratch + constant for the per-frame colour maths, so the task allocates nothing.
	const scratchColor = new THREE.Color();
	const WHITE = new THREE.Color(1, 1, 1);

	// @types/three declares these looser than they run (`reference()` without `setGroup`,
	// fog factors as bare `Node`). Node plumbing is `any` on purpose rather than fought
	// (see src/core/postprocessing/CLAUDE.md).
	const node = (value: unknown): any => value;

	// FORWARD SCATTERING, the directional half of the fog's colour. `reference('color')` is
	// the ambient-scattered base -- what the fog looks like with your back to the light --
	// and the lobe ADDS the light that came the other way down the view ray. Additive
	// rather than a mix toward a second colour: inscattered light is light arriving, so a
	// thick bank toward a low sun gets brighter, which is exactly what one does.
	//
	// The view ray, shared by BOTH terms below: the inscatter lobe wants its direction and
	// the height integral wants its length, and `length()` is most of a `normalize()`.
	//
	// THE GROUND LAYER, as the analytic integral of an exponential density along the ray.
	//
	// This replaces three's `exponentialHeightFogFactor`, which is wrong in two ways that
	// both show. It measures `max(top - fragmentY, 0)` and multiplies by viewZ, so (a) it
	// has a HARD CEILING -- above `top` there is exactly no fog -- and because the product
	// is then squared, the ramp under that ceiling saturates within a few percent of the
	// layer at any real distance, which draws a flat horizontal LINE across the world where
	// the bank ends; and (b) it never looks at where the CAMERA is, so a camera inside the
	// bank looking up at a roof gets no fog on a ray that crossed the whole layer, and one
	// above it looking down gets the full amount on a ray that barely clipped it.
	//
	// Density falls off as exp(-(y - base) / falloff) and the optical depth along the ray
	// is its integral, which has a closed form:
	//
	//   ρ(camera) · |P - C| · (1 - exp(-t)) / t,   t = Δy / falloff
	//
	// No ceiling (it thins forever, so there is no line to draw), and both endpoints are in
	// it, so climbing out of a fog bank now looks like climbing out of a fog bank.
	const rayDelta = node(positionWorld.sub(cameraPosition));
	const rayLength = rayDelta.length();
	const viewDirection = rayDelta.div(rayLength);
	const towardKey = viewDirection.dot(node(keyDirectionNode)).max(0).pow(inscatterSharpnessNode);

	const heightT = rayDelta.y.div(groundFalloffNode);
	// (1 - exp(-t))/t is smooth and ~1 through t = 0, but the expression is 0/0 there --
	// a horizontal ray is the single most common case in a driving game, not an edge case.
	// Substituting a small POSITIVE t is exact to float precision: avg(1e-3) = 0.9995.
	const safeT = node(select(heightT.abs().lessThan(1e-3), float(1e-3), heightT));
	const heightAverage = safeT.negate().exp().oneMinus().div(safeT);
	const densityAtCamera = groundDensityNode.mul(
		cameraPosition.y.sub(groundBaseNode).div(groundFalloffNode).negate().exp()
	);
	const heightFogFactor = densityAtCamera
		.mul(rayLength)
		.mul(heightAverage)
		.negate()
		.exp()
		.oneMinus();

	// Built once, at mount. `reference` binds by property name, so these track the Fog
	// instance the task mutates below -- the exact wiring NodeManager.updateFog() uses.
	const fogNode = tslFog(
		node(reference('color', 'color', fog))
			.setGroup(renderGroup)
			.add(node(inscatterColorNode).mul(towardKey)),
		// TWO FACTORS, UNIONED AS TRANSMITTANCES: 1 - (1 - range)(1 - height), the same
		// composition webgpu_custom_fog uses for its valley band plus distance haze. `max`
		// would also work but flattens the overlap, and the point of keeping the range term
		// is that the horizon still dissolves for a camera standing ABOVE the ground layer.
		node(rangeFogFactor(reference('near', 'float', fog), reference('far', 'float', fog)))
			.oneMinus()
			.mul(heightFogFactor.oneMinus())
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

			// A strike lights the air it passes through. Lifted in WORKING space, after the
			// sRGB read above, because this is light being added rather than a swatch being
			// authored -- and lifted on the base colour so the scatter effect's copy (below)
			// and the dome's own flash wash stay one event.
			const flashLift = clamp01(flashState.flash) * flashFogLift;
			if (flashLift > 0) fog.color.lerp(WHITE, flashLift);

			// The ground layer answers to the same two signals as the band (weather channel,
			// day-curve haze scaled down); it deepens with its density.
			const bankWeight = clamp01(Math.max(fogWeight, clearHaze * clearGroundFogShare));

			// RAIN SPRAY, the third signal and the only one that is not fog — see
			// `rainSprayShare`. Unioned with the bank as TRANSMITTANCES, the same way the
			// node itself combines its range and height factors: two independent things in
			// the air, not one taking the max over the other.
			const spray = clamp01(rainAmount(descriptor.weather)) * clamp01(rainSprayShare);
			const groundWeight = 1 - (1 - bankWeight) * (1 - spray);
			groundDensityNode.value = groundFogDensity * groundWeight;

			// DEPTH FOLLOWS THE BANK, then is pulled back toward the spray's own shallow
			// scale height by whatever SHARE of the layer the spray contributed. So rain in
			// clear air is ankle-deep churn, rain inside a fog bank is still the bank's
			// depth (the deeper of the two wins, rather than the two averaging into
			// something that is neither), and no rain at all reproduces the old expression
			// exactly — `spray` 0 makes the share 0 and the lerp an identity.
			const bankDepth = lerp(groundFogFalloffRange[0], groundFogFalloffRange[1], bankWeight);
			const sprayShare = groundWeight > 0 ? (spray * (1 - bankWeight)) / groundWeight : 0;
			groundFalloffNode.value = Math.max(0.01, lerp(bankDepth, rainSprayFalloff, sprayShare));
			groundBaseNode.value = groundFogBase;

			// FORWARD SCATTERING toward the key. Three gates, all of them in TS rather than
			// in the shader, so the fragment cost is a constant dot/pow whatever they say:
			//
			// - `horizonGain` -- a low key means a long, grazing path through the air, which
			//   is when forward scattering dominates. At noon the lobe points at the sky and
			//   there is nothing to see, so it closes to nothing.
			// - luminance of the day curve's own fog colour as the DAYLIGHT proxy, the same
			//   trick (and the same reason) as the mixer's white lift: ungated, a midnight
			//   fog bank glowed toward a moon that is not lighting anything.
			// - the light's own colour and the crossover with it, for free.
			//
			// Deliberately NOT gated on `light.intensity`: `keyAttenuation` pulls that down
			// as fog thickens, which is right for the key and backwards here -- a thick bank
			// toward the sun is the brightest thing in the frame, not the dimmest.
			const key = descriptor.light;
			const horizonGain = 1 - clamp01(key.direction.y);
			const daylight = Math.min(
				1,
				(0.299 * fogColor[0] + 0.587 * fogColor[1] + 0.114 * fogColor[2]) * 2
			);
			const inscatterGain = sunInscatter * horizonGain * daylight;
			// No colour-space argument: `descriptor.light.color` is consumed as WORKING space
			// by SkyLight, the field's other reader, and this adds into a working-space fog
			// colour. (`sky.fogColor` is the authored-sRGB one -- they are different fields.)
			scratchColor.setRGB(key.color[0], key.color[1], key.color[2]);
			inscatterColorNode.value.copy(scratchColor).multiplyScalar(inscatterGain);
			keyDirectionNode.value.set(key.direction.x, key.direction.y, key.direction.z);
			inscatterSharpnessNode.value = Math.max(1, inscatterSharpness);

			// The scattering effect's half of the band (fogScatter.svelte.ts). Mirrors, not
			// state: everything here was computed above, and the effect needs it as uniforms.
			uFogNear.value = fog.near;
			uFogFar.value = fog.far;
			uFogScatter.value = fogWeight;

			// THE WEATHER GRADE (weatherGrade.svelte.ts + the post effect of the same name),
			// driven from here for the reason `godrays` is driven from `SkyLight`: this task
			// already has every signal it needs in hand, and a sibling driver would only
			// re-read the same channels a frame later.
			//
			// Both weathers desaturate; only precipitation cools. Fog takes the colour of
			// whatever is lighting it — a fog bank at sunset is warm — so cooling it would
			// fight the inscatter lobe computed a few lines above. Rain is the term that
			// earns the cool tint, and the two are unioned as transmittances on the
			// desaturation axis exactly as the ground layer's two signals are.
			const precipitation = clamp01(rainAmount(descriptor.weather));
			uWeatherDesaturate.value = 1 - (1 - precipitation) * (1 - fogWeight * 0.6);
			uWeatherCool.value = precipitation;

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
			// The scatter effect outlives this component (it is a pipeline chain effect), and
			// after unmount nothing schedules the task that would decay these — the same rule
			// the lens drivers follow. Hard-set to rest: neither effect has a latch to drop
			// it from the graph, so an HDR environment would otherwise hold whatever the
			// last procedural frame's weather happened to be forever. At rest both ARE the
			// identity.
			uFogScatter.value = 0;
			uWeatherDesaturate.value = 0;
			uWeatherCool.value = 0;

			scene.fog = previousFog;
			// Handed back too, or an HDR/cubemap environment would keep rendering the
			// procedural sky's fog after this component is gone.
			(scene as any).fogNode = previousFogNode;
			// Neither holds GPU resources; three drops the cached node with the scene
			// data once nothing references this instance.
		};
	});
</script>
