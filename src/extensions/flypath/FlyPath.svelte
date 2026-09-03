<script lang="ts">
	// The flypath driver — owns the curve, drives the camera, draws the authoring overlay.
	//
	// WHICH CAMERA. Waypoints snapshot `camera.current` and playback drives
	// `camera.current` — the same object either way, never swapped: `Renderer.svelte`'s
	// structural effect tracks `$camera` and rebuilds the entire post-processing
	// pipeline when it changes, so a swap mid-recording would hitch the take. (Playing
	// while the editor camera is on means Studio's CameraControls fights the path for
	// the same object; the panel warns about it. The transform is saved on first engage
	// and restored on stop — see flypath/CLAUDE.md for the workflow.)
	//
	// TASK ORDER: `{ before: autoRenderTask }` — the pose must be written before the frame
	// is drawn. Capture's blit is `{ after: autoRenderTask }`, so within one frame the
	// order is: move camera → render → grab. That is what makes a recorded flythrough
	// frame-accurate.

	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { captureActions, captureState } from '$extensions/capture';
	import { logEngine } from '$extensions/logger';
	import {
		EASINGS,
		flyPathState,
		persistFlyPath,
		registerFlyPathDriver,
		segmentCount,
		totalDuration,
		unregisterFlyPathDriver
	} from './flypath.svelte';

	const { camera, invalidate, autoRenderTask } = useThrelte();

	const activeCamera = () => camera.current as THREE.PerspectiveCamera | undefined;

	// --- the curve -----------------------------------------------------------------

	const curve = $derived.by(() => {
		const waypoints = flyPathState.waypoints;
		if (waypoints.length < 2) return null;
		const points = waypoints.map(
			(w) => new THREE.Vector3(w.position[0], w.position[1], w.position[2])
		);
		return new THREE.CatmullRomCurve3(
			points,
			flyPathState.loop,
			'catmullrom',
			flyPathState.tension
		);
	});

	// Rebuilt whenever the curve changes — including per frame while a marker is dragged,
	// which is what makes the overlay track the drag. Kept modest on purpose.
	const tubeGeometry = $derived.by(() => {
		const source = curve;
		if (!source) return null;
		const segments = Math.max(24, segmentCount(flyPathState) * 24);
		return new THREE.TubeGeometry(source, segments, 0.025, 6, flyPathState.loop);
	});

	$effect(() => {
		const geometry = tubeGeometry;
		// Threlte never disposes a geometry passed as a prop, so this is the only owner.
		return () => geometry?.dispose();
	});

	// --- overlay assets (script-owned, see DemoScene for the same pattern) -----------

	const tubeMaterial = new THREE.MeshBasicNodeMaterial();
	tubeMaterial.color.set('#ffb347');
	tubeMaterial.transparent = true;
	tubeMaterial.opacity = 0.55;
	tubeMaterial.depthWrite = false;
	tubeMaterial.fog = false;

	// ConeGeometry points along +Y; rotating -90° about X aims it down -Z, which is the
	// direction a camera looks. So a marker visibly shows its shot direction.
	//
	// Sized well clear of the tube's 0.025 radius, so it does not disappear into the
	// path line.
	const markerGeometry = new THREE.ConeGeometry(0.3, 0.9, 12);
	markerGeometry.rotateX(-Math.PI / 2);

	const markerMaterial = new THREE.MeshBasicNodeMaterial();
	markerMaterial.color.set('#4ec9b0');
	markerMaterial.fog = false;

	// The first waypoint is ALWAYS green and the last ALWAYS red — the tube itself is
	// symmetrical and says nothing about direction. Selection is a scale bump rather
	// than a colour, which would mask an endpoint.
	const startMaterial = new THREE.MeshBasicNodeMaterial();
	startMaterial.color.set('#3ddc84');
	startMaterial.fog = false;

	const endMaterial = new THREE.MeshBasicNodeMaterial();
	endMaterial.color.set('#ff4d4d');
	endMaterial.fog = false;

	const SELECTED_SCALE = 1.4;

	// A single waypoint is the start, not the end. On a looping path the two are neighbours,
	// which is exactly what you want to see: green and red touching is the wrap point.
	const materialFor = (index: number, count: number) => {
		if (index === 0) return startMaterial;
		if (index === count - 1) return endMaterial;
		return markerMaterial;
	};

	// The look-at target, drawn only in `lookAt` mode. An octahedron rather than a cone
	// because it has no facing — the target is a point the camera aims AT, not a pose.
	const targetGeometry = new THREE.OctahedronGeometry(0.35);

	const targetMaterial = new THREE.MeshBasicNodeMaterial();
	targetMaterial.color.set('#ff5fd2');
	targetMaterial.fog = false;

	$effect(() => () => {
		tubeMaterial.dispose();
		markerGeometry.dispose();
		markerMaterial.dispose();
		startMaterial.dispose();
		endMaterial.dispose();
		targetGeometry.dispose();
		targetMaterial.dispose();
	});

	// --- playback state --------------------------------------------------------------

	/** True once the path owns the camera (play or scrub) until stop() hands it back. */
	let engaged = false;
	let elapsed = 0;
	/** Set on the frame the path reaches its end; acted on one tick later, so that final
	 *  frame still gets rendered and blitted into a recording before it is torn down. */
	let finishing = false;
	let recording = false;
	/** Pre-roll cursor: -1 when idle, else the sweep frame about to be posed. */
	let prerollFrame = -1;
	/** True from the moment 🎬 is pressed until the take is torn down — pre-roll included. */
	const takeInFlight = () => recording || prerollFrame >= 0;

	const savedPosition = new THREE.Vector3();
	const savedQuaternion = new THREE.Quaternion();
	let savedFov = 60;
	let savedValid = false;

	const saveCamera = () => {
		const cam = activeCamera();
		if (!cam || savedValid) return;
		savedPosition.copy(cam.position);
		savedQuaternion.copy(cam.quaternion);
		savedFov = cam.fov ?? 60;
		savedValid = true;
	};

	const restoreCamera = () => {
		const cam = activeCamera();
		if (!cam || !savedValid) return;
		cam.position.copy(savedPosition);
		cam.quaternion.copy(savedQuaternion);
		if (cam.isPerspectiveCamera) {
			cam.fov = savedFov;
			cam.updateProjectionMatrix();
		}
		savedValid = false;
		invalidate();
	};

	// --- pose evaluation ---------------------------------------------------------------

	const tmpPosition = new THREE.Vector3();
	const tmpTarget = new THREE.Vector3();
	const tmpQuatA = new THREE.Quaternion();
	const tmpQuatB = new THREE.Quaternion();
	const tmpMatrix = new THREE.Matrix4();
	const UP = new THREE.Vector3(0, 1, 0);

	const applyPose = (progress: number) => {
		const cam = activeCamera();
		const source = curve;
		const segments = segmentCount(flyPathState);
		if (!cam || !source || segments === 0) return;

		const waypoints = flyPathState.waypoints;
		const clamped = Math.min(1, Math.max(0, progress));

		// Global easing, never per segment (see flypath.svelte.ts). A looping path forces
		// linear — easing in and out of every lap makes the wrap visibly hitch.
		const ease = flyPathState.loop ? EASINGS.linear : EASINGS[flyPathState.easing];
		const eased = ease(clamped);

		// Map eased progress through the per-segment durations to a segment + local u.
		let budget = 0;
		for (let i = 0; i < segments; i++) budget += Math.max(0.01, waypoints[i].duration);
		let remaining = eased * budget;
		let index = 0;
		let local = 0;
		for (let i = 0; i < segments; i++) {
			const span = Math.max(0.01, waypoints[i].duration);
			if (remaining <= span || i === segments - 1) {
				index = i;
				local = Math.min(1, remaining / span);
				break;
			}
			remaining -= span;
		}

		// CatmullRomCurve3.getPoint divides its parameter by the segment count, so
		// (index + local) / segments lands exactly on segment `index` at local u.
		source.getPoint((index + local) / segments, tmpPosition);
		cam.position.copy(tmpPosition);

		const next = (index + 1) % waypoints.length;

		if (flyPathState.orientationMode === 'lookAt') {
			const target = flyPathState.lookAtTarget;
			tmpTarget.set(target[0], target[1], target[2]);
			tmpMatrix.lookAt(tmpPosition, tmpTarget, UP);
			cam.quaternion.setFromRotationMatrix(tmpMatrix);
		} else {
			const a = waypoints[index].quaternion;
			const b = waypoints[next].quaternion;
			tmpQuatA.set(a[0], a[1], a[2], a[3]);
			tmpQuatB.set(b[0], b[1], b[2], b[3]);
			cam.quaternion.slerpQuaternions(tmpQuatA, tmpQuatB, local);
		}

		if (cam.isPerspectiveCamera) {
			const fov = THREE.MathUtils.lerp(waypoints[index].fov, waypoints[next].fov, local);
			if (Math.abs(cam.fov - fov) > 1e-4) {
				cam.fov = fov;
				cam.updateProjectionMatrix();
			}
		}

		// $state write — epsilon-gated so a 60Hz playback does not wake the panel 60x/s.
		// Every write that lands re-renders the panel's Scrub slider (FlyPathExtension):
		// tweakpane laying out a widget inside the very frame a take is trying to blit and
		// encode, so the gate widens 25x while recording. The exact 0 and 1 endpoints
		// always land either way.
		const epsilon = recording ? 0.05 : 0.002;
		if (Math.abs(flyPathState.progress - clamped) > epsilon || clamped === 0 || clamped === 1) {
			flyPathState.progress = clamped;
		}
		invalidate();
	};

	// --- driver ---------------------------------------------------------------------

	const captureWaypoint = () => {
		const cam = activeCamera();
		if (!cam) return null;
		cam.updateMatrixWorld();
		const position = new THREE.Vector3();
		const quaternion = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		// Decomposed from the WORLD matrix so a camera nested under a transformed parent
		// still records the pose you are actually looking through.
		cam.matrixWorld.decompose(position, quaternion, scale);
		return {
			position: [position.x, position.y, position.z] as [number, number, number],
			quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] as [
				number,
				number,
				number,
				number
			],
			fov: cam.isPerspectiveCamera ? cam.fov : 60
		};
	};

	const cameraPosition = (): [number, number, number] | null => {
		const cam = activeCamera();
		if (!cam) return null;
		cam.updateMatrixWorld();
		const position = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
		return [position.x, position.y, position.z];
	};

	const play = () => {
		if (segmentCount(flyPathState) === 0) return;
		saveCamera();
		engaged = true;
		finishing = false;
		if (flyPathState.progress >= 0.999) elapsed = 0;
		flyPathState.isPlaying = true;
		flyPathState.status = 'Playing…';
		invalidate();
	};

	const pause = () => {
		if (!engaged) return;
		flyPathState.isPlaying = false;
		flyPathState.status = 'Paused';
	};

	const stop = () => {
		flyPathState.isPlaying = false;
		finishing = false;
		prerollFrame = -1;
		elapsed = 0;
		flyPathState.progress = 0;
		if (recording) {
			recording = false;
			captureActions.stopRecording();
		}
		if (engaged) {
			engaged = false;
			restoreCamera();
		}
		flyPathState.status =
			flyPathState.waypoints.length < 2
				? 'Need at least 2 waypoints'
				: `${flyPathState.waypoints.length} waypoints · ${totalDuration(flyPathState).toFixed(1)}s`;
	};

	const scrub = (progress: number) => {
		// Never let a scrub tear down a take in progress — the panel already filters
		// tweakpane's programmatic 'external' change events, but a real mis-drag during a
		// recording should not ruin it either. Stop is the deliberate way out.
		if (takeInFlight()) {
			logEngine.warn('FlyPath: scrub ignored while recording — press Stop first');
			return;
		}
		saveCamera();
		engaged = true;
		flyPathState.isPlaying = false;
		elapsed = progress * totalDuration(flyPathState);
		applyPose(progress);
		flyPathState.status = `Scrubbing ${(progress * 100).toFixed(0)}%`;
	};

	const recordFlythrough = () => {
		if (segmentCount(flyPathState) === 0) return;

		// The panel already disables 🎬 while this is true, but the action is callable from
		// anywhere. Arming now would resize the shared recording canvas out from under a
		// take that is still being muxed.
		if (captureActions.isBusy()) {
			logEngine.warn('FlyPath: recording refused — the previous take is still being written');
			flyPathState.status = 'Waiting for the previous video…';
			return;
		}

		const total = totalDuration(flyPathState);
		if (flyPathState.loop) {
			logEngine.warn(
				`FlyPath: recording a LOOPING path — it will run until the capture cap (${captureState.maxDurationSec}s) stops it`
			);
		} else if (total > captureState.maxDurationSec) {
			logEngine.warn(
				`FlyPath: path is ${total.toFixed(1)}s but the capture cap is ${captureState.maxDurationSec}s — the recording will stop early`
			);
		}

		saveCamera();
		engaged = true;
		finishing = false;
		elapsed = 0;

		// isPlaying goes true HERE, not in armTake(): it is what suppresses the authoring
		// overlay, and tearing down the tube plus every marker mesh is itself a frame of
		// work. Better spent during the pre-roll than on frame 0 of the take.
		flyPathState.isPlaying = true;
		prerollFrame = 0;
		flyPathState.status = 'Warming up…';
		applyPose(0);
	};

	// --- pre-roll ---------------------------------------------------------------------
	//
	// On-demand rendering means the scene is only compiled for angles it has actually
	// been drawn from, so a flythrough into new territory compiles pipelines MID-TAKE —
	// a one-off 150-300ms stall that no per-frame trimming can prevent. Sweeping the
	// whole path once first draws every pose through the real pipeline, so those
	// compiles land before frame 0 and the far end of the path is warmed too.
	//
	// It runs through the normal render loop, one pose per rendered frame (applyPose
	// invalidates, which pins it), rather than through bootState.warmVersion: that
	// $effect drops any bump arriving while it is still warming, so a burst of them
	// would silently warm one pose and skip the rest.

	const PREROLL_FRAMES = 12;

	const armTake = () => {
		// Rewind and pose BEFORE arming the recorder, so frame 0 of the video is frame 0
		// of the path rather than the end of the pre-roll sweep. Capture's clock source
		// releases that head frame with a step of 0, so the take encodes the path exactly
		// where this leaves it.
		elapsed = 0;
		applyPose(0);

		captureActions.startRecording();
		if (!captureState.isRecording) {
			flyPathState.isPlaying = false;
			flyPathState.status = 'Recording failed — see the Capture panel';
			return;
		}
		recording = true;
		flyPathState.status = 'Recording flythrough…';
	};

	// --- marker write-back ------------------------------------------------------------
	// Studio's transform gizmo mutates the marker Object3D directly. Reading it back here
	// is what makes dragging a marker edit the path. Persisting is deferred until the drag
	// settles rather than run at 60Hz.

	const markers = new Map<string, THREE.Object3D>();
	/** The look-at target marker, when one is mounted (`lookAt` mode only). */
	let targetMarker: THREE.Object3D | null = null;
	let dirtySince = 0;

	const syncMarkers = (delta: number) => {
		let changed = false;

		// Same deal for the look-at target: dragging its marker IS how you aim the path.
		// Only the position matters — the marker's rotation means nothing.
		if (targetMarker) {
			const p = targetMarker.position;
			const target = flyPathState.lookAtTarget;
			if (
				Math.abs(p.x - target[0]) > 1e-4 ||
				Math.abs(p.y - target[1]) > 1e-4 ||
				Math.abs(p.z - target[2]) > 1e-4
			) {
				flyPathState.lookAtTarget = [p.x, p.y, p.z];
				changed = true;
			}
		}

		for (const waypoint of flyPathState.waypoints) {
			const marker = markers.get(waypoint.id);
			if (!marker) continue;

			const p = marker.position;
			if (
				Math.abs(p.x - waypoint.position[0]) > 1e-4 ||
				Math.abs(p.y - waypoint.position[1]) > 1e-4 ||
				Math.abs(p.z - waypoint.position[2]) > 1e-4
			) {
				waypoint.position = [p.x, p.y, p.z];
				changed = true;
			}

			const q = marker.quaternion;
			const wq = waypoint.quaternion;
			if (
				Math.abs(q.x - wq[0]) > 1e-4 ||
				Math.abs(q.y - wq[1]) > 1e-4 ||
				Math.abs(q.z - wq[2]) > 1e-4 ||
				Math.abs(q.w - wq[3]) > 1e-4
			) {
				waypoint.quaternion = [q.x, q.y, q.z, q.w];
				changed = true;
			}
		}

		if (changed) {
			dirtySince = 0.6;
			invalidate();
		} else if (dirtySince > 0) {
			dirtySince -= delta;
			if (dirtySince <= 0) persistFlyPath();
		}
	};

	// --- the task -----------------------------------------------------------------------

	useTask(
		(delta) => {
			// Pre-roll owns the loop until it has swept the path: poses 0 → 1 inclusive
			// across PREROLL_FRAMES rendered frames, then arms on the frame after the last
			// pose, so the far end of the path is warmed too.
			if (prerollFrame >= 0) {
				if (prerollFrame < PREROLL_FRAMES) {
					applyPose(prerollFrame / (PREROLL_FRAMES - 1));
					prerollFrame += 1;
					return;
				}
				prerollFrame = -1;
				armTake();
				return;
			}

			// One tick after reaching the end — the final frame has rendered (and been
			// blitted, if recording), so it is safe to tear the take down now.
			if (finishing) {
				finishing = false;
				flyPathState.isPlaying = false;
				if (recording) {
					recording = false;
					captureActions.stopRecording();
					restoreCamera();
					engaged = false;
					// Not "recorded": stopRecording only starts the write. Worded so it stays
					// true through finalizing and after, since nothing updates it again — the
					// Capture panel owns the authoritative status.
					flyPathState.status = 'Flythrough done — see the Capture panel';
				} else {
					flyPathState.status = 'Finished — Stop to restore the camera';
				}
				return;
			}

			if (flyPathState.isPlaying) {
				// The capture cap can stop the recorder out from under a looping path, and an
				// offline take can fail asynchronously while building its encoder. Neutral
				// wording covers both — the Capture panel's status says which it was.
				if (recording && !captureState.isRecording) {
					recording = false;
					flyPathState.isPlaying = false;
					flyPathState.status = 'Recording stopped — see the Capture panel';
					restoreCamera();
					engaged = false;
					return;
				}

				const total = totalDuration(flyPathState);
				if (total <= 0) return;

				// `delta` IS the offline clock. An offline take encodes frame N at exactly
				// N/fps, so the camera has to move on that same counter — and it does,
				// without a word about capture here, because an offline take takes over the
				// engine clock (core/utils/engineClock.ts) and `delta` is whatever that
				// clock says the frame is worth: 1/fps on a frame of the take, 0 on a frame
				// the encoder made it hold, the wall-clock delta the rest of the time.
				elapsed += delta;
				if (elapsed >= total) {
					if (flyPathState.loop) elapsed %= total;
					else {
						elapsed = total;
						finishing = true;
					}
				}
				applyPose(elapsed / total);
				return;
			}

			if (flyPathState.showPath) syncMarkers(delta);
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	// --- lifecycle -------------------------------------------------------------------

	$effect(() => {
		registerFlyPathDriver({
			captureWaypoint,
			cameraPosition,
			play,
			pause,
			stop,
			scrub,
			recordFlythrough
		});
		return () => {
			stop();
			unregisterFlyPathDriver();
		};
	});
</script>

<!-- Authoring overlay. Always suppressed while playing: during a flythrough the camera is
     inside the tube, and the markers would be in every frame of the take. -->
{#if flyPathState.showPath && !flyPathState.isPlaying}
	{#if tubeGeometry}
		<T.Mesh
			geometry={tubeGeometry}
			material={tubeMaterial}
			frustumCulled={false}
			userData={{ selectable: false, hideInTree: true }}
		/>
	{/if}

	{#each flyPathState.waypoints as waypoint, index (waypoint.id)}
		<!-- Deliberately selectable and visible in the tree: that is what lets Studio's
		     transform gizmo move and rotate a shot after it was snapshotted. -->
		<T.Mesh
			name={waypoint.name}
			geometry={markerGeometry}
			material={materialFor(index, flyPathState.waypoints.length)}
			position={waypoint.position}
			quaternion={waypoint.quaternion}
			scale={flyPathState.selectedId === waypoint.id ? SELECTED_SCALE : 1}
			oncreate={(ref) => {
				markers.set(waypoint.id, ref);
				return () => markers.delete(waypoint.id);
			}}
		/>
	{/each}

	<!-- Where the camera is actually aiming in `lookAt` mode. Selectable like the waypoints,
	     so the gizmo can drag the aim point around; syncMarkers writes it back. -->
	{#if flyPathState.orientationMode === 'lookAt'}
		<T.Mesh
			name="Look-at Target"
			geometry={targetGeometry}
			material={targetMaterial}
			position={flyPathState.lookAtTarget}
			oncreate={(ref) => {
				targetMarker = ref;
				return () => {
					targetMarker = null;
				};
			}}
		/>
	{/if}
{/if}
