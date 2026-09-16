// The offline video path — WebCodecs instead of MediaRecorder. Frames are timestamped
// `frameIndex / fps`, a counter rather than a clock, so the output is exactly-spaced no
// matter how long a frame took to render. Why MediaRecorder can't do this: capture/CLAUDE.md
// ("One video path: the offline render").
//
// mediabunny (not webm-muxer/mp4-muxer — same author, supersedes both, one dependency
// covers both containers) owns the muxing and the WebCodecs plumbing. `CanvasSource` pulls
// each frame straight off the canvas, so there is no VideoFrame lifecycle to get wrong.

import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	Quality,
	WebMOutputFormat,
	getFirstEncodableAudioCodec,
	getFirstEncodableVideoCodec,
	type AudioCodec,
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

/** Same probing shape, for the optional audio track — see "Audio: a deterministic offline render" in CLAUDE.md. */
const AUDIO_CODECS: Record<CaptureContainer, AudioCodec[]> = {
	webm: ['opus', 'vorbis'],
	mp4: ['aac', 'opus']
};

/** Fixed rather than exposed in the panel — the video bitrate slider is the one dial that matters. */
const AUDIO_BITRATE = 160_000;

/**
 * How many frames may be in flight before the caller has to hold one. Safe to queue since
 * `CanvasSource.add()` snapshots synchronously; ~50MB of NV12 at 4K is the real ceiling.
 */
const MAX_QUEUE = 4;

export interface OfflineTake {
	readonly codec: VideoCodec;
/** Whether an audio buffer was actually written — false if no encodable codec, or the take was silent. */
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
	/** Encode the canvas exactly as it stands right now. */
	push(): void;
	/**
	 * Flush, finalize, and hand back the finished file.
	 *
	 * `audio` is the take's OFFLINE RENDER — one buffer, exactly as many scene seconds long
	 * as the video, handed over whole rather than tapped in real time. Null renders silent.
	 */
	finish(audio: AudioBuffer | null): Promise<Blob>;
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

	// Probed the same way as the video codec, and never fatal: a take is still worth having
	// silent. The TRACK has to be added before `output.start()`, long before the rendered
	// buffer exists, so it is added whenever the machine can encode one — a take that turns
	// out to have no voices simply never gets a buffer written to it.
	const audioCodec = await getFirstEncodableAudioCodec(AUDIO_CODECS[container]);

	const output = new Output({
		// fastStart puts the mp4 index at the front so the file is seekable immediately;
		// 'in-memory' costs nothing extra since the take is already buffered in memory.
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

	// A PUSH source, like the video's CanvasSource — the whole take arrives in one `add()`
	// at finalize. That is the difference that fixes the drift: the old
	// MediaStreamAudioTrackSource pulled in real time from `output.start()`, so it recorded
	// wall-clock seconds against a frame-stepped video timeline.
	const audioSource = audioCodec
		? new AudioBufferSource({
				codec: audioCodec,
				quality: new Quality({ bitrate: AUDIO_BITRATE })
			})
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

		push() {
			if (finished || failure) return;
			// The timestamp is a counter, not a clock. `add` snapshots the canvas synchronously,
			// so the frame is captured the moment this returns even though encoding finishes later.
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

		async finish(audio: AudioBuffer | null) {
			finished = true;
			await Promise.all([...inFlight]);
			if (audioSource) {
				// Added after every video frame rather than interleaved: the muxer buffers,
				// and a 60 s stereo take at 48 kHz is ~23 MB — well inside what is already
				// held in memory for the video.
				if (audio) {
					await audioSource.add(audio);
					audioWritten = true;
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
			// Each entry already absorbs its own rejection into `failure` above, so this only
			// waits. The catch is here so teardown can never be the thing that throws.
			await Promise.all([...inFlight]).catch(() => {});
			await output.cancel();
		}
	};

	return take;
};
