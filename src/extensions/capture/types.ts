export const extensionScope = 'capture';

/** Encodings `HTMLCanvasElement.toBlob` accepts across the browsers this app targets. */
export type CaptureImageFormat = 'png' | 'jpeg' | 'webp';

/** Output container. Steers the realtime mime probe and the offline codec probe alike. */
export type CaptureContainer = 'webm' | 'mp4';

/**
 * How a recording is timed.
 *
 * - `realtime` — MediaRecorder off a canvas stream. The take runs at wall-clock speed and
 *   the viewport stays live, but frame timestamps ARE the wall clock, so a hitch is encoded
 *   into the file.
 * - `offline` — WebCodecs, timestamps derived from a frame counter (see `encoder.ts`). The
 *   output is exactly-spaced no matter how slowly it renders; the take is not realtime.
 */
export type CaptureVideoMode = 'realtime' | 'offline';

export type CaptureState = {
	imageFormat: CaptureImageFormat;
	/** Encoder quality for the lossy formats, 0..1. Ignored for png. */
	imageQuality: number;
	videoMode: CaptureVideoMode;
	container: CaptureContainer;
	/** Output framerate of a recording. The render loop may run faster; frames are throttled to this. */
	fps: number;
	/** Target bitrate, megabits/s. Used by both video modes. */
	bitrateMbps: number;
	/** Hard cap in seconds — a recording auto-stops here so a forgotten one cannot pin the loop forever. */
	maxDurationSec: number;

	// --- driver-written, read-only from the panel's point of view ---
	isRecording: boolean;
	/**
	 * The take has stopped but the file is not ready yet: the offline path is still draining
	 * its encode queue and muxing, the realtime path is waiting on `MediaRecorder.onstop`.
	 * Neither is instant, so without this the UI claims "done" and then the download prompt
	 * arrives seconds later. Panels gate their controls on `isRecording || isFinalizing`.
	 */
	isFinalizing: boolean;
	/**
	 * Whole seconds of OUTPUT recorded so far; only written when it changes. In offline mode
	 * this is encoded scene time, not time spent waiting for it.
	 */
	elapsedSec: number;
	/** Last outcome or error, shown in the panel. */
	status: string;
};

export type CaptureActions = {
	/** True while a take is running OR its file is still being written. Gate UI on this. */
	isBusy(): boolean;
	setImageFormat(format: CaptureImageFormat): void;
	setImageQuality(quality: number): void;
	setVideoMode(mode: CaptureVideoMode): void;
	setContainer(container: CaptureContainer): void;
	setFps(fps: number): void;
	setBitrateMbps(bitrate: number): void;
	setMaxDurationSec(seconds: number): void;
	/** Arms a screenshot; the frame is grabbed on the next rendered frame. */
	screenshot(): void;
	toggleRecording(): void;
	/** Explicit forms, so other extensions can bracket a recording around their own playback. */
	startRecording(): void;
	stopRecording(): void;
};

/**
 * Implemented by `Capture.svelte` (which is inside `<Canvas>` and therefore owns the
 * renderer, the task and the MediaRecorder) and registered into the state module, so the
 * Studio panel can drive it without being a Canvas child. Same register/unregister shape
 * as `scenes/DemoScene/mirrorFloor.ts`.
 */
export type CaptureDriver = {
	screenshot(): void;
	startRecording(): void;
	stopRecording(): void;
};
