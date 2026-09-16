// THE TAKE RECORDER — what the audio layer was TOLD, stamped in scene seconds.
//
// Pure storage: it plays nothing, reads nothing back and imports nothing from voices.ts
// (which imports this — the dependency runs one way only). `voices.ts` owns the driving,
// because it owns the live voice set; `render.ts` turns what lands here into an
// AudioBuffer.
//
// WHY THIS EXISTS: a capture take's video is `frameIndex / fps` SCENE seconds however
// long each frame took to draw, while the live AudioContext runs on the wall clock. Any
// recording tapped off the live graph therefore drifts by exactly how far the renderer
// fell behind (core/audio/scheduler.ts, `schedulerDrift()`). Replaying scene-time stamps
// into an OfflineAudioContext instead makes the audio exactly as long as the video, by
// construction, at any render speed.
//
// TWO KINDS OF RECORD:
//   - EVENTS are discrete and rare — a voice started, a voice stopped.
//   - AUTOMATION is continuous: volume, rate and world position sampled once per frame.
//     EPSILON-GATED, so a steady bed costs nothing and only a value that actually moved
//     writes a breakpoint.

import type { BusId } from './types';

/** A sampled parameter: breakpoint times (scene seconds) against values. */
export type Curve = { t: number[]; v: number[] };

export type PositionalParams = {
	ref: number;
	rolloff: number;
	max: number;
	panningModel: PanningModelType;
	distanceModel: DistanceModelType;
};

export type RecordedVoice = {
	readonly id: number;
	readonly soundId: string;
	readonly bus: BusId;
	/** The decoded variant this voice drew. Reused as-is by the replay — buffers are not context-bound. */
	readonly buffer: AudioBuffer;
	/**
	 * Scene time the voice's BUFFER begins, which may sit before the take armed — a bed
	 * already looping is stamped at `now − cursor`. `render.ts` clips against the take
	 * window and seeks into the buffer by the difference, so there is no separate offset
	 * field to keep in step with this one.
	 */
	startScene: number;
	stopScene: number | null;
	readonly loop: boolean;
	readonly detune: number;
	readonly lowpass: number | null;
	readonly positional: PositionalParams | null;
	volume: Curve;
	rate: Curve;
	/** Only for positional voices. */
	pos: { x: Curve; y: Curve; z: Curve } | null;
};

export type RecordedTake = {
	/** Scene time the recording was armed. Every stamp below is absolute, not relative. */
	armedAt: number;
	voices: RecordedVoice[];
	buses: { id: BusId; parent: BusId | null; gain: Curve }[];
	listener: {
		x: Curve;
		y: Curve;
		z: Curve;
		fx: Curve;
		fy: Curve;
		fz: Curve;
		ux: Curve;
		uy: Curve;
		uz: Curve;
	};
};

const VOLUME_EPS = 1e-3;
const RATE_EPS = 1e-3;
/** World units. The listener and sources move in the scene's units, not metres. */
const POSITION_EPS = 1e-2;

let recording = false;
let take: RecordedTake | null = null;
let nextId = 0;

export const isRecordingAudio = (): boolean => recording;

const emptyCurve = (): Curve => ({ t: [], v: [] });

const emptyListener = (): RecordedTake['listener'] => ({
	x: emptyCurve(),
	y: emptyCurve(),
	z: emptyCurve(),
	fx: emptyCurve(),
	fy: emptyCurve(),
	fz: emptyCurve(),
	ux: emptyCurve(),
	uy: emptyCurve(),
	uz: emptyCurve()
});

/**
 * Append a breakpoint if the value actually moved. The FIRST sample always lands, so a
 * curve is never empty for a parameter that was ever observed.
 */
export const sample = (curve: Curve, t: number, value: number, eps: number): void => {
	const n = curve.v.length;
	if (n > 0 && Math.abs(curve.v[n - 1] - value) < eps) return;
	curve.t.push(t);
	curve.v.push(value);
};

export const sampleVolume = (curve: Curve, t: number, v: number): void =>
	sample(curve, t, v, VOLUME_EPS);
export const sampleRate = (curve: Curve, t: number, v: number): void =>
	sample(curve, t, v, RATE_EPS);
export const samplePosition = (curve: Curve, t: number, v: number): void =>
	sample(curve, t, v, POSITION_EPS);

export const armTimeline = (sceneTime: number): void => {
	take = { armedAt: sceneTime, voices: [], buses: [], listener: emptyListener() };
	nextId = 0;
	recording = true;
};

/** Stop recording and hand back what was captured. Null if nothing was armed. */
export const disarmTimeline = (): RecordedTake | null => {
	recording = false;
	const result = take;
	take = null;
	return result;
};

/** Register the bus graph's shape once, at arm time. Gains are sampled per frame after. */
export const noteBus = (id: BusId, parent: BusId | null): Curve | null => {
	if (!take) return null;
	const curve = emptyCurve();
	take.buses.push({ id, parent, gain: curve });
	return curve;
};

export const listenerCurves = (): RecordedTake['listener'] | null => take?.listener ?? null;

type StartInfo = Omit<RecordedVoice, 'id' | 'volume' | 'rate' | 'pos' | 'stopScene'>;

/** A voice began (or was already playing when the take armed). Returns its record. */
export const noteStart = (info: StartInfo): RecordedVoice | null => {
	if (!take) return null;
	const voice: RecordedVoice = {
		...info,
		id: nextId++,
		stopScene: null,
		volume: emptyCurve(),
		rate: emptyCurve(),
		pos: info.positional ? { x: emptyCurve(), y: emptyCurve(), z: emptyCurve() } : null
	};
	take.voices.push(voice);
	return voice;
};

export const noteStop = (voice: RecordedVoice | null, sceneTime: number): void => {
	if (voice && voice.stopScene === null) voice.stopScene = sceneTime;
};
