<script lang="ts">
	// The flypath driver — owns the curve, drives the camera, draws the authoring overlay.
	// Camera ownership (never the scene camera, never swapped) and why this task has no
	// `before`/`after` constraint (the main-stage race with camera-anchored layers): see
	// "Key behavior" in flypath/CLAUDE.md.

	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { HTML } from '@threlte/extras';
	import { useStudio } from '@threlte/studio/extend';
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

	const { camera, invalidate } = useThrelte();

	const activeCamera = () => camera.current as THREE.PerspectiveCamera | undefined;

	// --- the editor camera ------------------------------------------------------------
	// The path owns the editor camera, never the scene camera — see flypath/CLAUDE.md.
	// `useStudio()` is a plain `getContext`, undefined when Studio is toggled off
	// (shift+alt+S) — hence optional calls rather than the try/catch the `useX.ts` hooks use.
	const studio = useStudio();

	/**
	 * Studio's own `useEditorCamera()` is read-only (it exposes `enabled` and nothing
	 * else), so this goes through the extension registry. `'editor-camera'` is
	 * `editorCameraScope`, which the package does not re-export.
	 */
	const editorCameraExtension = () =>
		studio?.useExtension<
			{
				enabled: boolean;
				controlsSuspended: boolean;
				defaultCamera: { enabled: boolean };
			},
			{
				setEnabled: (enabled: boolean) => void;
				setControlsSuspended: (v: boolean) => void;
				setDefaultCameraEnabled: (enabled: boolean) => void;
			}
		>('editor-camera');

	/** True once `camera.current` really is the editor camera — `setEnabled` is async. */
	const editorCameraReady = () => editorCameraExtension()?.state.enabled === true;

	/**
	 * What the path found the editor camera in, so it can be put back. Taken on the FIRST
	 * claim and held until release: play → scrub → record all re-claim, and the state worth
	 * restoring is the one from before the path first took over, not from the last hop.
	 */
	let restorePoint: { enabled: boolean; pip: boolean } | null = null;

	/**
	 * Switch the editor camera on and take its controls off it. Returns false when there is
	 * no Studio to ask, which is the one case the path cannot run in.
	 *
	 * `suppressPip` is for a take only — see `releaseEditorCamera`.
	 */
	const claimEditorCamera = (suppressPip: boolean): boolean => {
		const editorCamera = editorCameraExtension();
		if (!editorCamera) {
			logEngine.warn('FlyPath: no Studio editor camera to drive — is Studio toggled off?');
			flyPathState.status = 'Needs Studio’s editor camera';
			return false;
		}
		// `useExtension` hands back `Partial<State>`, so both of these have to tolerate an
		// absent field rather than assert it away — `defaultCamera.enabled` is
		// `persist(true)` upstream, so treat "not there" as on and put it back that way.
		restorePoint ??= {
			enabled: editorCamera.state.enabled === true,
			pip: editorCamera.state.defaultCamera?.enabled !== false
		};
		if (!editorCamera.state.enabled) editorCamera.setEnabled(true);
		editorCamera.setControlsSuspended(true);
		// THE PiP IS A SECOND FULL SCENE RENDER, and it is on by default. Studio's
		// "Default Camera" pane runs `renderer.render(scene, defaultCamera)` from a task
		// registered `{ before: autoRenderTask }` (DefaultCamera.svelte), so every frame of
		// a take pays an extra scene traversal and draw-call submission for a picture that
		// cannot reach the output — it is blitted into a tweakpane pane, an HTML sibling of
		// the canvas, and the main pipeline pass overwrites its viewport region before
		// capture's grab runs anyway. Pure cost per encoded frame, so a take turns it off.
		// (It does NOT re-render shadow maps: SkyLight sets `shadow.autoUpdate = false` and
		// Renderer.svelte arms `needsUpdate` in a later stage.)
		if (suppressPip) editorCamera.setDefaultCameraEnabled(false);
		return true;
	};

	/**
	 * The editor camera's own FOV, taken on first drive and restored on release — the only
	 * thing CameraControls doesn't restore itself (applyPose lerps FOV between waypoints).
	 * Null when the path does not hold it.
	 */
	let editorFov: number | null = null;

	/**
	 * Hand the camera back. Un-suspending IS the restore for the transform — CameraControls
	 * kept its own state the whole time, so it snaps back to wherever the user last flew it.
	 *
	 * `restoreEnabled` additionally puts the `enabled` flag back to what the path found:
	 * a finished TAKE does this, so a flythrough recorded from a game-camera session lands
	 * you back on the game camera instead of parked on the editor camera at the end of the
	 * path. ▶ Play and Scrub pass false — they hold at the end of the path on purpose, so
	 * the last shot stays inspectable, and ⏹ Stop is what hands the camera back.
	 *
	 * Switching `enabled` off swaps `camera.current`, which rebuilds the whole
	 * post-processing pipeline (`Renderer.svelte` tracks `$camera` structurally). That is
	 * why only a take does it, and only once the take's frames are all pushed.
	 */
	const releaseEditorCamera = (restoreEnabled: boolean) => {
		const cam = activeCamera();
		// Before any `setEnabled(false)` below: `camera.current` is still the editor camera
		// at this point, which is the one whose lens the path moved.
		if (cam && editorFov !== null && cam.isPerspectiveCamera) {
			cam.fov = editorFov;
			cam.updateProjectionMatrix();
		}
		editorFov = null;

		const editorCamera = editorCameraExtension();
		const previous = restorePoint;
		restorePoint = null;
		editorCamera?.setControlsSuspended(false);
		if (previous) {
			editorCamera?.setDefaultCameraEnabled(previous.pip);
			if (restoreEnabled && !previous.enabled) editorCamera?.setEnabled(false);
		}
		invalidate();
	};

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

	// --- direction arrows -----------------------------------------------------------
	// One hand-rolled InstancedMesh, not @threlte/extras' <InstancedMesh> (its Api task
	// invalidate()s unconditionally, which would pin the on-demand loop). See CLAUDE.md.

	const ARROW_SPACING = 4.5;
	const ARROW_LENGTH = 0.4;
	/** Buffer cap: 512 arrows spans ~2300 world units of path at ARROW_SPACING. A path
	 *  long enough to reach it just stops growing arrows past the cap. */
	const MAX_ARROWS = 512;

	const arrowGeometry = new THREE.ConeGeometry(0.1, 0.4, 12);
	arrowGeometry.rotateX(-Math.PI / 2);

	const arrowMaterial = new THREE.MeshBasicNodeMaterial();
	arrowMaterial.color.set('#ffffff');
	arrowMaterial.transparent = true;
	arrowMaterial.opacity = 0.85;
	arrowMaterial.depthWrite = false;
	arrowMaterial.fog = false;

	const arrowMesh = new THREE.InstancedMesh(arrowGeometry, arrowMaterial, MAX_ARROWS);
	arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	arrowMesh.count = 0;
	arrowMesh.visible = false;
	// The arrows sit wherever the curve goes — a bounding sphere would be stale the
	// moment the path is edited, and culling one draw call is not worth recomputing it.
	arrowMesh.frustumCulled = false;
	arrowMesh.userData = { selectable: false, hideInTree: true };

	// Section-local scratch. Sharing applyPose's temps would work today (nothing here
	// runs concurrently) but scratch shared across sections is how aliasing bugs start.
	const arrowPoint = new THREE.Vector3();
	const arrowTangent = new THREE.Vector3();
	const arrowQuat = new THREE.Quaternion();
	const arrowMatrix = new THREE.Matrix4();
	const ARROW_ORIGIN = new THREE.Vector3(0, 0, 0);
	const ARROW_UP = new THREE.Vector3(0, 1, 0);
	const ARROW_ONE = new THREE.Vector3(1, 1, 1);

	$effect(() => {
		const source = curve;
		const matrices = arrowMesh.instanceMatrix.array as Float32Array;
		let n = 0;
		if (source) {
			const len = source.getLength();
			const count = Math.max(1, Math.floor(len / ARROW_SPACING));
			for (let i = 1; i <= count && n < MAX_ARROWS; i++) {
				const t = i / (count + 1);
				source.getPoint(t, arrowPoint);
				source.getTangent(t, arrowTangent).normalize();
				// Seat the cone so its tip rides the curve: pull back half its length.
				arrowPoint.addScaledVector(arrowTangent, -ARROW_LENGTH / 2);
				arrowMatrix.lookAt(ARROW_ORIGIN, arrowTangent, ARROW_UP);
				arrowQuat.setFromRotationMatrix(arrowMatrix);
				arrowMatrix.compose(arrowPoint, arrowQuat, ARROW_ONE);
				matrices.set(arrowMatrix.elements, n * 16);
				n++;
			}
		}
		arrowMesh.count = n;
		// An empty mesh costs no draw call at all, same as the sky layers.
		arrowMesh.visible = n > 0;
		arrowMesh.instanceMatrix.needsUpdate = true;
		// Runs only when the curve changed, so this asks for exactly the frames the old
		// per-arrow prop writes used to — never a pinned loop.
		invalidate();
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

	// First waypoint is always green, last always red — the tube itself says nothing about
	// direction. Selection is a scale bump, not colour (would mask an endpoint).
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
		arrowMesh.dispose();
		arrowGeometry.dispose();
		arrowMaterial.dispose();
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
	/** A scrub waiting for the task to pose it — see scrub(). Null when there is none. */
	let pendingScrub: number | null = null;
	/** True from the moment 🎬 is pressed until the take is torn down — pre-roll included. */
	const takeInFlight = () => recording || prerollFrame >= 0;

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

		// Global easing, never per segment. Looping forces linear (see CLAUDE.md).
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

		// Epsilon-gated $state write so 60Hz playback doesn't wake the panel every frame —
		// widens 25x while recording (tweakpane layout mid-encode). See CLAUDE.md.
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

	const idleStatus = () =>
		flyPathState.waypoints.length < 2
			? 'Need at least 2 waypoints'
			: `${flyPathState.waypoints.length} waypoints · ${totalDuration(flyPathState).toFixed(1)}s`;

	/**
	 * A take is over. ONE exit for all four ways that happens — reaching the end of the
	 * path, the capture duration cap, the recorder dying mid-take, and `armTake()` failing
	 * to start one at all — because each of them has to do exactly the same teardown, and
	 * the one that used to skip it (a failed arm) left the editor camera frozen with its
	 * controls suspended and no hint that ⏹ Stop was the only way out.
	 *
	 * Hands the `enabled` flag back too: a recording is a finished job, so it cleans up
	 * after itself rather than leaving the viewport parked on the editor camera.
	 */
	const finishTake = (status: string) => {
		const live = recording;
		recording = false;
		finishing = false;
		prerollFrame = -1;
		pendingScrub = null;
		flyPathState.isPlaying = false;
		flyPathState.takeInFlight = false;
		if (live) captureActions.stopRecording();
		if (engaged) {
			engaged = false;
			releaseEditorCamera(true);
		}
		elapsed = 0;
		flyPathState.progress = 0;
		flyPathState.status = status;
	};

	const play = () => {
		if (segmentCount(flyPathState) === 0) return;
		// Would clear `finishing` out from under a take, which then never tears down and
		// runs to the capture cap. `scrub()` has always refused; this did not.
		if (takeInFlight()) {
			logEngine.warn('FlyPath: already recording a flythrough — press Stop first');
			return;
		}
		// Playing from a scrub: the queued pose is stale the moment `elapsed` starts moving.
		pendingScrub = null;
		if (!claimEditorCamera(false)) return;
		engaged = true;
		finishing = false;
		if (flyPathState.progress >= 0.999) elapsed = 0;
		flyPathState.isPlaying = true;
		flyPathState.status = 'Playing…';
		invalidate();
	};

	const pause = () => {
		if (!engaged) return;
		// A TAKE CANNOT BE PAUSED. Clearing `isPlaying` stops the camera but not the
		// encoder, so the take would run to the capture cap recording a frozen frame — and
		// with the authoring overlay back in shot, since the tube, the direction arrows and
		// every waypoint marker are gated on `!isPlaying`. Stop is the way out of a take.
		if (takeInFlight()) {
			logEngine.warn('FlyPath: a recording cannot be paused — press Stop to end the take');
			return;
		}
		flyPathState.isPlaying = false;
		flyPathState.status = 'Paused';
	};

	const stop = () => {
		if (takeInFlight()) {
			finishTake(idleStatus());
			return;
		}
		flyPathState.isPlaying = false;
		flyPathState.takeInFlight = false;
		finishing = false;
		// A scrub queued for the task must not survive the thing that hands the camera back.
		pendingScrub = null;
		elapsed = 0;
		flyPathState.progress = 0;
		if (engaged) {
			engaged = false;
			// The button says "Restore Camera", so an explicit Stop restores everything the
			// path touched, `enabled` included.
			releaseEditorCamera(true);
		}
		flyPathState.status = idleStatus();
	};

	const scrub = (progress: number) => {
		// Never let a scrub tear down a take in progress — the panel already filters
		// tweakpane's programmatic 'external' change events, but a real mis-drag during a
		// recording should not ruin it either. Stop is the deliberate way out.
		if (takeInFlight()) {
			logEngine.warn('FlyPath: scrub ignored while recording — press Stop first');
			return;
		}
		if (!claimEditorCamera(false)) return;
		engaged = true;
		flyPathState.isPlaying = false;
		elapsed = progress * totalDuration(flyPathState);
		// Posed by the task, not here: camera.current only becomes the editor camera on the
		// next effect flush. A drag fires this many times per frame; latest write wins.
		pendingScrub = progress;
		flyPathState.status = `Scrubbing ${(progress * 100).toFixed(0)}%`;
		invalidate();
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

		pendingScrub = null;
		// `true` suppresses Studio's Default Camera PiP for the take — see claimEditorCamera.
		if (!claimEditorCamera(true)) return;
		engaged = true;
		finishing = false;
		elapsed = 0;

		// isPlaying goes true HERE, not in armTake(): it is what suppresses the authoring
		// overlay, and tearing down the tube plus every marker mesh is itself a frame of
		// work. Better spent during the pre-roll than on frame 0 of the take.
		flyPathState.isPlaying = true;
		flyPathState.takeInFlight = true;
		prerollFrame = 0;
		flyPathState.status = 'Warming up…';
		applyPose(0);
	};

	// --- pre-roll ---------------------------------------------------------------------
	// Sweeps the whole path once before arming so pipeline compiles land before frame 0
	// (on-demand rendering compiles mid-take otherwise) — see CLAUDE.md "A take pre-rolls".

	const PREROLL_FRAMES = 12;

	const armTake = () => {
		// Rewind and pose BEFORE arming: frame 0 of the video must be frame 0 of the path.
		// Capture's clock source releases the head frame with a step of 0 — see CLAUDE.md.
		elapsed = 0;
		applyPose(0);

		captureActions.startRecording();
		if (!captureState.isRecording) {
			// The camera is claimed and its controls suspended by now, so this MUST go
			// through the full teardown — it used to clear `isPlaying` and nothing else,
			// leaving the editor camera frozen with Stop as the only undocumented way out.
			finishTake('Recording failed — see the Capture panel');
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
			// The camera handover gates everything below: play()/scrub()/recordFlythrough()
			// switch the editor camera on, but the swap lands on the next effect flush, so
			// hold until it has (see "task holds until" in CLAUDE.md). invalidate() while
			// holding since renderMode is on-demand.
			//
			// Scoped to the driving branches, so authoring is untouched: syncMarkers must
			// keep running whether the editor camera is on or off.
			const driving =
				prerollFrame >= 0 || finishing || flyPathState.isPlaying || pendingScrub !== null;
			if (driving) {
				if (!editorCameraReady()) {
					invalidate();
					return;
				}
				// First frame the path actually holds the camera: remember the lens. See
				// `editorFov` — the transform restores itself, the FOV does not.
				const cam = activeCamera();
				if (cam && editorFov === null) editorFov = cam.fov ?? 60;
			}

			// A scrub is a pose, not a time advance — settled above the zero-delta guard below
			// (see "A scrub is queued" in CLAUDE.md).
			if (pendingScrub !== null) {
				const progress = pendingScrub;
				pendingScrub = null;
				applyPose(progress);
				return;
			}

			// A zero-delta frame is inert — see "A zero-delta frame returns immediately" in
			// CLAUDE.md for why this guard is what the main-stage move costs.
			if (delta === 0) return;

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
				if (recording) {
					// Not "recorded": stopRecording only starts the write. Worded so it stays
					// true through finalizing and after, since nothing updates it again — the
					// Capture panel owns the authoritative status.
					finishTake('Flythrough done — see the Capture panel');
				} else {
					// A PREVIEW is held at the end of the path on purpose, so the last shot
					// can be looked at; Stop hands the editor camera back to its controls.
					// Only a take restores itself (flypath/CLAUDE.md).
					flyPathState.isPlaying = false;
					flyPathState.status = 'Finished — Stop to hand the camera back';
				}
				return;
			}

			if (flyPathState.isPlaying) {
				// The capture cap can stop the recorder out from under a looping path, and an
				// offline take can fail asynchronously while building its encoder. Neutral
				// wording covers both — the Capture panel's status says which it was.
				if (recording && !captureState.isRecording) {
					finishTake('Recording stopped — see the Capture panel');
					return;
				}

				const total = totalDuration(flyPathState);
				if (total <= 0) return;

				// `delta` IS the offline clock (core/utils/engineClock.ts) — 1/fps on a take
				// frame, 0 on a held frame, wall-clock otherwise. See CLAUDE.md.
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
		// No `before`/`after`: that is what puts this in the main stage. See TASK ORDER above.
		{ autoInvalidate: false }
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

	<!-- One draw call for every arrow, whatever the path length. Script-owned and synced
	     by the effect above, hence `dispose={false}` — see SpawnedBodies for the shape. -->
	<T is={arrowMesh} dispose={false} />

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
		<HTML
			position={[waypoint.position[0], waypoint.position[1] + 0.7, waypoint.position[2]]}
			userData={{ selectable: false, hideInTree: true }}
		>
			<span
				style="color: #fff; font: bold 14px monospace; text-shadow: 0 0 4px #000, 0 0 8px #000; pointer-events: none; user-select: none; white-space: nowrap;"
				>{index + 1}</span
			>
		</HTML>
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
