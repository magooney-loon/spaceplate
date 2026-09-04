<script lang="ts">
	import { useThrelte } from '@threlte/core/webgpu';
	import { CameraControls, useFollow } from '@threlte/extras';
	import type CameraControlsRef from 'camera-controls';
	import * as THREE from 'three/webgpu';
	import { sceneState } from '$extensions/scene';

	// Third-person / bird chase camera for the car.
	//
	// It drives the APP'S camera (core/Camera.svelte — the one carrying the
	// AudioListener), not a second `makeDefault` camera: `<CameraControls>` with no
	// camera prop and a non-camera parent falls through to the default camera, and one
	// camera means the listener, the sky's framing and post-processing all keep matching
	// what is on screen. The cost is that this component BORROWS a shared object, so it
	// saves the pose on activation and puts it back on the way out — Camera.svelte sets
	// its vantage once, in `oncreate`, and would never restore it itself.
	//
	// Scene gating is a hard requirement, not politeness: scenes are keep-alive, so this
	// component stays mounted while MainMenu/DemoScene are current, and useFollow's task
	// calls invalidate() on every frame it does work. Ungated that pins Threlte's
	// on-demand render loop at full rate forever, in every scene (src/CLAUDE.md). A falsy
	// `target` makes the hook return before it invalidates, and `enabled={active}` does
	// the same for CameraControls' own update task.

	let { target }: { target?: THREE.Object3D } = $props();

	const CHASE_DISTANCE = 12; // world units behind the car
	const CHASE_POLAR = 1.15; // rad from +Y — ~24° above the horizon, so it reads "bird"
	// The anchor sits at the car's middle and the car is ~3.3 world units tall, so anything
	// under ~1.5 puts the camera inside the cabin — that is the point, zoom all the way in
	// and you are sitting in it. The floor is a hair off zero because camera-controls
	// requires a positive minDistance; the camera's near plane is 0.001, so nothing clips
	// on the way in.
	const MIN_DISTANCE = 0.05;
	const MAX_DISTANCE = 30;

	const { camera, invalidate } = useThrelte();
	let controls = $state.raw<CameraControlsRef>();

	// Stand down while Studio is flying its editor camera (dev only). `camera.current` IS
	// the editor camera then, and `CameraControls.update()` writes position + lookAt on
	// every call with no dirty check — two rigs on one camera means neither wins
	// (the same collision FlyPath.svelte documents at length). Detected by the marker
	// Studio's EditorCamera.svelte stamps on both of its cameras, so this file never
	// imports a dev-only module.
	const isEditorCamera = (cam: THREE.Camera | undefined) => cam?.userData.editorCamera === true;

	const active = $derived(sceneState.currentScene === 'testGame' && !isEditorCamera($camera));

	useFollow(() => ({
		target: active ? target : undefined,
		controls,
		// The target IS the chase anchor (TestGame parents it inside the RigidBody at the
		// car's middle), so nothing to offset here.
		lookAtOffset: [0, 0, 0],
		// A trailing rig: the camera lags the car slightly under acceleration and leads it
		// into the direction of travel, which is what sells speed.
		followSmoothTime: 0.12,
		lookAhead: 0.18,
		// Track the car's yaw so the camera swings behind it through corners. Smoothed,
		// or the whole frame snaps sideways the instant the car's nose moves.
		trackRotation: true,
		trackRotationSmoothTime: 0.35,
		// 0 (not π): the model's nose is -Z, so azimuth 0 already sits BEHIND the car.
		trackRotationOffset: 0
	}));

	// Borrow/return the shared camera. Deactivation is the effect's own cleanup, so it
	// covers scene switches AND unmount with one code path.
	const savedPosition = new THREE.Vector3();
	const savedQuaternion = new THREE.Quaternion();

	const _p = new THREE.Vector3();
	const _q = new THREE.Quaternion();
	const _s = new THREE.Vector3();
	const _e = new THREE.Euler(0, 0, 0, 'YXZ');

	$effect(() => {
		const rig = controls;
		if (!rig || !target || !active) return;

		// `$camera`, not `camera.current`: a camera swap under us must re-run this, so the
		// pose is saved off the camera we are about to move and given back to that same one.
		const cam = $camera;
		savedPosition.copy(cam.position);
		savedQuaternion.copy(cam.quaternion);

		// Snap the rig behind the car ONCE, on entry. From here useFollow owns the orbit
		// point and the azimuth; distance and polar angle stay wherever the player's wheel
		// and drag leave them.
		target.updateWorldMatrix(true, false);
		target.matrixWorld.decompose(_p, _q, _s);
		_e.setFromQuaternion(_q, 'YXZ');
		rig.moveTo(_p.x, _p.y, _p.z, false);
		rig.azimuthAngle = _e.y;
		rig.polarAngle = CHASE_POLAR;
		rig.distance = CHASE_DISTANCE;
		invalidate();

		return () => {
			cam.position.copy(savedPosition);
			cam.quaternion.copy(savedQuaternion);
			invalidate();
		};
	});
</script>

<CameraControls
	bind:ref={controls}
	enabled={active}
	minDistance={MIN_DISTANCE}
	maxDistance={MAX_DISTANCE}
/>
