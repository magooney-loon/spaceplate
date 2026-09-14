<script lang="ts">
	// The capture driver — stills and video. Renders nothing; owns the grab task.
	// Mount position, task ordering vs. the Gizmo, and what ends up in the output: capture/CLAUDE.md.

	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { PerspectiveCamera, Vector2 } from 'three/webgpu';
	import { setFixedStepSource } from '$core';
	import { sceneState } from '$extensions/scene';
	import { logEngine } from '$extensions/logger';
	import {
		captureResolutionSize,
		captureRuntime,
		captureState,
		registerCaptureDriver,
		unregisterCaptureDriver
	} from './capture.svelte';
	import { createOfflineTake, type OfflineTake } from './encoder';

	const { renderer, camera, invalidate, autoRenderTask } = useThrelte();

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

	// THE BLIT. Both grabs copy the live canvas (COPY_SRC, DOCS/webgpu-notes.md §5.2) into a
	// 2D canvas of their own, only from inside the task while the frame is current. Cost
	// scales with the backing store, not CSS size — see capture/CLAUDE.md for why contexts
	// are acquired once at module scope. Writing canvas.width/height clears the pixels but
	// keeps the context object, so both survive the resizes below.

	// --- render resolution ---------------------------------------------------------
	// Every capture resizes the renderer for its duration so the frame is genuinely drawn
	// at the selected size. See "Resolution: always a preset, never as-is" in capture/CLAUDE.md
	// for the updateStyle trick, why aspect is set by hand, and Threlte reclaiming the canvas.

	// THE PRIME FRAME: a projection change leaves VelocityNode one frame stale (copies
	// current→previous proj once per rendered frame), so the first frame after a resize
	// reports bogus velocity and motionBlur smears it. See capture/CLAUDE.md. One
	// rendered-and-discarded frame fixes it, and also covers holdResolution()'s mid-capture clear.
	let primeFrames = 0;
	const PRIME_FRAMES = 1;

	const drawingBuffer = new Vector2();
	const savedSize = new Vector2();
	/** The size currently forced on the renderer, or null when the canvas is Threlte's again. */
	let sizeOverride: { width: number; height: number } | null = null;
	let savedPixelRatio = 1;
	let savedAspect = 0;

	const perspective = () => (camera.current instanceof PerspectiveCamera ? camera.current : null);

	/** True only if THIS call installed the override — the caller then owns releasing it. */
	const applyResolution = (): boolean => {
		if (sizeOverride) return false;
		const target = captureResolutionSize(captureState.resolution);

		// The restore point is read here rather than remembered from mount, so a window that
		// was resized before the capture still restores to where it actually is.
		renderer.getSize(savedSize);
		savedPixelRatio = renderer.getPixelRatio();
		sizeOverride = target;

		// Pixel ratio first: setPixelRatio() re-runs setSize() with the previous dimensions,
		// so doing it the other way round would immediately undo the size below.
		renderer.setPixelRatio(1);
		renderer.setSize(target.width, target.height, false);

		const cam = perspective();
		if (cam) {
			savedAspect = cam.aspect;
			cam.aspect = target.width / target.height;
			cam.updateProjectionMatrix();
		}
		// The projection (and the drawing buffer) just moved under the velocity buffer —
		// burn a frame before anything reads the canvas. See PRIME_FRAMES above.
		primeFrames = PRIME_FRAMES;
		invalidate();
		return true;
	};

	const releaseResolution = () => {
		if (!sizeOverride) return;
		sizeOverride = null;
		renderer.setPixelRatio(savedPixelRatio);
		renderer.setSize(savedSize.width, savedSize.height, false);
		const cam = perspective();
		if (cam && savedAspect > 0) {
			cam.aspect = savedAspect;
			cam.updateProjectionMatrix();
		}
		invalidate();
	};

	/**
	 * Threlte reclaimed the canvas mid-capture (resize or dpr change) — compared on the
	 * drawing buffer since a pixel-ratio-only change wouldn't show in the logical size.
	 * Re-applies rather than restoring old numbers: where the window is NOW is where a take
	 * should restore to when it ends.
	 */
	const holdResolution = () => {
		const target = sizeOverride;
		if (!target) return;
		renderer.getDrawingBufferSize(drawingBuffer);
		if (drawingBuffer.width === target.width && drawingBuffer.height === target.height) return;
		sizeOverride = null;
		applyResolution();
	};

	// --- stills ---------------------------------------------------------------------
	// Armed here, grabbed in the task — see "Screenshots are armed, not taken" in CLAUDE.md.
	// Alpha-capable context: PNG/WebP carry transparency, JPEG flattens onto black.

	const stillCanvas = document.createElement('canvas');
	const stillContext = stillCanvas.getContext('2d');
	let stillPending = false;
	/** Whether the armed still is the one that installed the resolution override. */
	let stillOwnsResolution = false;

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
		// Installed HERE, a frame ahead of the grab, so the target frame is drawn at the right
		// size. Not released if a recording already owns the override — the still just joins
		// that take's resolution.
		stillOwnsResolution = applyResolution();
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
	// One mode: WebCodecs via mediabunny (encoder.ts) — frames timestamped from a counter,
	// never a clock; see "One video path" in capture/CLAUDE.md for why realtime/MediaRecorder
	// was removed. Read from this 2D canvas (the pre-Gizmo blit), sized once at take start.

	const videoCanvas = document.createElement('canvas');
	const videoContext = videoCanvas.getContext('2d', { alpha: false });

	/** No clear first: the context is opaque and drawImage covers every pixel. */
	const blitVideo = () => {
		if (!videoContext) return false;
		videoContext.drawImage(renderer.domElement, 0, 0, videoCanvas.width, videoCanvas.height);
		return true;
	};

	// --- video: the take (WebCodecs) ----------------------------------------------------

	let offlineTake: OfflineTake | null = null;
	/** True between arming a take and the encoder actually existing — creation is async. */
	let offlinePending = false;
	/** Frames the clock has released to this take. Only frame 0 is special (see below). */
	let takeFrames = 0;

	// The fixed-step source (core/utils/engineClock.ts): decides once per frame, before any
	// stage runs, what every task in the app advances by. Latches the decision into
	// captureRuntime.posed because `saturated` is async and can flip mid-frame — see
	// "The advance decision is latched" in capture/CLAUDE.md.
	const takeStep = (): number | null => {
		// Not ready, or queue full: hold — frame isn't even rendered, so nothing reaches the take.
		if (!offlineTake || captureRuntime.saturated) {
			captureRuntime.posed = false;
			return null;
		}
		// Prime frame: must render without being part of the take. Step 0 — draws but doesn't
		// move scene time.
		if (primeFrames > 0) {
			captureRuntime.posed = false;
			return 0;
		}
		captureRuntime.posed = true;
		// Frame 0 encodes where the pose driver already left it (see "head frame" in CLAUDE.md).
		return takeFrames++ === 0 ? 0 : captureRuntime.frameStep;
	};

	const teardownOffline = () => {
		setFixedStepSource(null);
		// Covers the normal stop, the async encoder-creation failure and the mid-take encoder
		// failure alike — all three come through here.
		releaseResolution();
		offlineTake = null;
		offlinePending = false;
		takeFrames = 0;
		captureRuntime.posed = false;
		captureRuntime.saturated = false;
		captureState.isRecording = false;
	};

	/**
	 * A queued frame finished encoding — clears the stall once the queue drains below its
	 * limit and wakes the loop. Load-bearing: a held frame isn't rendered, so this is the
	 * only thing that can end a hold.
	 */
	const onEncoderReady = () => {
		const take = offlineTake;
		if (!take) return;
		captureRuntime.saturated = take.saturated;
		if (!captureRuntime.saturated) invalidate();
	};

	const startOfflineRecording = () => {
		// isRecording flips optimistically (callers like flypath check it next line); held
		// saturated until the encoder actually exists — see capture/CLAUDE.md.
		offlinePending = true;
		takeFrames = 0;
		captureState.isRecording = true;
		captureState.elapsedSec = 0;
		captureRuntime.posed = false;
		captureRuntime.saturated = true;
		captureRuntime.frameStep = 1 / captureState.fps;
		captureState.status = 'Preparing encoder…';
		// Claim the clock now, not when the encoder lands: from here every frame is either
		// part of the take or a deliberate hold.
		setFixedStepSource(takeStep);

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

		// Draining, muxing and building the Blob happen here — not instant at 4K. Gate the
		// panel for the whole window (see isFinalizing in capture/CLAUDE.md).
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

	// --- video: the driver contract -------------------------------------------------------

	const startRecording = () => {
		if (offlineTake || offlinePending) return;

		if (!videoContext) {
			captureState.status = 'Recording failed: no 2D context';
			logEngine.error('Capture: could not acquire a 2D context for the recording canvas');
			return;
		}

		// Resize BEFORE measuring: source canvas is about to become exactly the selected size.
		// Released by teardownOffline, or by the failure check below.
		applyResolution();

		// Fixed for the whole recording; a mid-recording resize is absorbed by scaling.
		// Rounded down to even — H.264 and most hardware encoders reject odd dimensions.
		const source = renderer.domElement;
		videoCanvas.width = source.width - (source.width % 2);
		videoCanvas.height = source.height - (source.height % 2);
		if (videoCanvas.width < 2 || videoCanvas.height < 2) {
			captureState.status = 'Recording failed: canvas has no size';
			logEngine.error('Capture: refusing to record a zero-sized canvas');
			releaseResolution();
			return;
		}

		startOfflineRecording();

		// Covers the synchronous failure paths; the async failure path releases via teardownOffline.
		if (!captureState.isRecording) releaseResolution();
	};

	const stopRecording = () => {
		if (offlineTake || offlinePending) stopOfflineRecording();
	};

	// --- the task ---------------------------------------------------------------------

	const tickOffline = () => {
		const take = offlineTake;
		// Still building the encoder — the clock source holds every frame until it exists.
		if (!take) return;

		if (take.failure) {
			const { message } = take.failure;
			logEngine.error('Capture: offline encoder failed mid-take', take.failure);
			teardownOffline();
			void take.cancel();
			captureState.status = `Encoder failed: ${message}`;
			return;
		}

		// The latch (captureRuntime.posed) is the only thing consulted — never re-derive from
		// `take.saturated`, which can resolve mid-frame and would encode a held frame twice.
		if (!captureRuntime.posed) return;
		captureRuntime.posed = false;

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
		// No invalidate() here: the engine clock invalidates every non-held frame of a take,
		// which is what makes the take's pace its own.
	};

	useTask(
		() => {
			// Before anything reads the canvas: if Threlte took the size back mid-capture,
			// claim it again (see holdResolution).
			holdResolution();

			// Prime frame: decremented HERE and nowhere else, so both consumers (still + clock
			// source) skip the same frame. invalidate() because the still path needs it.
			if (primeFrames > 0) {
				primeFrames--;
				invalidate();
				return;
			}

			if (stillPending) {
				stillPending = false;
				grabStill();
				// toBlob() reads stillCanvas (already blitted), so the renderer can go back to
				// the viewport immediately — the encode no longer depends on it.
				if (stillOwnsResolution) {
					stillOwnsResolution = false;
					// …unless a recording started in the meantime (armed on one frame, ⏺ on the
					// next): it is relying on the same override now, and its own stop restores it.
					if (!offlineTake && !offlinePending) releaseResolution();
				}
			}

			if (offlineTake || offlinePending) tickOffline();
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	// --- lifecycle ---------------------------------------------------------------------

	$effect(() => {
		registerCaptureDriver({ screenshot, startRecording, stopRecording });
		return () => {
			stopRecording();
			// stopRecording covers a take; this covers a still armed but never grabbed — leaving
			// the renderer resized after unmount would be permanent.
			releaseResolution();
			unregisterCaptureDriver();
		};
	});
</script>
