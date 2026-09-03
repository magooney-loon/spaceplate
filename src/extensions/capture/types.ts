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

/**
 * Output sizes offered for both stills and video.
 *
 * `viewport` is the historical behaviour: whatever the canvas already is, i.e. its CSS size
 * × DPR, so the file size depends on the window and the display. Every other entry is an
 * exact pixel size the frame is genuinely RE-RENDERED at (`Capture.svelte` resizes the
 * renderer for the duration of the capture) — a 4K take out of a half-screen window is real
 * 4K, not an upscale.
 *
 * All widths and heights are even: H.264 and most hardware encoders reject odd dimensions.
 */
export const CAPTURE_RESOLUTIONS = [
	{ value: 'viewport', text: 'Viewport (as-is)', width: 0, height: 0 },
	{ value: '720p', text: '720p · 1280×720', width: 1280, height: 720 },
	{ value: '1080p', text: '1080p · 1920×1080', width: 1920, height: 1080 },
	{ value: '1440p', text: '1440p · 2560×1440', width: 2560, height: 1440 },
	{ value: '2160p', text: '4K · 3840×2160', width: 3840, height: 2160 }
] as const;

export type CaptureResolution = (typeof CAPTURE_RESOLUTIONS)[number]['value'];

/** The pixel size of a preset, or `null` for `viewport` — "leave the canvas alone". */
export const captureResolutionSize = (
	resolution: CaptureResolution
): { width: number; height: number } | null => {
	const entry = CAPTURE_RESOLUTIONS.find((option) => option.value === resolution);
	if (!entry || entry.width === 0) return null;
	return { width: entry.width, height: entry.height };
};

export type CaptureState = {
	imageFormat: CaptureImageFormat;
	/** Encoder quality for the lossy formats, 0..1. Ignored for png. */
	imageQuality: number;
	/** Output size for stills AND video. A preset re-renders at that size; see above. */
	resolution: CaptureResolution;
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
	setResolution(resolution: CaptureResolution): void;
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
