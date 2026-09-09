<script lang="ts">
	// The scene's single key light, driven by the sky descriptor's `light` slice. One
	// light, not two: sun by day, moon by night, crossfading colour and intensity across
	// the horizon band (the model aims it no lower than KEY_MIN_ELEVATION). This
	// component applies the hints and owns the game-specific shadow config, which
	// deliberately stays out of the descriptor.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import type { HemisphereLight } from 'three/webgpu';
	import { SunLight } from 'three/addons/lights/SunLight.js';
	import { descriptor } from './model';
	import { SKY_LAYER_USERDATA } from './layers/skyLayer';
	import { setKeyShadow } from './keyShadow';

	interface Props {
		/**
		 * How far along the key direction the light object is parked. `SunLight` takes its
		 * DIRECTION from its position (it has no target, like a hemisphere light) and the
		 * magnitude is normalised away, so this is cosmetic — it only decides where the
		 * gizmo sits in the Studio viewport.
		 */
		distance?: number;
		/**
		 * How far from the camera shadows are drawn, in world units — `shadow.camera.far`,
		 * the only real shadow-budget knob left. The cascades split the range from the view
		 * camera's near plane to THIS OR the camera's own `far`, whichever is smaller, so a
		 * value beyond the camera range buys nothing and only spreads texels thinner.
		 *
		 * Cost is flat in this number (the same two maps are rendered either way); what it
		 * buys is reach and what it spends is sharpness.
		 */
		shadowDistance?: number;
		/**
		 * Shadow map resolution PER CASCADE, passed by Skybox.svelte from the graphics
		 * preset. The two cascades share one atlas, so the allocation is `2 × size × size`.
		 * Changing it at runtime works: `SunShadowNode.renderShadow()` re-applies the atlas
		 * size on every shadow render, so a new size lands on the next rendered frame.
		 */
		shadowMapSize?: number;
		castShadow?: boolean;
		/**
		 * Normal-offset bias, in shadow-map TEXELS of the near cascade — acne is a texel
		 * footprint artefact, so the world-space bias has to follow the fit rather than sit
		 * at a constant. Measured off the fitted near cascade each frame (see the task), so
		 * it tracks camera fov and `shadowDistance` without being told about either.
		 *
		 * ONE BIAS SERVES BOTH CASCADES — `normalBias` is a world-space offset on
		 * `LightShadow`, and there is nowhere to put a second. Taking it from the NEAR
		 * cascade is deliberate: over-biasing near the camera detaches contact shadows from
		 * their casters, which reads immediately, where a little acne at fifty units does
		 * not. Raise it if distant surfaces shimmer; the cost is paid up close.
		 */
		normalBiasTexels?: number;
		/**
		 * Scales the descriptor's ambient fill. The model publishes a sky-appropriate
		 * level; how much a scene wants is game-specific, like the shadow config.
		 */
		fillScale?: number;
	}

	let {
		distance = 30,
		shadowDistance = 120,
		shadowMapSize = 2048,
		castShadow = true,
		normalBiasTexels = 1.5,
		fillScale = 1
	}: Props = $props();

	// ── Why this is a SunLight and not a DirectionalLight ────────────────────────
	//
	// It used to be a `DirectionalLight` with ONE shadow cascade, whose orthographic box
	// this component fitted itself: every 500 ms it walked the scene graph for visible
	// casters, took their bounding sphere, quantised the radius to a floor and snapped the
	// centre to the texel grid. That works for a scene that fits in one box and fails
	// completely for one that does not — TestGame's track is ~3 km across, the fit
	// saturated at its cap centred a kilometre from the car, and the car ended up outside
	// its own shadow frustum while all 313 725 track triangles were re-rendered into the
	// map every frame to produce nothing (`DOCS/testperf.md` §1.1). The verdict there, and
	// in `best-practices.md` §2.6, was that one cascade cannot serve a 3 km track and a 4 m
	// car and that cascaded shadow maps are the honest answer.
	//
	// three r186 ships them: `SunLight` + `SunLightNode` fit TWO cascades to the view
	// camera's frustum (a practical split, bounding-sphere projections so a turning camera
	// does not swim, texel snapping, and a fade band where the two meet), render them into
	// one atlas, and cap the whole thing at `shadow.camera.far`. Fitting to the CAMERA
	// rather than to the content is what removes the failure mode: what the player can see
	// is what gets shadowed, whatever size the world is.
	//
	// What this component lost with the old fit: the caster traversal, the quantisation,
	// the texel snap, the `shadowRadius`/`maxShadowRadius`/`fitIntervalMs` props — all of
	// it is inside `SunLightShadow` now, done per cascade and per frame instead of every
	// 500 ms. What it keeps: the descriptor plumbing, the hemisphere fill, and the bias,
	// which still has to be derived from the fit (see `normalBiasTexels`).
	//
	// TWO CONSEQUENCES WORTH KNOWING. The shadow pass draws twice per frame now, once per
	// cascade — flat cost, independent of `shadowDistance`. And the fit depends on which
	// camera renders the map, which is why the once-a-frame arming lives in
	// `keyShadow.ts` / `Renderer.svelte` and not in the task below; read that header
	// before moving it back.
	//
	// `SunLight` comes from `three/addons`, which imports core classes from the plain
	// `three` entrypoint rather than `three/webgpu`. That is fine here — three's own
	// type tests are `isFoo` flags, not `instanceof` — and the plain entrypoint is
	// already in the bundle for `THREE.Audio`. It does mean the light has to be
	// registered with the renderer's node library before it can be used on WebGPU, which
	// `App.svelte` does at renderer construction.

	// $state.raw, not $state: proxying a three.js instance breaks it, and nothing here
	// reads the light reactively -- the task writes it directly each frame.
	let light = $state.raw<SunLight>();
	// The ambient half: the env map bakes black at night (see MOON_AMBIENT), so the
	// model publishes a fill and this mounts it. A hemisphere rather than a flat ambient
	// so the fill still has a direction -- uniform ambient flattens every form it touches.
	let fill = $state.raw<HemisphereLight>();

	const { autoRenderTask } = useThrelte();

	// The shadow budget, re-applied whenever the preset changes it. Plain writes onto
	// three objects (nothing here is reactive), so this cannot feed back into itself.
	$effect(() => {
		if (!light) return;
		light.shadow.camera.far = shadowDistance;
		light.shadow.mapSize.setScalar(shadowMapSize);
	});

	// Reading the descriptor in a task, not an $effect: the descriptor is a plain
	// object, so there is nothing to track and no cycle to form. `before:
	// autoRenderTask` shares the constraint with Skybox.svelte's driver task, so the DAG
	// orders both before the render.
	useTask(
		() => {
			if (!light) return;

			const { direction, color, intensity, ambient } = descriptor.light;
			// A SunLight shines from its position toward the origin, so the position IS the
			// direction; `distance` only decides where the gizmo sits (see the prop).
			light.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
			light.color.setRGB(color[0], color[1], color[2]);
			light.intensity = intensity;

			// Bias off the fit, one frame stale — the near cascade's box is what the shadow
			// atlas was last rendered with, and it only moves when the camera's fov or range
			// does. Zero-width before the first shadow render, hence the guard.
			const cascade = light.shadow.getCamera(0);
			const texel = (cascade.right - cascade.left) / shadowMapSize;
			if (texel > 0) light.shadow.normalBias = texel * normalBiasTexels;

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

<!-- The shadow map is rendered once per frame, from the main camera, and reused by every
     other pass — `autoUpdate` off here, `needsUpdate` armed by Renderer.svelte just
     before the main draw. With cascades that is a correctness requirement rather than an
     optimization; keyShadow.ts has the whole story. -->
<T
	is={SunLight}
	bind:ref={light}
	{castShadow}
	oncreate={(ref) => {
		ref.shadow.autoUpdate = false;
		ref.shadow.camera.far = shadowDistance;
		ref.shadow.mapSize.setScalar(shadowMapSize);
		setKeyShadow(ref.shadow);
		return () => setKeyShadow(null);
	}}
	userData={SKY_LAYER_USERDATA}
/>

<T.HemisphereLight bind:ref={fill} userData={SKY_LAYER_USERDATA} />
