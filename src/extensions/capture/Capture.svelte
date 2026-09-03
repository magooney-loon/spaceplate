<script lang="ts">
	// The capture driver — stills and video, without any of Studio's UI in the output.
	//
	// TWO KINDS OF "STUDIO UI", TWO DIFFERENT ANSWERS:
	//
	// 1. The toolbar, its panes and the scene HUD are plain HTML siblings of the canvas
	//    (App.svelte / SceneHud.svelte). Nothing HTML is ever composited into the canvas,
	//    so reading the canvas back excludes all of it for free.
	// 2. Studio's 3D content IS in the canvas: the grid, axes/light/group helpers,
	//    transform controls and the selection-outline quad. Every one of them registers
	//    itself in Studio's `studio-objects-registry` extension, so hiding that set for
	//    the duration of a capture removes exactly Studio's contribution and nothing of
	//    the app's. CaptureExtension.svelte publishes the set (capture.svelte.ts).
	// 3. The one exception is the corner navigation Gizmo, which is a @threlte/extras
	//    component mounted by Studio's CameraControls and is NOT in that registry. It
	//    renders from its own task registered `{ after: autoRenderTask }`, and among
	//    tasks sharing a constraint the DAG falls back to registration order
	//    (DOCS/webgpu-notes.md §2). So the grab below happens after the pipeline has
	//    drawn the frame but BEFORE the Gizmo composites on top of it.
	//
	// THAT ORDERING IS WHY App.svelte MOUNTS THIS IN THE SAME `{#await}` AS <Studio>, and
	// immediately before it. Two dynamic imports racing for render-task order would not be
	// a guarantee; one Promise.all resolving into one fragment is — both mount in the same
	// tick, in document order, so this task registers first and stays first. (The Gizmo
	// re-registers when the editor camera is toggled, which only ever pushes it later.)
	// Being in that block also keeps the extension convention intact: dynamically imported
	// behind VITE_GAME_ENGINE, so none of it ships to production.
	//
	// ON-DEMAND RENDERING: tasks constrained `{ after: autoRenderTask }` inherit the
	// renderStage, whose callback gates the whole stage on `shouldRender()` (threlte
	// core, scheduler.svelte.js). So this task runs ONLY on frames that actually
	// rendered — which is exactly the guarantee a grab needs. It also means a recording
	// has to pin the loop itself: see the invalidate() in the task.

	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import type { Object3D } from 'three/webgpu';
	import { sceneState } from '$extensions/scene';
	import { logEngine } from '$extensions/logger';
	import {
		captureState,
		getStudioObjects,
		registerCaptureDriver,
		unregisterCaptureDriver
	} from './capture.svelte';

	const { renderer, invalidate, autoRenderTask } = useThrelte();

	// --- hiding Studio's in-scene objects ----------------------------------------
	// Refcounted: a screenshot taken during a recording must not un-hide them on its way
	// out. `visible` is restored per object from what it was, never assumed to be true —
	// Studio hides its own helpers in plenty of states.

	let hidden: Map<Object3D, boolean> | null = null;
	let hideHolders = 0;

	const acquireHidden = () => {
		hideHolders += 1;
		if (hidden || !captureState.hideStudioObjects) return;
		hidden = new Map();
		for (const object of getStudioObjects()) {
			hidden.set(object, object.visible);
			object.visible = false;
		}
		invalidate();
	};

	const releaseHidden = () => {
		hideHolders = Math.max(0, hideHolders - 1);
		if (hideHolders > 0 || !hidden) return;
		for (const [object, visible] of hidden) object.visible = visible;
		hidden = null;
		invalidate();
	};

	// --- shared helpers ------------------------------------------------------------

	const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

	const download = (blob: Blob, extension: string) => {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `spaceplate-${sceneState.currentScene}-${stamp()}.${extension}`;
		anchor.click();
		// Revoking synchronously after click races the download in some browsers.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	/**
	 * Copies the live canvas into a 2D canvas. The WebGPU canvas is configured with
	 * COPY_SRC, so it is a valid drawImage source (DOCS/webgpu-notes.md §5.2) — but only
	 * while the frame is still current, which is why every caller is inside the task.
	 */
	const blit = (target: HTMLCanvasElement, opaque: boolean) => {
		const context = target.getContext('2d');
		if (!context) return false;
		if (opaque) {
			context.fillStyle = '#000';
			context.fillRect(0, 0, target.width, target.height);
		} else {
			context.clearRect(0, 0, target.width, target.height);
		}
		context.drawImage(renderer.domElement, 0, 0, target.width, target.height);
		return true;
	};

	// --- stills ---------------------------------------------------------------------
	// Two phases, because the hide has to happen BEFORE the render it applies to and this
	// task runs after it: arm (hide + invalidate) now, grab on the next rendered frame.

	const stillCanvas = document.createElement('canvas');
	let stillPending = false;

	const screenshot = () => {
		if (stillPending) return;
		stillPending = true;
		captureState.status = 'Capturing…';
		acquireHidden();
		invalidate();
	};

	const grabStill = () => {
		const source = renderer.domElement;
		stillCanvas.width = source.width;
		stillCanvas.height = source.height;

		const format = captureState.imageFormat;
		const ok = blit(stillCanvas, format === 'jpeg');
		releaseHidden();

		if (!ok) {
			captureState.status = 'Screenshot failed: no 2D context';
			logEngine.error('Capture: could not acquire a 2D context for the still');
			return;
		}

		const type = `image/${format}`;
		stillCanvas.toBlob(
			(blob) => {
				if (!blob) {
					captureState.status = `Screenshot failed: ${format} not encodable`;
					logEngine.error('Capture: toBlob returned null for', type);
					return;
				}
				download(blob, format === 'jpeg' ? 'jpg' : format);
				const size = (blob.size / 1024 / 1024).toFixed(2);
				captureState.status = `Saved ${stillCanvas.width}×${stillCanvas.height} ${format} (${size} MB)`;
				logEngine.info(
					`Capture: still ${stillCanvas.width}×${stillCanvas.height} ${format}, ${size} MB`
				);
			},
			type,
			format === 'png' ? undefined : captureState.imageQuality
		);
	};

	// --- video ------------------------------------------------------------------------
	// The recorder reads from its own 2D canvas rather than from the live one, so the
	// frames it sees are the pre-Gizmo blits above. `captureStream(0)` yields frames only
	// when requestFrame() is called, which puts frame timing under the task's control
	// instead of the browser's sampler.

	const videoCanvas = document.createElement('canvas');
	let recorder: MediaRecorder | null = null;
	let videoTrack: CanvasCaptureMediaStreamTrack | null = null;
	let chunks: Blob[] = [];
	let frameClock = 0;
	let elapsed = 0;

	const pickMimeType = (): string | null => {
		const candidates = [
			'video/webm;codecs=vp9',
			'video/webm;codecs=vp8',
			'video/webm',
			'video/mp4'
		];
		return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
	};

	const startRecording = () => {
		if (recorder) return;

		if (typeof MediaRecorder === 'undefined' || !videoCanvas.captureStream) {
			captureState.status = 'Recording unsupported in this browser';
			logEngine.error('Capture: MediaRecorder or captureStream unavailable');
			return;
		}

		const mimeType = pickMimeType();
		if (!mimeType) {
			captureState.status = 'Recording failed: no supported codec';
			logEngine.error('Capture: no MediaRecorder mime type supported');
			return;
		}

		// Fixed for the whole recording — a mid-recording resize of the source canvas is
		// absorbed by drawImage scaling instead of breaking the stream.
		const source = renderer.domElement;
		videoCanvas.width = source.width;
		videoCanvas.height = source.height;

		const stream = videoCanvas.captureStream(0);
		videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
		if (!videoTrack) {
			captureState.status = 'Recording failed: no video track';
			logEngine.error('Capture: captureStream produced no video track');
			return;
		}

		chunks = [];
		recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: captureState.bitrateMbps * 1_000_000
		});
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};
		recorder.onerror = (event) => {
			captureState.status = 'Recording error — see console';
			logEngine.error('Capture: MediaRecorder error', event);
			stopRecording();
		};
		recorder.onstop = () => {
			const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
			const blob = new Blob(chunks, { type: mimeType });
			chunks = [];
			if (blob.size > 0) {
				download(blob, extension);
				const size = (blob.size / 1024 / 1024).toFixed(2);
				captureState.status = `Saved ${elapsed.toFixed(1)}s ${extension} (${size} MB)`;
				logEngine.info(`Capture: video ${elapsed.toFixed(1)}s ${extension}, ${size} MB`);
			} else {
				captureState.status = 'Recording produced no data';
				logEngine.warn('Capture: recording produced no data');
			}
			releaseHidden();
		};

		frameClock = 0;
		elapsed = 0;
		captureState.elapsedSec = 0;
		captureState.isRecording = true;
		captureState.status = 'Recording…';
		acquireHidden();
		recorder.start();
		logEngine.info(
			`Capture: recording ${videoCanvas.width}×${videoCanvas.height} @ ${captureState.fps}fps, ` +
				`${mimeType}, cap ${captureState.maxDurationSec}s`
		);
		invalidate();
	};

	const stopRecording = () => {
		if (!recorder) return;
		const active = recorder;
		recorder = null;
		videoTrack = null;
		captureState.isRecording = false;
		// The onstop handler above downloads and calls releaseHidden().
		if (active.state !== 'inactive') active.stop();
		else releaseHidden();
	};

	// --- the task ---------------------------------------------------------------------

	useTask(
		(delta) => {
			if (stillPending) {
				stillPending = false;
				grabStill();
			}

			if (!recorder) return;

			elapsed += delta;
			const whole = Math.floor(elapsed);
			// $state write, so it is gated on the integer changing rather than run at 60Hz.
			if (whole !== captureState.elapsedSec) captureState.elapsedSec = whole;

			frameClock += delta;
			const period = 1 / captureState.fps;
			if (frameClock >= period) {
				frameClock %= period;
				if (blit(videoCanvas, true)) videoTrack?.requestFrame();
			}

			if (elapsed >= captureState.maxDurationSec) {
				logEngine.info(`Capture: duration cap (${captureState.maxDurationSec}s) reached — stopping`);
				stopRecording();
				captureState.status = `Stopped at the ${captureState.maxDurationSec}s cap`;
				return;
			}

			// Pins the loop for the recording's duration. renderMode is 'on-demand', so
			// without this the stream would be fed only whenever something else happened to
			// invalidate — a variable, mostly-empty video. Bounded by the cap above.
			invalidate();
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	// --- lifecycle ---------------------------------------------------------------------

	$effect(() => {
		registerCaptureDriver({ screenshot, startRecording, stopRecording });
		return () => {
			// Unmounting mid-recording must not leave Studio's objects hidden.
			stopRecording();
			if (stillPending) {
				stillPending = false;
				releaseHidden();
			}
			unregisterCaptureDriver();
		};
	});
</script>
