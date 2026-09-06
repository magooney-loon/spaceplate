<script lang="ts">
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { CameraControls, useFollow } from '@threlte/extras';
	import CameraControlsImpl from 'camera-controls';
	import * as THREE from 'three/webgpu';
	import { carSim } from './carTelemetry.svelte';
	import { clamp, damp } from './carMath';

	// Third-person / bird chase camera for the car.
	//
	// It drives the APP'S camera (core/Camera.svelte — the one carrying the
	// AudioListener), not a second `makeDefault` camera: `<CameraControls>` with no
	// camera prop and a non-camera parent falls through to the default camera, and one
	// camera means the listener, the sky's framing and post-processing all keep matching
	// what is on screen. The cost is that this component BORROWS a shared object, so it
	// saves the pose on activation and puts it back on the way out — Camera.svelte sets
	// its vantage once, in `oncreate`, and would never restore it itself.

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
	// Right-drag height. Sits in useFollow's `lookAtOffset`, which the hook adds to the
	// tracked point UNSMOOTHED every frame — the one part of the rig meant to be tweaked
	// live. Dragging the target up lifts the whole orbit, so the camera rises with it.
	const HEIGHT_MIN = -1.4; // below the roofline, looking up the road
	const HEIGHT_MAX = 6; // helicopter
	const HEIGHT_PER_PX = 0.014;

	// ── Nitrous FOV kick ─────────────────────────────────────────────────────────
	// Widening the lens while the system sprays is the "kickback" that sells the
	// shove — the flames sell the cause, this sells the effect. Driven off the
	// smoothed FLOW (carSim.nitrous), never the raw key: it punches out with the
	// 8/s spray ramp and eases back in with the 4/s tail, and a light extra damp
	// on top keeps the lens itself from snapping between physics-sized steps.
	const NITROUS_FOV_KICK = 12; // deg of widening at full flow (60 → 72)
	const FOV_RATE = 12; // 1/s — lens settling on top of the flow ramp

	// ── Launch dolly kick ──────────────────────────────────────────────────
	// A rev-match launch shoves the camera IN with the clutch drop and lets the
	// boost's own tail pull it back out — driven off carSim.launch (the same
	// signal the tyre squeal reads), so the punch scales with the catch and dies
	// with the boost: a STREET catch barely moves the lens, a PERFECT one lunges.
	// The dolly is a DELTA on the rig's distance, recovered every frame, so the
	// player's wheel zoom survives under it; clamped to 60% of the base so the
	// kick can never shove the camera inside the car.
	const LAUNCH_DOLLY = 3.5; // world units toward the car at full quality
	const LAUNCH_FOV_KICK = 12; // deg of widening at full quality, stacking on nitrous
	const KICK_RATE = 14; // 1/s — a shove is a punch, not a drift
	/** Smoothed boost level driving dolly + FOV together. */
	let kickLevel = 0;
	/** World units currently added to the rig's distance (negative = closer). */
	let appliedKick = 0;

	// ── Shift kick ──────────────────────────────────────────────────────
	// Up/down shifts get their own nudge, edge-detected off carSim.gear (no
	// drivetrain wiring needed): UPSHIFT = KICKBACK — the post-cut surge throws
	// the camera back (dolly out + FOV widen); DOWNSHIFT = KICK IN — the
	// engine-braking grab shoves it toward the car (dolly in + FOV narrow), in
	// sync with the downshift exhaust bang. Subtlety is the design constraint:
	// shifts are frequent, so the kick must read as the car's motion, never as
	// the camera glitching — HALF the launch's magnitude, and crucially it never
	// STEPS: the impulse is ramped through a one-pole filter (SHIFT_ATTACK), so
	// the lens swells into the kick and eases out of it. Only real driving
	// shifts (both sides ≥ 1st) count — N/R slotting is not a shift, and the
	// N→1 launch has its own (much bigger) kick.
	const SHIFT_DOLLY = 0.45; // world units of nudge
	const SHIFT_FOV_KICK = 1.5; // deg — widen on the upshift's surge, narrow on the downshift's grab
	const SHIFT_KICK_RATE = 7; // 1/s — the impulse's decay
	const SHIFT_ATTACK = 12; // 1/s — the ramp IN; no frame ever steps
	/** Signed impulse, +1 = upshift kickback, -1 = downshift kick in. */
	let shiftKick = 0;
	/** The applied kick — `shiftKick` ramped through a one-pole, so nothing steps. */
	let shiftLevel = 0;
	/** Last frame's gear — the edge detector. */
	let prevGear = 1;

	const { camera, dom, invalidate } = useThrelte();
	let controls = $state.raw<CameraControlsImpl>();
	let lookHeight = $state(0);

	// Stand down while Studio is flying its editor camera (dev only). `camera.current` IS
	// the editor camera then, and `CameraControls.update()` writes position + lookAt on
	// every call with no dirty check — two rigs on one camera means neither wins
	// (the same collision FlyPath.svelte documents at length). Detected by the marker
	// Studio's EditorCamera.svelte stamps on both of its cameras, so this file never
	// imports a dev-only module. A falsy `target` makes useFollow return before it
	// invalidates, and `enabled={active}` does the same for CameraControls' own task.
	const isEditorCamera = (cam: THREE.Camera | undefined) => cam?.userData.editorCamera === true;

	const active = $derived(!isEditorCamera($camera));

	useFollow(() => ({
		target: active ? target : undefined,
		controls,
		// The target IS the chase anchor (TestGame parents it inside the RigidBody at the
		// car's middle), so the only offset is the player's right-drag height.
		lookAtOffset: [0, lookHeight, 0],
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
	// covers unmount (and a Studio camera swap) with one code path.
	const savedPosition = new THREE.Vector3();
	const savedQuaternion = new THREE.Quaternion();
	let savedFov = 60;
	/** The lens' current animated value — adopted from the camera at each borrow,
	 * so a re-entry (or camera swap) can never animate from a stale value and
	 * jump. Plain let, not state: only the task below reads it. */
	let fov = 60;

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
		// The FOV is borrowed like the pose (the kick below widens it): save it, and
		// adopt it as the animation's starting point so the task can't jump. Guarded —
		// only a perspective camera has a fov to save.
		if (cam instanceof THREE.PerspectiveCamera) {
			savedFov = cam.fov;
			fov = cam.fov;
		}

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
		// Re-entry must not recover a stale zoom base out of a leftover kick, nor
		// read the current gear as a shift.
		kickLevel = 0;
		appliedKick = 0;
		shiftKick = 0;
		shiftLevel = 0;
		prevGear = carSim.gear;
		invalidate();

		return () => {
			cam.position.copy(savedPosition);
			cam.quaternion.copy(savedQuaternion);
			if (cam instanceof THREE.PerspectiveCamera) {
				cam.fov = savedFov;
				cam.updateProjectionMatrix();
			}
			invalidate();
		};
	});

	// The kick itself. Same borrow scope as the effect above (controls + target +
	// active), so `fov`/`savedFov` are always the borrowed camera's before this
	// runs. `autoInvalidate: false` is LOAD-BEARING — the option defaults to true,
	// and a bare useTask invalidates every frame it runs, pinning the on-demand
	// render loop at full rate forever (LensDriver/Renderer pass it for the same
	// reason). On-demand discipline: the task only invalidates on a frame where the
	// lens actually moved — settled at base with no spray is free, and while the
	// car is spraying the flames' pilot jet is already pinning the render loop.
	useTask(
		(delta) => {
			if (!active || !controls || !target) return;
			const cam = camera.current;
			if (!(cam instanceof THREE.PerspectiveCamera)) return;

			// ── Launch kick: snap in with the drop, ease out with the boost tail. ──
			const boost = clamp(carSim.launch, 0, 1);
			kickLevel += (boost - kickLevel) * damp(KICK_RATE, delta);

			// ── Shift kick: edge-detect the gear, decay the impulse, ramp the level. ─
			const gear = carSim.gear;
			if (gear !== prevGear) {
				if (prevGear >= 1 && gear >= 1 && carSim.launch <= 0) {
					shiftKick = clamp(shiftKick + (gear > prevGear ? 1 : -1), -1, 1);
				}
				prevGear = gear;
			}
			shiftKick *= Math.exp(-SHIFT_KICK_RATE * delta);
			if (Math.abs(shiftKick) < 0.001) shiftKick = 0;
			// The one-pole: the lens swells into the kick and eases out — no step.
			shiftLevel += (shiftKick - shiftLevel) * damp(SHIFT_ATTACK, delta);
			if (shiftKick === 0 && Math.abs(shiftLevel) < 0.001) shiftLevel = 0;

			if (kickLevel > 0.001 || shiftLevel !== 0 || appliedKick !== 0) {
				// Recover the player's zoom from under last frame's kick, then apply
				// this frame's — a wheel zoom mid-launch lands in the base, not the kick.
				const base = controls.distance - appliedKick;
				const wanted =
					-Math.min(LAUNCH_DOLLY * kickLevel, base * 0.6) + SHIFT_DOLLY * shiftLevel;
				const d = clamp(base + wanted, MIN_DISTANCE, MAX_DISTANCE);
				appliedKick = d - base;
				controls.distance = d;
				invalidate();
			}

			const flow = clamp(carSim.nitrous, 0, 1);
			const fovTarget =
				savedFov + NITROUS_FOV_KICK * flow + LAUNCH_FOV_KICK * kickLevel + SHIFT_FOV_KICK * shiftLevel;
			if (Math.abs(fovTarget - fov) < 0.01) {
				// Settled — snap exactly, and only touch the camera (and invalidate) if
				// the snap is a change.
				fov = fovTarget;
				if (cam.fov !== fovTarget) {
					cam.fov = fovTarget;
					cam.updateProjectionMatrix();
					invalidate();
				}
				return;
			}
			fov += (fovTarget - fov) * damp(FOV_RATE, delta);
			cam.fov = fov;
			cam.updateProjectionMatrix();
			invalidate();
		},
		{ autoInvalidate: false }
	);

	// Right button is OURS. camera-controls binds it to TRUCK by default, which pans the
	// orbit target — and useFollow writes that target back to the car every frame, so the
	// stock binding is dead input anyway. Taking it means one owner, not two.
	$effect(() => {
		if (controls) controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
	});

	// Right-drag = raise/lower the camera. Drag up, camera goes up.
	$effect(() => {
		if (!active) return;

		let pointer: number | null = null;

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 2) return;
			pointer = e.pointerId;
			dom.setPointerCapture(e.pointerId);
			e.preventDefault();
		};
		const onPointerMove = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			const next = lookHeight - e.movementY * HEIGHT_PER_PX;
			lookHeight = next < HEIGHT_MIN ? HEIGHT_MIN : next > HEIGHT_MAX ? HEIGHT_MAX : next;
			invalidate();
		};
		const endDrag = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
			pointer = null;
		};
		// Without this the browser menu eats the drag on the first frame.
		const onContextMenu = (e: Event) => e.preventDefault();

		dom.addEventListener('pointerdown', onPointerDown);
		dom.addEventListener('pointermove', onPointerMove);
		dom.addEventListener('pointerup', endDrag);
		dom.addEventListener('pointercancel', endDrag);
		dom.addEventListener('contextmenu', onContextMenu);

		return () => {
			dom.removeEventListener('pointerdown', onPointerDown);
			dom.removeEventListener('pointermove', onPointerMove);
			dom.removeEventListener('pointerup', endDrag);
			dom.removeEventListener('pointercancel', endDrag);
			dom.removeEventListener('contextmenu', onContextMenu);
			if (pointer !== null && dom.hasPointerCapture(pointer)) dom.releasePointerCapture(pointer);
		};
	});
</script>

<CameraControls
	bind:ref={controls}
	enabled={active}
	minDistance={MIN_DISTANCE}
	maxDistance={MAX_DISTANCE}
/>
