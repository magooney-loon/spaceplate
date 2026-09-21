// The offline video path — WebCodecs instead of MediaRecorder. Frames are timestamped
// `frameIndex / fps`, a counter rather than a clock, so the output is exactly-spaced no
// matter how long a frame took to render. Why MediaRecorder can't do this: capture/CLAUDE.md
// ("One video path: the offline render").
//
// mediabunny (not webm-muxer/mp4-muxer — same author, supersedes both, one dependency
// covers both containers) owns the muxing and the WebCodecs plumbing. Frames go in as
// `VideoSample`s built straight off the live renderer canvas, so nothing is copied through
// a 2D canvas on the way (see `push`).

import {
	AudioBufferSource,
	BufferTarget,
	Mp4OutputFormat,
	Output,
	Quality,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat,
	getFirstEncodableAudioCodec,
	getFirstEncodableVideoCodec,
	type AudioCodec,
	type VideoCodec
} from 'mediabunny';
import { logEngine } from '$extensions/logger';
import type { CaptureContainer } from './types';

/**
 * Codec preference per container, best first. Probed rather than assumed — encode support
 * is a property of the machine (hardware encoders), not of the browser version, so this is
 * the same shape as a MediaRecorder mime-type probe. A container with none of its codecs
 * available throws; there is no cross-container fallback, so the chosen container always
 * decides the file extension.
 */
const CODECS: Record<CaptureContainer, VideoCodec[]> = {
	webm: ['vp9', 'av1', 'vp8'],
	mp4: ['avc', 'hevc', 'av1']
};

/** Same probing shape, for the optional audio track — see "Audio: a deterministic offline render" in CLAUDE.md. */
const AUDIO_CODECS: Record<CaptureContainer, AudioCodec[]> = {
	webm: ['opus', 'vorbis'],
	mp4: ['aac', 'opus']
};

/** Fixed rather than exposed in the panel — the video bitrate slider is the one dial that matters. */
const AUDIO_BITRATE = 160_000;

/** What the offline render produces (`CHANNELS` in core/audio/render.ts). Probed against. */
const AUDIO_CHANNELS = 2;

/**
 * How many frames may be in flight before the caller has to hold one. Safe to queue since
 * each frame's pixels are snapshotted synchronously; ~50MB of NV12 at 4K is the real ceiling.
 */
const MAX_QUEUE = 4;

const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

export interface OfflineTake {
	readonly codec: VideoCodec;
	/** Whether an audio buffer was actually written — false if no encodable codec, the take was silent, or the encode failed. */
	readonly hasAudio: boolean;
	readonly extension: CaptureContainer;
	readonly width: number;
	readonly height: number;
	/** Frames handed to the encoder so far. Drives both the timestamps and the duration cap. */
	readonly frameCount: number;
	/** Scene seconds encoded so far — `frameCount / fps`, never a wall clock. */
	readonly encodedSec: number;
	/** Queue is full: caller must hold this frame — see MAX_QUEUE. */
	readonly saturated: boolean;
	/** Set if the encoder or writer failed. Checked by the caller each frame. */
	readonly failure: Error | null;
	/**
	 * Encode the canvas exactly as it stands right now. Only legal while the frame is
	 * current, i.e. from inside the render task.
	 */
	push(canvas: HTMLCanvasElement): void;
	/**
	 * Flush, finalize, and hand back the finished file.
	 *
	 * `audio` is the take's OFFLINE RENDER — one buffer, exactly as many scene seconds long
	 * as the video, handed over whole rather than tapped in real time. Null renders silent,
	 * and so does a buffer the audio encoder turns out to reject.
	 */
	finish(audio: AudioBuffer | null): Promise<Blob>;
	/** Tear down without producing a file. Never throws. */
	cancel(): Promise<void>;
}

