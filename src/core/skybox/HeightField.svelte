<script lang="ts">
	// Fills the precipitation height field (heightField.ts): one orthographic pass looking
	// straight down over the precipitation box, writing each surface's world Y.
	//
	// HOW THE SKY EXCLUDES ITSELF. The pass uses `scene.overrideMaterial`, which three
	// applies to every material with `allowOverride === true` (Scene.js documents that flag
	// as exactly this escape hatch). But an opted-out material still DRAWS -- it just draws
	// with its own shader -- so opting out is not enough for the sky layers: they would
	// write their own colour into the height map. They are hidden outright for the duration
	// of the pass instead, via the group ref Skybox.svelte hands down. That also excludes
	// Rain and Snow themselves, which live in the same group and must not collide with each
	// other.
	//
	// THE BUDGET, exactly like Sky.svelte's env bake. The pass is skipped entirely unless
	// something is falling, then runs at most every `intervalMs` -- or immediately once the
	// camera has moved far enough that the map's footprint no longer covers the box. A
	// periodic refresh is needed regardless of camera movement because the scene itself
	// moves: the demo's physics bodies roll around underneath the rain.
	//
	// EVERYTHING IT TOUCHES IS RESTORED. The render target, the clear colour and its alpha,
	// `scene.overrideMaterial`, `scene.background` and the sky group's visibility are all
	// saved and put back in the same task, so a frame that runs this pass is otherwise
	// indistinguishable from one that does not.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Object3D } from 'three/webgpu';
	import { positionWorld, vec3 } from 'three/tsl';
	import { descriptor } from './model';
	import { heightFieldState, heightTarget, uHeightCenter, uHeightExtent } from './heightField';

	interface Props {
		/**
		 * Half-extent of the map's world footprint. Must cover the precipitation box --
		 * Rain's is 70 wide, so 40 leaves margin for wind drift at the edges.
		 */
		extent?: number;
		/** How far above the camera the pass camera sits, and how far down it sees. */
		height?: number;
		depth?: number;
		/** Minimum wall-clock ms between passes. */
		intervalMs?: number;
		/** Re-bake early once the camera has moved this far horizontally since the last one. */
		cameraDeltaWorld?: number;
		/**
		 * The sky group, hidden for the duration of the pass. Passed as a getter because
		 * the ref is bound after this component mounts.
		 */
		exclude?: () => Object3D | undefined;
	}

	let {
		extent = 40,
		height = 120,
		depth = 400,
		intervalMs = 150,
		cameraDeltaWorld = 6,
		exclude
	}: Props = $props();

	const { scene, renderer, camera, autoRenderTask } = useThrelte();

	// Orthographic and axis-aligned by construction, which is what lets heightField.ts map
	// world XZ into map UV with two scalars instead of a full matrix. The frustum is left
	// at placeholders here and set from the props in `runPass` -- reading them at the top
	// level would capture only their initial values.
	const passCamera = new THREE.OrthographicCamera();
	// Looking straight down. `up` must not be parallel to the view direction or the view
	// matrix is degenerate, so +Z is used rather than the default +Y.
	passCamera.up.set(0, 0, 1);

	/**
	 * The override material: every surface reports its own world Y.
	 *
	 * `toneMapped = false` is load-bearing -- the red channel is a coordinate, and AgX
	 * would curve it into nonsense. Alpha is left at the default 1, which is what makes the
	 * clear-to-alpha-0 trick below work as a "nothing here" flag.
	 */
	const heightMaterial = new THREE.MeshBasicNodeMaterial();
	heightMaterial.colorNode = vec3(positionWorld.y);
	heightMaterial.toneMapped = false;
	heightMaterial.fog = false;
	heightMaterial.side = THREE.DoubleSide;

	// Plain variables, written and read only by the task.
	let msSincePass = Infinity;
	let lastX = 0;
	let lastZ = 0;

	const clearColor = new THREE.Color();

	const runPass = () => {
		const cam = camera.current;
		const cx = cam.position.x;
		const cz = cam.position.z;

		passCamera.position.set(cx, cam.position.y + height, cz);
		passCamera.lookAt(cx, cam.position.y + height - 1, cz);
		passCamera.left = -extent;
		passCamera.right = extent;
		passCamera.top = extent;
		passCamera.bottom = -extent;
		passCamera.near = 0.1;
		passCamera.far = depth;
		passCamera.updateProjectionMatrix();
		passCamera.updateMatrixWorld();

		// Save everything the pass is about to change.
		const previousTarget = renderer.getRenderTarget();
		const previousOverride = scene.overrideMaterial;
		const previousBackground = scene.background;
		const previousAlpha = renderer.getClearAlpha();
		renderer.getClearColor(clearColor);
		const skyGroup = exclude?.();
		const previousSkyVisible = skyGroup?.visible;

		// Alpha 0 is the "no surface" flag (see heightField.ts). It cannot be a negative
		// red value, because `setClearColor` takes a Color and those are 0..1 -- the alpha
		// channel is the one place a clear can carry a flag a real surface never writes.
		renderer.setClearColor(0x000000, 0);
		// A scene background renders with `allowOverride: false`, so it would paint its own
		// colour straight into the height map.
		scene.background = null;
		scene.overrideMaterial = heightMaterial;
		if (skyGroup) skyGroup.visible = false;

		renderer.setRenderTarget(heightTarget);
		renderer.clear();
		renderer.render(scene, passCamera);

		renderer.setRenderTarget(previousTarget);
		scene.overrideMaterial = previousOverride;
		scene.background = previousBackground;
		renderer.setClearColor(clearColor, previousAlpha);
		if (skyGroup && previousSkyVisible !== undefined) skyGroup.visible = previousSkyVisible;

		uHeightCenter.value.set(cx, cz);
		uHeightExtent.value = extent;
		heightFieldState.centerX = cx;
		heightFieldState.centerZ = cz;
		heightFieldState.extent = extent;
		heightFieldState.baked = true;

		msSincePass = 0;
		lastX = cx;
		lastZ = cz;
	};

	useTask(
		(delta) => {
			msSincePass += delta * 1000;

			// Nothing falling, nothing to collide with. The map keeps its last contents and
			// its alpha flags, but no consumer reads them while precipitation is at zero --
			// and `heightFieldState.baked` staying false on a fresh boot means the very
			// first drops fall through rather than against a blank map.
			if (descriptor.weather.precipitation <= 0.01) return;

			const cam = camera.current;
			const moved = Math.hypot(cam.position.x - lastX, cam.position.z - lastZ);
			if (heightFieldState.baked && moved < cameraDeltaWorld && msSincePass < intervalMs) return;

			runPass();
		},
		// Before the render, and before the layers that read the map -- Skybox mounts this
		// component ahead of the precipitation group, and among tasks sharing a constraint
		// Threlte's DAG falls back to registration order.
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			heightMaterial.dispose();
			heightFieldState.baked = false;
		};
	});
</script>
