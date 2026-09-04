<script lang="ts">
	// The scene's single key light, driven by the sky descriptor's `light` slice. One
	// light, not two: sun by day, moon by night, crossfading colour and intensity across
	// the horizon band (the model aims it no lower than KEY_MIN_ELEVATION). This
	// component applies the hints and owns the game-specific shadow config, which
	// deliberately stays out of the descriptor.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import {
		Box3,
		Sphere,
		Vector3,
		type DirectionalLight,
		type HemisphereLight,
		type InstancedMesh,
		type Mesh
	} from 'three/webgpu';
	import { descriptor } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';

	interface Props {
		/** Minimum distance the light is placed along the key direction from the fitted centre. */
		distance?: number;
		/**
		 * MINIMUM half-extent of the orthographic shadow box, in world units, and the step
		 * the auto-fit quantises to. The box never shrinks below this, so a small scene
		 * keeps the crisp shadows this number was picked for.
		 */
		shadowRadius?: number;
		/**
		 * Ceiling on the auto-fitted half-extent. A stray physics body flung to infinity
		 * must not be allowed to inflate the box until every shadow in the frame is mush;
		 * past this the far content simply goes unshadowed again, which is the old
		 * behaviour rather than a new failure.
		 */
		maxShadowRadius?: number;
		/** Wall-clock ms between refit passes — the fit walks the scene graph. */
		fitIntervalMs?: number;
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
		maxShadowRadius = 400,
		fitIntervalMs = 500,
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

	const { scene, autoRenderTask } = useThrelte();

	// ── Shadow auto-fit ──────────────────────────────────────────────────────────
	//
	// THE BOX USED TO BE A FIXED ±20 CUBE AT THE WORLD ORIGIN, sized for DemoScene's
	// 20x20 floor. Anything outside it is absent from the shadow map entirely — it
	// neither casts nor receives, so the key light passes straight through it. Load a
	// GLTF bigger than 40 units across and the sun shines through its walls. At sunset
	// it is worse in three ways at once: KEY_MIN_ELEVATION floors the aim at 3 degrees,
	// so the shadow camera looks nearly HORIZONTALLY, which (a) spends the ±20
	// top/bottom on world *height* rather than ground, and (b) put casters more than
	// ~45 units along the sun axis past the old `distance * 2.5` far plane.
	//
	// So the frustum is fitted to the visible shadow casters instead. Three properties
	// make that safe rather than a new source of flicker:
	//
	//   1. `shadowRadius` is a FLOOR, not a value — a small scene is unchanged.
	//   2. The radius is QUANTISED to that floor. Texel density is a function of the
	//      box, so a box that tracked the bounds continuously would re-blur every
	//      shadow in the frame as a physics body rolled; on the quantised ladder
	//      (20, 40, 60 …) ordinary motion inside a band costs nothing at all.
	//   3. The centre is snapped to the shadow map's texel grid. An unsnapped centre
	//      slides the whole depth raster under the geometry and every shadow edge
	//      crawls — the classic shimmer, and it would be *introduced* by making the
	//      centre mobile, which it never was before.
	//
	// This is still ONE cascade. Past `maxShadowRadius` the honest answer is
	// CSMShadowNode (DOCS/best-practices.md §2.6), not a bigger single map.

	// Pre-allocated: a task never allocates (core/utils/CLAUDE.md).
	const casterBounds = new Box3();
	const meshBounds = new Box3();
	const casterSphere = new Sphere();
	const fitCenter = new Vector3();

	/**
	 * Normal-offset bias, in shadow-map texels. Scaled by texel size rather than fixed
	 * because acne is a texel-footprint artefact: at ±20 over 2048² a texel is 2 cm and
	 * the old zero bias was fine, at ±400 it is 39 cm and it very much is not.
	 */
	const NORMAL_BIAS_TEXELS = 1.5;

	/** The pre-fit far plane, i.e. the fit at the `shadowRadius` floor. Template-only. */
	const floorFar = $derived(Math.max(distance, shadowRadius * 1.5) + shadowRadius);

	// Plain variables, never reactive: the fit is a per-frame quantity like the
	// descriptor, and the ONE reader is the task below. `0` means "not fitted yet"; the
	// first task run always fits, so nothing reads them before they are real.
	let msSinceFit = Infinity;
	let fittedRadius = 0;
	let fittedDistance = 0;
	let fittedMapSize = 0;

	/**
	 * World-space bounds of every visible shadow caster, into `casterBounds`. Returns
	 * false if nothing casts — in which case the box falls back to the `shadowRadius`
	 * floor, because a scene with no casters has no opinion about it.
	 *
	 * `traverseVisible` is what excludes the keep-alive scenes that are mounted but
	 * hidden (Scene.svelte toggles group `visible`, it never unmounts), and
	 * `castShadow` is what excludes the sky: the dome sits at radius 1000 and would
	 * otherwise fit the box to it on the first frame.
	 */
	const measureCasters = (): boolean => {
		casterBounds.makeEmpty();

		scene.traverseVisible((object) => {
			if (object.castShadow !== true) return;

			const mesh = object as Mesh;
			if (!mesh.geometry) return;

			const instanced = mesh as unknown as InstancedMesh;
			if (instanced.isInstancedMesh) {
				// An InstancedMesh's GEOMETRY box is one instance at the origin; the real
				// extent is over `instanceMatrix`, and it moves every frame (SpawnedBodies'
				// balls and boxes are physics-driven), so it is recomputed per fit rather
				// than cached.
				instanced.computeBoundingBox();
				if (!instanced.boundingBox) return;
				meshBounds.copy(instanced.boundingBox);
			} else {
				if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
				if (!mesh.geometry.boundingBox) return;
				meshBounds.copy(mesh.geometry.boundingBox);
			}

			// One frame stale: matrixWorld is from the last render, and this task runs
			// before this frame's. Invisible at any plausible speed, and the same
			// tolerance Skybox.svelte's driver already documents.
			casterBounds.union(meshBounds.applyMatrix4(mesh.matrixWorld));
		});

		return !casterBounds.isEmpty();
	};

	/** Re-fits the frustum to the casters. Cheap enough at `fitIntervalMs`, never per frame. */
	const refit = (light: DirectionalLight): void => {
		let radius = shadowRadius;

		if (measureCasters()) {
			casterBounds.getBoundingSphere(casterSphere);
			radius = Math.min(
				maxShadowRadius,
				Math.max(shadowRadius, Math.ceil(casterSphere.radius / shadowRadius) * shadowRadius)
			);

			// Texel snap (see 3 above). Approximated in world axes rather than the light's
			// basis — the light's basis rotates with the sun, so snapping in it would move
			// the grid anyway; this kills the dominant term, which is the centre chasing
			// the bounds.
			const texel = (radius * 2) / shadowMapSize;
			fitCenter.set(
				Math.round(casterSphere.center.x / texel) * texel,
				Math.round(casterSphere.center.y / texel) * texel,
				Math.round(casterSphere.center.z / texel) * texel
			);
		}

		// The projection only has to be rebuilt when the box actually changed size —
		// which the quantisation makes rare. `shadowMapSize` is in the comparison
		// because the graphics preset can change it at runtime and the bias follows it.
		if (radius === fittedRadius && shadowMapSize === fittedMapSize) return;
		fittedRadius = radius;
		fittedMapSize = shadowMapSize;
		fittedDistance = Math.max(distance, radius * 1.5);

		const camera = light.shadow.camera;
		camera.left = -radius;
		camera.right = radius;
		camera.top = radius;
		camera.bottom = -radius;
		camera.near = 0.1;
		// The light sits `fittedDistance` from the centre, so the far side of the fitted
		// sphere is exactly this deep. The old `distance * 2.5` was unrelated to the box.
		camera.far = fittedDistance + radius;
		camera.updateProjectionMatrix();

		light.shadow.normalBias = ((radius * 2) / shadowMapSize) * NORMAL_BIAS_TEXELS;
	};

	// Reading the descriptor in a task, not an $effect: the descriptor is a plain
	// object, so there is nothing to track and no cycle to form. `before:
	// autoRenderTask` shares the constraint with Skybox.svelte's driver task, so the DAG
	// orders both before the render.
	useTask(
		(delta) => {
			if (!light) return;

			// ONE shadow render per frame, shared by every render pass. Node shadows are
			// deduped only per camera per render() call, so extra cameras (cube faces, the
			// reflector's virtual camera, Studio's PiP/selection) otherwise re-render this
			// 2048² map per pass. With autoUpdate off and needsUpdate armed here, the first
			// pass renders it once and every later pass reuses it.
			light.shadow.autoUpdate = false;
			light.shadow.needsUpdate = true;

			// Budgeted like Sky.svelte's env bake, and for the same reason: the frustum is
			// a cheap derivative to APPLY and an expensive one to MEASURE. A newly loaded
			// model is therefore up to fitIntervalMs from getting its shadows, which is
			// self-healing and needs no call site anywhere.
			msSinceFit += delta * 1000;
			if (msSinceFit >= fitIntervalMs) {
				msSinceFit = 0;
				refit(light);
			}

			const { direction, color, intensity, ambient } = descriptor.light;
			// Anchored on the fitted centre, not the world origin — the box follows the
			// content, so the light has to as well or the content leaves the frustum.
			light.position.set(
				fitCenter.x + direction.x * fittedDistance,
				fitCenter.y + direction.y * fittedDistance,
				fitCenter.z + direction.z * fittedDistance
			);
			light.target.position.copy(fitCenter);
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

<!-- The frustum here is only the PRE-FIT state (the floor values); `refit` owns it from
     the first task run onward. `light.target` has to be in the graph for its matrixWorld
     to update — LightShadow.updateMatrices reads it to aim the shadow camera, and until
     the fit made the centre mobile it got away with sitting at an unparented origin. -->
<T.DirectionalLight
	bind:ref={light}
	{castShadow}
	shadow.camera.left={-shadowRadius}
	shadow.camera.right={shadowRadius}
	shadow.camera.top={shadowRadius}
	shadow.camera.bottom={-shadowRadius}
	shadow.camera.near={0.1}
	shadow.camera.far={floorFar}
	shadow.mapSize.width={shadowMapSize}
	shadow.mapSize.height={shadowMapSize}
	oncreate={(ref) => {
		ref.shadow.camera.updateProjectionMatrix();
		ref.target.userData = SKY_LAYER_USERDATA;
		scene.add(ref.target);
		return () => ref.target.removeFromParent();
	}}
	userData={SKY_LAYER_USERDATA}
/>

<T.HemisphereLight bind:ref={fill} userData={SKY_LAYER_USERDATA} />
