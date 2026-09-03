export const extensionScope = 'capture';

/** Encodings `HTMLCanvasElement.toBlob` accepts across the browsers this app targets. */
export type CaptureImageFormat = 'png' | 'jpeg' | 'webp';

export type CaptureState = {
	imageFormat: CaptureImageFormat;
	/** Encoder quality for the lossy formats, 0..1. Ignored for png. */
	imageQuality: number;
	/** Output framerate of a recording. The render loop may run faster; frames are throttled to this. */
	fps: number;
	/** MediaRecorder target bitrate, megabits/s. */
	bitrateMbps: number;
	/** Hard cap in seconds — a recording auto-stops here so a forgotten one cannot pin the loop forever. */
	maxDurationSec: number;

	// --- driver-written, read-only from the panel's point of view ---
	isRecording: boolean;
	/** Whole seconds elapsed in the current recording; only written when it changes. */
	elapsedSec: number;
	/** Last outcome or error, shown in the panel. */
	status: string;
};

export type CaptureActions = {
	setImageFormat(format: CaptureImageFormat): void;
	setImageQuality(quality: number): void;
	setFps(fps: number): void;
	setBitrateMbps(bitrate: number): void;
	setMaxDurationSec(seconds: number): void;
	/** Arms a screenshot; the frame is grabbed on the next rendered frame. */
	screenshot(): void;
	toggleRecording(): void;
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
