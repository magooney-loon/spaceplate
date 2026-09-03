<script lang="ts">
	// The capture driver — stills and video.
	//
	// WHAT ENDS UP IN THE OUTPUT:
	//
	// 1. The toolbar, its panes and the scene HUD are plain HTML siblings of the canvas
	//    (App.svelte / SceneHud.svelte). Nothing HTML is ever composited into the canvas,
	//    so reading the canvas back excludes all of it for free.
	// 2. Studio's 3D content — the grid, axes/light/group helpers, transform controls and
	//    the selection outline — IS in the canvas, and is captured. That is deliberate:
	//    each of those has its own toggle in Studio's toolbar (and deselecting clears the
	//    outline), so hiding them is the user's call shot by shot. Sometimes the grid is
	//    exactly what you want in the frame.
	// 3. The corner navigation Gizmo is the one thing with no useful toggle — it is a
	//    viewport widget, never wanted in an image, and turning it off means turning off
	//    the editor camera. It is a @threlte/extras component mounted by Studio's
	//    CameraControls, rendering from its own task registered `{ after: autoRenderTask }`,
	//    and among tasks sharing a constraint the DAG falls back to registration order
	//    (DOCS/webgpu-notes.md §2). So the grab below runs after the pipeline has drawn the
	//    frame but BEFORE the Gizmo composites on top of it.
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
	import { sceneState } from '$extensions/scene';
	import { logEngine } from '$extensions/logger';
	import {
		captureRuntime,
		captureState,
		registerCaptureDriver,
		unregisterCaptureDriver
	} from './capture.svelte';
	import { createOfflineTake, type OfflineTake } from './encoder';

	const { renderer, invalidate, autoRenderTask } = useThrelte();

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

	// THE BLIT. Both paths below copy the live canvas into a 2D canvas of their own. The
	// WebGPU canvas is configured with COPY_SRC, so it is a valid drawImage source
	// (DOCS/webgpu-notes.md §5.2) — but only while the frame is still current, which is
	// why every caller is inside the task.
	//
	// This copy is the single most expensive thing capture does per frame: it scales with
	// the BACKING STORE, not the CSS size, so at `high` on a 2× display a 1920px canvas
	// costs a 3840×2160 copy on the main thread. Two things keep it as cheap as it can be:
	//
	// 1. Each context is acquired ONCE, at module scope. getContext() options only take
	//    effect on the first call for a given canvas, so they cannot be passed from a
	//    per-frame lookup — and the video path wants `alpha: false`.
	// 2. `alpha: false` gives the recording canvas an opaque context: no per-pixel alpha
	//    channel to composite, and it starts out black. That is what lets blitVideo() skip
	//    a full-canvas fillRect that used to run every frame immediately before drawImage
	//    overwrote every pixel of it.
	//
	// Writing canvas.width/height clears the pixels but keeps the context object, so both
	// survive the resizes below.

	// --- stills ---------------------------------------------------------------------
	// Armed here, grabbed in the task: the canvas outside the render loop holds the last
	// frame's FINAL composite, Gizmo included. Only a grab from inside the task, on a
	// frame that actually rendered, lands in the pre-Gizmo window.
	//
	// Stills keep an alpha-capable context: PNG and WebP are allowed to carry the
	// canvas's transparency, and only the JPEG path flattens onto black.

	const stillCanvas = document.createElement('canvas');
	const stillContext = stillCanvas.getContext('2d');
	let stillPending = false;

	const blitStill = (opaque: boolean) => {
		if (!stillContext) return false;
		const { width, height } = stillCanvas;
		if (opaque) {
			stillContext.fillStyle = '#000';
			stillContext.fillRect(0, 0, width, height);
		} else {
			stillContext.clearRect(0, 0, width, height);
		}
		stillContext.drawImage(renderer.domElement, 0, 0, width, height);
		return true;
	};

	const screenshot = () => {
		if (stillPending) return;
		stillPending = true;
		captureState.status = 'Capturing…';
		invalidate();
	};

	const grabStill = () => {
		const source = renderer.domElement;
		stillCanvas.width = source.width;
		stillCanvas.height = source.height;

		const format = captureState.imageFormat;
		if (!blitStill(format === 'jpeg')) {
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
	//
	// TWO MODES, one canvas. Both read from this 2D canvas rather than from the live one,
	// so the frames they see are the pre-Gizmo blits described above, and both size it once
	// at the start of a take so a mid-take resize is absorbed by scaling.
	//
	// - REALTIME (MediaRecorder). `captureStream(0)` yields frames only when
	//   requestFrame() is called, which puts frame selection under the task's control
	//   instead of the browser's sampler. What it does NOT put under our control is frame
	//   TIMING: MediaRecorder timestamps each frame by the wall-clock moment requestFrame
	//   ran, so a hitch is encoded into the file as a long frame.
	// - OFFLINE (WebCodecs, encoder.ts). Timestamps come from a frame counter, so the
	//   output is exactly-spaced however slowly it renders. Not realtime; see encoder.ts.

	const videoCanvas = document.createElement('canvas');
	const videoContext = videoCanvas.getContext('2d', { alpha: false });
	let recorder: MediaRecorder | null = null;
	let videoTrack: CanvasCaptureMediaStreamTrack | null = null;
	let chunks: Blob[] = [];
	let frameClock = 0;
	let elapsed = 0;

	/** No clear first: the context is opaque and drawImage covers every pixel. */
	const blitVideo = () => {
		if (!videoContext) return false;
		videoContext.drawImage(renderer.domElement, 0, 0, videoCanvas.width, videoCanvas.height);
		return true;
	};

	// Ordered by the selected container, but deliberately allowed to fall through to the
	// other one: a machine with no mp4 encoder should still produce a file. The extension
	// is derived from the mime type that actually won, so the name stays honest either way.
	const pickMimeType = (): string | null => {
		const candidates =
			captureState.container === 'mp4'
				? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
				: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
		return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
	};

	const startRealtimeRecording = () => {
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
			captureState.isFinalizing = false;
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
		};

		frameClock = 0;
		elapsed = 0;
		captureState.elapsedSec = 0;
		captureState.isRecording = true;
		captureState.status = 'Recording…';
		// Timeslice, not start(): without one, MediaRecorder holds the entire take in a
		// single growing internal buffer and hands it over as one Blob at stop — at 16 Mbps
		// for 60s that is ~120 MB, and growing an allocation that size mid-take is exactly
		// the kind of thing that buys a GC pause in the middle of a shot. One second of
		// video per chunk keeps the peak bounded; onstop still assembles them into one Blob.
		recorder.start(1000);
		logEngine.info(
			`Capture: realtime recording ${videoCanvas.width}×${videoCanvas.height} @ ` +
				`${captureState.fps}fps, ${mimeType}, cap ${captureState.maxDurationSec}s`
		);
		invalidate();
	};

	const stopRealtimeRecording = () => {
		if (!recorder) return;
		const active = recorder;
		recorder = null;
		videoTrack = null;
		captureState.isRecording = false;
		// onstop is not synchronous — the last timeslice still has to be flushed and the
		// chunks assembled before the download fires — so the panel stays gated until it
		// lands rather than claiming the take is done.
		if (active.state !== 'inactive') {
			captureState.isFinalizing = true;
			captureState.status = 'Preparing video…';
			active.stop();
		}
	};

	// --- video: offline (WebCodecs) ----------------------------------------------------

	let offlineTake: OfflineTake | null = null;
	/** True between arming a take and the encoder actually existing — creation is async. */
	let offlinePending = false;

	const teardownOffline = () => {
		offlineTake = null;
		offlinePending = false;
		captureRuntime.offline = false;
		captureRuntime.driven = false;
		captureRuntime.posed = false;
		captureRuntime.saturated = false;
		captureState.isRecording = false;
	};

	/**
	 * A queued frame finished encoding. Clears the stall once the queue has drained below
	 * its limit, and re-arms the loop for the undriven case — a driven take is kept alive
	 * by the pose driver's own invalidate (and, in this scene, by the sky layers, which
	 * invalidate every frame regardless).
	 */
	const onEncoderReady = () => {
		const take = offlineTake;
		if (!take) return;
		captureRuntime.saturated = take.saturated;
		if (!captureRuntime.saturated) invalidate();
	};

	const startOfflineRecording = () => {
		// isRecording flips optimistically: `CaptureDriver.startRecording` is synchronous
		// and callers (flypath) check the flag on the next line, but building an encoder
		// means probing codecs and starting a muxer. Held saturated until it exists, so the
		// pose driver cannot advance into a take that has not begun.
		offlinePending = true;
		captureState.isRecording = true;
		captureState.elapsedSec = 0;
		captureRuntime.offline = true;
		captureRuntime.posed = false;
		captureRuntime.saturated = true;
		captureRuntime.frameStep = 1 / captureState.fps;
		captureState.status = 'Preparing encoder…';

		void createOfflineTake({
			canvas: videoCanvas,
			container: captureState.container,
			fps: captureState.fps,
			bitrateMbps: captureState.bitrateMbps,
			onReady: onEncoderReady
		}).then(
			(take) => {
				// Stopped while we were awaiting — throw the encoder away rather than
				// starting a take nobody asked for any more.
				if (!offlinePending) {
					void take.cancel();
					return;
				}
				offlineTake = take;
				offlinePending = false;
				captureRuntime.saturated = false;
				captureState.status = 'Rendering offline…';
				logEngine.info(
					`Capture: offline take ${take.width}×${take.height} @ ${captureState.fps}fps, ` +
						`${take.codec}/${take.extension}, cap ${captureState.maxDurationSec}s`
				);
				invalidate();
			},
			(error: unknown) => {
				teardownOffline();
				captureState.status = 'Offline recording failed — see console';
				logEngine.error('Capture: could not start the offline encoder', error);
			}
		);
	};

	const stopOfflineRecording = () => {
		const take = offlineTake;
		teardownOffline();
		if (!take) return;

		// Draining the encode queue, muxing and building the Blob all happen here, and at
		//4K none of it is instant. Gate the panel for the whole window so the take does not
		// read as finished seconds before the download prompt appears.
		captureState.isFinalizing = true;
		captureState.status = 'Preparing video…';
		void take.finish().then(
			(blob) => {
				captureState.isFinalizing = false;
				const seconds = take.encodedSec.toFixed(1);
				if (blob.size === 0) {
					captureState.status = 'Recording produced no data';
					logEngine.warn('Capture: offline take produced no data');
					return;
				}
				download(blob, take.extension);
				const size = (blob.size / 1024 / 1024).toFixed(2);
				captureState.status = `Saved ${seconds}s ${take.extension} (${size} MB)`;
				logEngine.info(
					`Capture: offline video ${seconds}s ${take.codec}/${take.extension}, ${size} MB`
				);
			},
			(error: unknown) => {
				captureState.isFinalizing = false;
				captureState.status = 'Finalizing failed — see console';
				logEngine.error('Capture: could not finalize the offline take', error);
			}
		);
	};

	// --- video: mode dispatch ------------------------------------------------------------

	const startRecording = () => {
		if (recorder || offlineTake || offlinePending) return;

		if (!videoContext) {
			captureState.status = 'Recording failed: no 2D context';
			logEngine.error('Capture: could not acquire a 2D context for the recording canvas');
			return;
		}

		// Fixed for the whole recording — a mid-recording resize of the source canvas is
		// absorbed by scaling instead of breaking the take. Rounded DOWN TO EVEN because
		// H.264 (and most hardware encoders) reject odd dimensions; it costs at most one
		// pixel and keeps every codec in the offline probe list viable.
		const source = renderer.domElement;
		videoCanvas.width = source.width - (source.width % 2);
		videoCanvas.height = source.height - (source.height % 2);
		if (videoCanvas.width < 2 || videoCanvas.height < 2) {
			captureState.status = 'Recording failed: canvas has no size';
			logEngine.error('Capture: refusing to record a zero-sized canvas');
			return;
		}

		if (captureState.videoMode === 'offline') startOfflineRecording();
		else startRealtimeRecording();
	};

	const stopRecording = () => {
		if (offlineTake || offlinePending) stopOfflineRecording();
		else stopRealtimeRecording();
	};

	// --- the task ---------------------------------------------------------------------

	const tickRealtime = (delta: number) => {
		elapsed += delta;
		const whole = Math.floor(elapsed);
		// $state write, so it is gated on the integer changing rather than run at 60Hz.
		if (whole !== captureState.elapsedSec) captureState.elapsedSec = whole;

		frameClock += delta;
		const period = 1 / captureState.fps;
		if (frameClock >= period) {
			frameClock %= period;
			if (blitVideo()) videoTrack?.requestFrame();
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
	};

	const tickOffline = () => {
		const take = offlineTake;
		// Still building the encoder. captureRuntime.saturated is already held, so the pose
		// driver is parked and nothing is being missed.
		if (!take) return;

		if (take.failure) {
			const { message } = take.failure;
			logEngine.error('Capture: offline encoder failed mid-take', take.failure);
			teardownOffline();
			void take.cancel();
			captureState.status = `Encoder failed: ${message}`;
			return;
		}

		// THE LATCH (captureRuntime.posed, see capture.svelte.ts). On a driven take this is
		// the ONLY thing consulted: the pose driver already decided, before the render,
		// whether this frame is part of the take. Re-deriving that from `take.saturated`
		// here is the bug that made takes twitchy — the encoder can resolve between the two
		// tasks, and then a frame the driver held gets encoded anyway as a duplicate pose.
		if (captureRuntime.driven) {
			if (!captureRuntime.posed) return;
			captureRuntime.posed = false;
		} else if (take.saturated) {
			// Undriven take: nothing else is pacing it, so the queue is the only brake.
			return;
		}

		// The cap is checked BEFORE pushing, not after, so a take never finalizes in the
		// same tick it queued a frame.
		if (take.encodedSec >= captureState.maxDurationSec) {
			logEngine.info(`Capture: duration cap (${captureState.maxDurationSec}s) reached — stopping`);
			stopRecording();
			captureState.status = `Stopped at the ${captureState.maxDurationSec}s cap`;
			return;
		}

		if (!blitVideo()) return;
		take.push();
		captureRuntime.saturated = take.saturated;

		const whole = Math.floor(take.encodedSec);
		if (whole !== captureState.elapsedSec) captureState.elapsedSec = whole;
		// No invalidate() on a driven take: the pose driver invalidates from applyPose, and
		// in this scene the sky layers keep the loop alive anyway.
	};

	useTask(
		(delta) => {
			if (stillPending) {
				stillPending = false;
				grabStill();
			}

			if (offlineTake || offlinePending) {
				tickOffline();
				return;
			}
			if (recorder) tickRealtime(delta);
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	// --- lifecycle ---------------------------------------------------------------------

	$effect(() => {
		registerCaptureDriver({ screenshot, startRecording, stopRecording });
		return () => {
			stopRecording();
			unregisterCaptureDriver();
		};
	});
</script>
