export const extensionScope = 'capture';

/** Encodings `HTMLCanvasElement.toBlob` accepts across the browsers this app targets. */
export type CaptureImageFormat = 'png' | 'jpeg' | 'webp';

/** Output container. Steers the WebCodecs codec probe (`encoder.ts`). */
export type CaptureContainer = 'webm' | 'mp4';

/**
 * Output sizes offered for both stills and video.
 *
 * Every entry is an EXACT pixel size the frame is genuinely re-rendered at
 * (`Capture.svelte` resizes the renderer for the duration of the capture) — a 4K take out
 * of a half-screen window is real 4K, not an upscale, and the output no longer depends on
 * the window or the display's DPR.
 *
 * There used to be a `viewport` entry meaning "whatever the canvas already is". It was
 * removed rather than deprecated: it is the one setting whose output nobody can predict
 * from the panel, and every other part of this extension had a branch for it.
 *
 * All widths and heights are even: H.264 and most hardware encoders reject odd dimensions.
 */
export const CAPTURE_RESOLUTIONS = [
	{ value: '720p', text: '720p · 1280×720', width: 1280, height: 720 },
	{ value: '1080p', text: '1080p · 1920×1080', width: 1920, height: 1080 },
	{ value: '1440p', text: '1440p · 2560×1440', width: 2560, height: 1440 },
	{ value: '2160p', text: '4K · 3840×2160', width: 3840, height: 2160 }
] as const;

export type CaptureResolution = (typeof CAPTURE_RESOLUTIONS)[number]['value'];

/** The pixel size of a preset. Falls back to 1080p rather than returning nothing. */
export const captureResolutionSize = (
	resolution: CaptureResolution
): { width: number; height: number } => {
	const entry =
		CAPTURE_RESOLUTIONS.find((option) => option.value === resolution) ?? CAPTURE_RESOLUTIONS[1];
	return { width: entry.width, height: entry.height };
};

export type CaptureState = {
	imageFormat: CaptureImageFormat;
	/** Encoder quality for the lossy formats, 0..1. Ignored for png. */
	imageQuality: number;
	/** Output size for stills AND video. The frame is re-rendered at that size; see above. */
	resolution: CaptureResolution;
	container: CaptureContainer;
	/**
	 * Output framerate. Also the take's fixed clock step: a recording owns the engine clock
	 * and advances scene time by exactly `1 / fps` per encoded frame, however long the frame
	 * took to draw.
	 */
	fps: number;
	/** Target bitrate, megabits/s. */
	bitrateMbps: number;
	/** Hard cap in seconds — a recording auto-stops here so a forgotten one cannot pin the loop forever. */
	maxDurationSec: number;

	// --- driver-written, read-only from the panel's point of view ---
	isRecording: boolean;
	/**
	 * The take has stopped but the file is not ready yet — the encode queue still has to
	 * drain, mux and build the Blob, none of which is instant at 4K. Without it the UI
	 * claims "done" and the download prompt arrives seconds later. Panels gate their
	 * controls on `isRecording || isFinalizing`.
	 */
	isFinalizing: boolean;
	/**
	 * Whole seconds of OUTPUT recorded so far; only written when it changes. This is
	 * ENCODED SCENE TIME, not time spent waiting for it — a 10s video may take a minute.
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
 * renderer, the task and the encoder) and registered into the state module, so the
 * Studio panel can drive it without being a Canvas child. Same register/unregister shape
 * as `scenes/DemoScene/mirrorFloor.ts`.
 */
export type CaptureDriver = {
	screenshot(): void;
	startRecording(): void;
	stopRecording(): void;
};
