// THE OFFLINE VIDEO TAKE. Owns the engine clock for its duration, the encoder, and the
// take's audio render. One video path only — frames are timestamped from a COUNTER, never
// a clock, so a take that renders at 8 fps is still exactly-spaced and is not slow motion
// in anything. The invariants (the latched advance decision, the head frame, the queue
// depth, why the clock is claimed synchronously): capture/CLAUDE.md.

import { audio as audioLayer, sceneNow, setFixedStepSource } from '$core';
import { logEngine } from '$extensions/logger';
import { captureRuntime, captureState } from './capture.svelte';
import { createOfflineTake, type OfflineTake } from './encoder';
import type { ResolutionOverride } from './resolution';

export interface TakeRunner {
	/** Arm a take and claim the clock. Synchronous by contract — see capture/CLAUDE.md. */
	start(): void;
	/** Stop, hand the clock back, and finalize whatever was encoded. */
	stop(): void;
	/** Called from the task, after the pipeline drew the frame. */
	tick(): void;
	/** True from arming until teardown, encoder or no encoder. */
	readonly active: boolean;
	dispose(): void;
}

export const createTakeRunner = (options: {
	/** The live renderer canvas, read fresh each frame. */
	source: () => HTMLCanvasElement;
	resolution: ResolutionOverride;
	download: (blob: Blob, extension: string) => void;
	invalidate: () => void;
}): TakeRunner => {
	const { source, resolution, download, invalidate } = options;

	let take: OfflineTake | null = null;
	/** True between arming a take and its encoder actually existing — creation is async. */
	let pending = false;
	/**
	 * Bumped by every start and every teardown, so an encoder that lands after its own take
	 * was abandoned can be told apart from the one the CURRENT take is waiting for.
	 *
	 * Load-bearing, not defensive. Without it, stopping a take before its encoder is built
	 * and immediately starting another lets the FIRST encoder install itself into the
	 * SECOND take — and the second encoder, arriving to find the slot taken, then discards
	 * the live take's armed audio recorder and cancels itself. The result is a silent video
	 * written by an encoder built for the previous frame size, from two fast clicks on ⏺.
	 */
	let generation = 0;
	/** Frames the clock has released to this take. Only frame 0 is special (see below). */
	let frames = 0;
	let release: (() => void) | null = null;

	// The fixed-step source (core/utils/engineClock.ts): decides once per frame, before any
	// stage runs, what every task in the app advances by. Latches the decision into
	// captureRuntime.posed because `saturated` is async and can flip mid-frame — see
	// "The advance decision is latched" in capture/CLAUDE.md.
	const step = (): number | null => {
		// Not ready, or queue full: hold — frame isn't even rendered, so nothing reaches the take.
		if (!take || captureRuntime.saturated) {
			captureRuntime.posed = false;
			return null;
		}
		// Prime frame: must render without being part of the take. Step 0 — draws but
		// doesn't move scene time. A hold would not draw it, and drawing it is the point.
		if (resolution.priming) {
			captureRuntime.posed = false;
			return 0;
		}
		captureRuntime.posed = true;
		// Frame 0 encodes where the pose driver already left it (see "head frame" in CLAUDE.md).
		return frames++ === 0 ? 0 : captureRuntime.frameStep;
	};

	const teardown = () => {
		// Invalidates any encoder still in flight for this take — see `generation`.
		generation++;
		setFixedStepSource(null);
		// Covers the normal stop, the async encoder-creation failure and the mid-take
		// encoder failure alike — all three come through here.
		release?.();
		release = null;
		take = null;
		pending = false;
		frames = 0;
		captureRuntime.posed = false;
		captureRuntime.saturated = false;
		captureState.isRecording = false;
	};

	/**
	 * A queued frame finished encoding — clears the stall once the queue drains below its
	 * limit and wakes the loop. Load-bearing: a held frame isn't rendered, so this is the
	 * only thing that can end a hold.
	 */
	const onReady = () => {
		const current = take;
		if (!current) return;
		captureRuntime.saturated = current.saturated;
		if (!captureRuntime.saturated) invalidate();
	};

	const start = () => {
		if (take || pending) return;

		// Acquired BEFORE measuring: the live canvas is about to become exactly the preset.
		release = resolution.acquire();

		// Fixed for the whole take; every frame must match it. The presets are all even
		// (types.ts) and the override forces pixel ratio 1, so the rounding is a guard
		// rather than a step — H.264 and most hardware encoders reject odd dimensions.
		const live = source();
		const width = live.width - (live.width % 2);
		const height = live.height - (live.height % 2);
		if (width < 2 || height < 2) {
			captureState.status = 'Recording failed: canvas has no size';
			logEngine.error('Capture: refusing to record a zero-sized canvas');
			release();
			release = null;
			return;
		}

		// isRecording flips optimistically (callers like flypath check it on the next
		// line); captureRuntime.saturated is held until the encoder actually exists, so
		// scene time cannot advance into a take that has not begun.
		const id = ++generation;
		pending = true;
		frames = 0;
		captureState.isRecording = true;
		captureState.elapsedSec = 0;
		captureRuntime.posed = false;
		captureRuntime.saturated = true;
		captureRuntime.frameStep = 1 / captureState.fps;
		captureState.status = 'Preparing encoder…';
		// Armed at the same scene time the clock is claimed below, so the take's audio
		// window and its video window start on the same instant.
		audioLayer.recording.arm(sceneNow());
		// Claim the clock now, not when the encoder lands: from here every frame is either
		// part of the take or a deliberate hold.
		setFixedStepSource(step);

		void createOfflineTake({
			width,
			height,
			container: captureState.container,
			fps: captureState.fps,
			bitrateMbps: captureState.bitrateMbps,
			onReady
		}).then(
			(built) => {
				// Abandoned while we were awaiting. Whoever abandoned it has already handed
				// the audio recorder back (a newer take may own it by now), so the encoder
				// is the only thing here that is still ours to throw away.
				if (id !== generation) {
					void built.cancel();
					return;
				}
				take = built;
				pending = false;
				captureRuntime.saturated = false;
				captureState.status = 'Rendering offline…';
				logEngine.info(
					`Capture: offline take ${built.width}×${built.height} @ ${captureState.fps}fps, ` +
						`${built.codec}/${built.extension}, ` +
						`cap ${captureState.maxDurationSec}s`
				);
				invalidate();
			},
			(error: unknown) => {
				// Already torn down, and possibly superseded — reporting now would clobber a
				// live take's status with a cancelled take's failure.
				if (id !== generation) return;
				teardown();
				// The recorder was armed in the same call that claimed the clock; a take that
				// dies here must hand it back or it samples automation forever (capture/CLAUDE.md).
				audioLayer.recording.discard();
				captureState.status = 'Offline recording failed — see console';
				logEngine.error('Capture: could not start the offline encoder', error);
			}
		);
	};

	/**
	 * Drain, render the audio, mux, download. Lands entirely inside `isFinalizing`, which
	 * exists for exactly this window — none of it is instant at 4K.
	 */
	const finalize = async (built: OfflineTake) => {
		// The take's audio, rendered offline from the scene-time stamps the layer recorded —
		// exactly `frameCount / fps` seconds, the same counter the video timestamps come
		// from, so the two tracks cannot drift however slowly the take rendered. Null (and a
		// silent file) when nothing was armed or no voice ever sounded.
		const rendered = await audioLayer.recording.render(built.encodedSec).catch((error: unknown) => {
			// Audio is never fatal (see capture/CLAUDE.md): a failed render still hands over
			// a silent-but-correct video rather than losing the take.
			logEngine.warn('Capture: offline audio render failed — saving silent', error);
			return null;
		});

		const seconds = built.encodedSec.toFixed(1);
		try {
			captureState.status = 'Preparing video…';
			const blob = await built.finish(rendered);
			if (blob.size === 0) {
				captureState.status = 'Recording produced no data';
				logEngine.warn('Capture: offline take produced no data');
				return;
			}
			download(blob, built.extension);
			const size = (blob.size / 1024 / 1024).toFixed(2);
			const audioNote = built.hasAudio ? '' : ', no audio';
			captureState.status = `Saved ${seconds}s ${built.extension} (${size} MB${audioNote})`;
			logEngine.info(
				`Capture: offline video ${seconds}s ${built.codec}/${built.extension}, ${size} MB${audioNote}`
			);
		} catch (error: unknown) {
			captureState.status = 'Finalizing failed — see console';
			logEngine.error('Capture: could not finalize the offline take', error);
			// finish() left the output open with its WebCodecs encoders alive, and nothing
			// else will ever close them.
			await built.cancel();
		} finally {
			captureState.isFinalizing = false;
		}
	};

	const stop = () => {
		const built = take;
		const wasPending = pending;
		// Nothing armed: return before teardown, which would otherwise hand back a clock
		// this take never claimed.
		if (!built && !wasPending) return;
		teardown();

		if (!built) {
			// Stopped before the encoder existed. The recorder is handed back HERE rather
			// than in the encoder's own `.then`, which may not run for a while and would
			// otherwise be racing the next take for it.
			if (wasPending) audioLayer.recording.discard();
			return;
		}

		captureState.isFinalizing = true;
		captureState.status = 'Rendering audio…';
		void finalize(built);
	};

	const tick = () => {
		const current = take;
		// Still building the encoder — the clock source holds every frame until it exists.
		if (!current) return;

		const failure = current.failure;
		if (failure) {
			logEngine.error('Capture: offline encoder failed mid-take', failure);
			teardown();
			audioLayer.recording.discard();
			void current.cancel();
			captureState.status = `Encoder failed: ${failure.message}`;
			return;
		}

		// The latch (captureRuntime.posed) is the only thing consulted — never re-derive
		// from `current.saturated`, which can resolve mid-frame and would encode a held
		// frame twice.
		if (!captureRuntime.posed) return;
		captureRuntime.posed = false;

		// The cap is checked BEFORE pushing, not after, so a take never finalizes in the
		// same tick it queued a frame. The status is written before stop(), which starts the
		// finalize chain and has its own progress messages to put up.
		if (current.encodedSec >= captureState.maxDurationSec) {
			logEngine.info(`Capture: duration cap (${captureState.maxDurationSec}s) reached — stopping`);
			captureState.status = `Stopped at the ${captureState.maxDurationSec}s cap`;
			stop();
			return;
		}

		current.push(source());
		captureRuntime.saturated = current.saturated;

		const whole = Math.floor(current.encodedSec);
		if (whole !== captureState.elapsedSec) captureState.elapsedSec = whole;
		// No invalidate() here: the engine clock invalidates every non-held frame of a take,
		// which is what makes the take's pace its own.
	};

	return {
		start,
		stop,
		tick,
		get active() {
			return take !== null || pending;
		},
		dispose() {
			stop();
		}
	};
};
