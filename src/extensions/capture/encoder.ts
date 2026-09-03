// The offline video path — WebCodecs instead of MediaRecorder.
//
// WHY THIS EXISTS. MediaRecorder timestamps a frame by the WALL-CLOCK MOMENT
// `requestFrame()` was called. That makes the output timeline a recording of how the
// browser felt at the time: a 25ms hitch is not smoothed over, it is encoded verbatim as
// one long frame, and no amount of making the frame cheaper can do better than reduce how
// often it happens. Realtime capture can be made to hitch rarely; it cannot be made not to.
//
// A VideoEncoder is told each frame's timestamp explicitly. Here that timestamp is
// `frameIndex / fps` — derived from a counter, never from a clock. A frame that took 400ms
// to render still occupies exactly 1/fps in the output. The result is not "smoother", it is
// exactly-spaced by construction, and it stays that way on a machine that renders the scene
// at 8fps. The trade is that a take is no longer realtime: it is an offline render, and the
// viewport crawls through it.
//
// It also means the pose driver must advance on the same counter — see `captureRuntime` in
// capture.svelte.ts for that handshake, and `FlyPath.svelte` for the one driver that honours it.
//
// mediabunny (not webm-muxer/mp4-muxer — same author, supersedes both, and one dependency
// covers both containers) owns the muxing and the WebCodecs plumbing. `CanvasSource` pulls
// each frame straight off the canvas, so there is no VideoFrame lifecycle to get wrong.

import {
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	Quality,
	WebMOutputFormat,
	getFirstEncodableVideoCodec,
	type VideoCodec
} from 'mediabunny';
import type { CaptureContainer } from './types';

/**
 * Codec preference per container, best first. Probed rather than assumed — encode support
 * is a property of the machine (hardware encoders), not of the browser version, so this is
 * the same shape as a MediaRecorder mime-type probe.
 */
const CODECS: Record<CaptureContainer, VideoCodec[]> = {
	webm: ['vp9', 'av1', 'vp8'],
	mp4: ['avc', 'hevc', 'av1']
};

/**
 * How many frames may be in flight before the caller has to hold one.
 *
 * `CanvasSource.add()` snapshots the canvas synchronously and encodes asynchronously,
 * so queueing is safe — and a hold costs the take a frame of wall-clock time for
 * nothing, so holds should be rare rather than universal.
 *
 * Four frames of NV12 at 3840×2160 is ~50 MB, which is the real ceiling on this number.
 */
const MAX_QUEUE = 4;

export interface OfflineTake {
	readonly codec: VideoCodec;
	readonly extension: CaptureContainer;
	readonly width: number;
	readonly height: number;
	/** Frames handed to the encoder so far. Drives both the timestamps and the duration cap. */
	readonly frameCount: number;
	/** Scene seconds encoded so far — `frameCount / fps`, never a wall clock. */
	readonly encodedSec: number;
	/**
	 * The queue is full: the caller must hold this frame. Frames are deliberately allowed to
	 * queue several deep rather than stalling on every one — see MAX_QUEUE.
	 */
	readonly saturated: boolean;
	/** Set if the encoder or writer failed. Checked by the caller each frame. */
	readonly failure: Error | null;
	/** Encode the canvas exactly as it stands right now. */
	push(): void;
	/** Flush, finalize, and hand back the finished file. */
	finish(): Promise<Blob>;
	/** Tear down without producing a file. */
	cancel(): Promise<void>;
}

export const createOfflineTake = async (options: {
	canvas: HTMLCanvasElement;
	container: CaptureContainer;
	fps: number;
	bitrateMbps: number;
	/** Called when the encoder is ready for the next frame — the caller re-arms the loop here. */
	onReady: () => void;
}): Promise<OfflineTake> => {
	const { canvas, container, fps, bitrateMbps, onReady } = options;
	const { width, height } = canvas;

	const quality = new Quality({ bitrate: Math.round(bitrateMbps * 1_000_000) });

	const codec = await getFirstEncodableVideoCodec(CODECS[container], { width, height, quality });
	if (!codec) {
		throw new Error(`no encodable ${container} video codec at ${width}×${height}`);
	}

	const output = new Output({
		// fastStart puts the mp4 index at the front, so the file is seekable the moment it
		// lands rather than only after a full download. The take is already buffered in
		// memory, so 'in-memory' costs nothing extra here.
		format:
			container === 'mp4'
				? new Mp4OutputFormat({ fastStart: 'in-memory' })
				: new WebMOutputFormat(),
		target: new BufferTarget()
	});

	const source = new CanvasSource(canvas, {
		codec,
		quality,
		keyFrameInterval: 2,
		// The canvas is fixed for the take, but a DPR change could still resize it underneath
		// us. Stretch rather than throw — that is what the blit's own drawImage already does.
		sizeChangeBehavior: 'fill',
		// No frames may be dropped: a dropped frame here would silently shorten the take,
		// which is the exact failure this whole path exists to rule out.
		latencyMode: 'quality'
	});

	output.addVideoTrack(source, { frameRate: fps });
	await output.start();

	let frameCount = 0;
	let failure: Error | null = null;
	let finished = false;
	/**
	 * Every `add()` still in flight, all of them awaited before finalizing. `finalize()` is
	 * documented as "call after all samples have been added" and says nothing about samples
	 * still being digested, so a Stop landing while the queue is draining would be relying
	 * on undocumented flushing — for the one guarantee this whole path exists to provide.
	 */
	const inFlight = new Set<Promise<void>>();

	const take: OfflineTake = {
		codec,
		extension: container,
		width,
		height,
		get frameCount() {
			return frameCount;
		},
		get encodedSec() {
			return frameCount / fps;
		},
		get saturated() {
			return inFlight.size >= MAX_QUEUE;
		},
		get failure() {
			return failure;
		},

		push() {
			if (finished || failure) return;
			// The timestamp is the whole point: a counter, not a clock. `add` snapshots the
			// canvas synchronously, so the frame is safely captured the moment this returns
			// even though the encode itself finishes later.
			const timestamp = frameCount / fps;
			frameCount += 1;

			const settled = source.add(timestamp, 1 / fps).then(
				() => {},
				(error: unknown) => {
					failure ??= error instanceof Error ? error : new Error(String(error));
				}
			);
			inFlight.add(settled);
			void settled.then(() => {
				inFlight.delete(settled);
				onReady();
			});
		},

		async finish() {
			finished = true;
			await Promise.all([...inFlight]);
			await output.finalize();
			const buffer = (output.target as BufferTarget).buffer;
			if (!buffer) throw new Error('encoder produced no buffer');
			return new Blob([buffer], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
		},

		async cancel() {
			finished = true;
			// Each entry already absorbs its own rejection into `failure` above, so this only
			// waits. The catch is here so teardown can never be the thing that throws.
			await Promise.all([...inFlight]).catch(() => {});
			await output.cancel();
		}
	};

	return take;
};