export const createOfflineTake = async (options: {
	/** Encoded frame size. Fixed for the whole take; every frame must match it. */
	width: number;
	height: number;
	container: CaptureContainer;
	fps: number;
	bitrateMbps: number;
	/** Called when the encoder is ready for the next frame — the caller re-arms the loop here. */
	onReady: () => void;
}): Promise<OfflineTake> => {
	const { width, height, container, fps, bitrateMbps, onReady } = options;

	const quality = new Quality({ bitrate: Math.round(bitrateMbps * 1_000_000) });

	const codec = await getFirstEncodableVideoCodec(CODECS[container], { width, height, quality });
	if (!codec) {
		throw new Error(`no encodable ${container} video codec at ${width}×${height}`);
	}

	// Probed the same way as the video codec, and never fatal: a take is still worth having
	// silent. Probed WITH the channel count and bitrate the offline render will actually
	// produce — the one thing that cannot be passed is the sample rate, since the buffer
	// does not exist until finalize, which is why `finish()` also has to survive the
	// encoder rejecting it. The TRACK has to be added before `output.start()`, long before
	// that buffer exists, so it is added whenever the machine can encode one at all; a take
	// that turns out to have no voices simply never gets a buffer written to it.
	const audioQuality = new Quality({ bitrate: AUDIO_BITRATE });
	const audioCodec = await getFirstEncodableAudioCodec(AUDIO_CODECS[container], {
		numberOfChannels: AUDIO_CHANNELS,
		quality: audioQuality
	});

	const output = new Output({
		// fastStart puts the mp4 index at the front so the file is seekable immediately;
		// 'in-memory' costs nothing extra since the take is already buffered in memory.
		format:
			container === 'mp4'
				? new Mp4OutputFormat({ fastStart: 'in-memory' })
				: new WebMOutputFormat(),
		target: new BufferTarget()
	});

	const source = new VideoSampleSource({
		codec,
		quality,
		keyFrameInterval: 2,
		// The preset is fixed for the take, but a DPR change could still resize the canvas
		// underneath us for the one frame before `hold()` re-claims it. Stretch rather than
		// throw — the default here is 'deny', which would fail the take outright.
		sizeChangeBehavior: 'fill',
		// No frames may be dropped: a dropped frame here would silently shorten the take,
		// which is the exact failure this whole path exists to rule out.
		latencyMode: 'quality'
	});

	output.addVideoTrack(source, { frameRate: fps });

	// A PUSH source, like the video's — the whole take arrives in one `add()` at finalize.
	// That is the difference that fixes the drift: the old MediaStreamAudioTrackSource
	// pulled in real time from `output.start()`, so it recorded wall-clock seconds against
	// a frame-stepped video timeline.
	const audioSource = audioCodec
		? new AudioBufferSource({ codec: audioCodec, quality: audioQuality })
		: null;
	if (audioSource) output.addAudioTrack(audioSource);

	await output.start();

	let frameCount = 0;
	let audioWritten = false;
	let failure: Error | null = null;
	let finished = false;
	/**
	 * Every `add()` still in flight, awaited before finalizing — `finalize()` is documented
	 * as "call after all samples added" but says nothing about samples still digesting.
	 */
	const inFlight = new Set<Promise<void>>();

	const take: OfflineTake = {
		codec,
		get hasAudio() {
			return audioWritten;
		},
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

		push(canvas: HTMLCanvasElement) {
			if (finished || failure) return;
			// The timestamp is a counter, not a clock.
			const timestamp = frameCount / fps;

			let sample: VideoSample;
			try {
				// Straight off the live canvas — `new VideoFrame(canvas)` under the hood, so
				// the pixels are snapshotted synchronously right here and encoded later,
				// exactly like CanvasSource's own add(). This is what replaced the blit into
				// a second 2D canvas, which used to be the most expensive thing capture did
				// per frame (capture/CLAUDE.md).
				sample = new VideoSample(canvas, { timestamp, duration: 1 / fps });
			} catch (error: unknown) {
				// Counted only once a frame actually exists, so a failure here leaves no
				// gap in the timestamps.
				failure ??= asError(error);
				return;
			}
			frameCount += 1;

			// `VideoSampleSource.add` does NOT take ownership of the sample — it passes
			// `shouldClose: false` internally where `CanvasSource` passes `true` — so the
			// frame has to be closed here, and only once `add()` settles, since the encoder
			// reads from it until then.
			const settled = source
				.add(sample)
				.then(
					() => {},
					(error: unknown) => {
						failure ??= asError(error);
					}
				)
				.finally(() => {
					sample.close();
				});
			inFlight.add(settled);
			void settled.then(() => {
				inFlight.delete(settled);
				onReady();
			});
		},

		async finish(audio: AudioBuffer | null) {
			finished = true;
			await Promise.all([...inFlight]);
			if (audioSource) {
				// Added after every video frame rather than interleaved: the muxer buffers,
				// and a 60 s stereo take at 48 kHz is ~23 MB — well inside what is already
				// held in memory for the video.
				if (audio) {
					try {
						await audioSource.add(audio);
						audioWritten = true;
					} catch (error: unknown) {
						// NEVER FATAL, and this is the one place that could have made it so:
						// the codec was probed without the buffer's real sample rate (it did
						// not exist yet), so a mismatch surfaces here — and losing the whole
						// video to it would be the worst trade available. Fall through to a
						// silent file, which `hasAudio` reports.
						logEngine.warn(
							'Capture: the take audio could not be encoded — saving a silent video',
							error
						);
					}
				}
				audioSource.close();
			}
			await output.finalize();
			const buffer = (output.target as BufferTarget).buffer;
			if (!buffer) throw new Error('encoder produced no buffer');
			return new Blob([buffer], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
		},

		async cancel() {
			finished = true;
			// Each entry already absorbs its own rejection into `failure` above, so this
			// only waits. The catch is here so teardown can never be the thing that throws.
			await Promise.all([...inFlight]).catch(() => {});
			// Also reached to clean up after a FAILED finish(), which leaves the output open
			// with its encoders alive — so the terminal states have to be tolerated rather
			// than assumed away.
			if (output.state === 'canceled' || output.state === 'finalized') return;
			await output.cancel().catch(() => {});
		}
	};

	return take;
};
