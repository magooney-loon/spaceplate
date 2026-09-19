// Replays a recorded take into an AudioBuffer. The video track is `frameCount / fps`
// scene seconds and this buffer is rendered for exactly the same span, so the two can't
// drift however slowly the take rendered.
//
// The graph rebuilt here mirrors three's own:
//
//   BufferSource -> [lowpass] -> [panner] -> voice gain -> bus gain -> ... -> destination

import { logSound } from '$extensions/logger';
import type { Curve, RecordedTake, RecordedVoice } from './timeline';

/** Stereo: the buses are stereo and the panner downmixes to it. */
const CHANNELS = 2;

/**
 * Write a sampled curve onto an AudioParam, clipped to the take window. Linear segments
 * between samples track the live graph's `setTargetAtTime` smoothing closely enough,
 * since samples arrive about a frame apart.
 */
const applyCurve = (
	param: AudioParam,
	curve: Curve,
	t0: number,
	duration: number,
	fallback: number
): void => {
	if (curve.v.length === 0) {
		param.setValueAtTime(fallback, 0);
		return;
	}

	// Everything before the window collapses to the value in force when it opened.
	let start = 0;
	while (start + 1 < curve.t.length && curve.t[start + 1] - t0 <= 0) start++;
	param.setValueAtTime(curve.v[start], 0);

	for (let i = start + 1; i < curve.t.length; i++) {
		const at = curve.t[i] - t0;
		if (at <= 0) continue;
		if (at > duration) break;
		param.linearRampToValueAtTime(curve.v[i], at);
	}
};

/** The value a curve held at a given scene time — for params that cannot be automated. */
const curveAt = (curve: Curve, t: number, fallback: number): number => {
	if (curve.v.length === 0) return fallback;
	let value = curve.v[0];
	for (let i = 0; i < curve.t.length && curve.t[i] <= t; i++) value = curve.v[i];
	return value;
};

/**
 * Point the offline listener at the recorded camera path. Where a browser lacks the
 * AudioListener AudioParams, the listener is pinned to its pose at the start of the
 * take instead (there is no clock to call the legacy setters against offline).
 */
const applyListener = (
	context: OfflineAudioContext,
	take: RecordedTake,
	t0: number,
	duration: number
): void => {
	const l = context.listener;
	const c = take.listener;

	if (l.positionX && l.forwardX && l.upX) {
		applyCurve(l.positionX, c.x, t0, duration, 0);
		applyCurve(l.positionY, c.y, t0, duration, 0);
		applyCurve(l.positionZ, c.z, t0, duration, 0);
		applyCurve(l.forwardX, c.fx, t0, duration, 0);
		applyCurve(l.forwardY, c.fy, t0, duration, 0);
		applyCurve(l.forwardZ, c.fz, t0, duration, -1);
		applyCurve(l.upX, c.ux, t0, duration, 0);
		applyCurve(l.upY, c.uy, t0, duration, 1);
		applyCurve(l.upZ, c.uz, t0, duration, 0);
		return;
	}

	logSound.warn(
		'Audio render: this browser has no AudioListener AudioParams — the take is rendered ' +
			'with the listener pinned to its pose at the start (see core/audio/render.ts)'
	);
	const legacy = l as unknown as {
		setPosition?: (x: number, y: number, z: number) => void;
		setOrientation?: (
			fx: number,
			fy: number,
			fz: number,
			ux: number,
			uy: number,
			uz: number
		) => void;
	};
	legacy.setPosition?.(curveAt(c.x, t0, 0), curveAt(c.y, t0, 0), curveAt(c.z, t0, 0));
	legacy.setOrientation?.(
		curveAt(c.fx, t0, 0),
		curveAt(c.fy, t0, 0),
		curveAt(c.fz, t0, -1),
		curveAt(c.ux, t0, 0),
		curveAt(c.uy, t0, 1),
		curveAt(c.uz, t0, 0)
	);
};

const buildVoice = (
	context: OfflineAudioContext,
	voice: RecordedVoice,
	busInput: AudioNode,
	t0: number,
	duration: number
): void => {
	// Clip to the take window. A bed already looping when the take armed is stamped
	// before `t0`, so the part already heard becomes a seek rather than audio.
	const startAt = Math.max(0, voice.startScene - t0);
	const stopAt = voice.stopScene === null ? duration : Math.min(duration, voice.stopScene - t0);
	if (stopAt <= 0 || startAt >= duration) return;

	let seek = Math.max(0, t0 - voice.startScene);
	const length = voice.buffer.duration;
	if (voice.loop && length > 0) seek %= length;
	else if (seek >= length) return;

	const source = context.createBufferSource();
	source.buffer = voice.buffer;
	source.loop = voice.loop;
	source.detune.value = voice.detune;
	applyCurve(source.playbackRate, voice.rate, t0, duration, 1);

	const gain = context.createGain();
	applyCurve(gain.gain, voice.volume, t0, duration, 1);

	let head: AudioNode = source;
	if (voice.lowpass !== null) {
		const filter = context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = voice.lowpass;
		head.connect(filter);
		head = filter;
	}

	if (voice.positional && voice.pos) {
		const panner = context.createPanner();
		panner.panningModel = voice.positional.panningModel;
		panner.distanceModel = voice.positional.distanceModel;
		panner.refDistance = voice.positional.ref;
		panner.rolloffFactor = voice.positional.rolloff;
		panner.maxDistance = voice.positional.max;
		panner.coneInnerAngle = voice.positional.cone.inner;
		panner.coneOuterAngle = voice.positional.cone.outer;
		panner.coneOuterGain = voice.positional.cone.outerGain;
		applyCurve(panner.positionX, voice.pos.x, t0, duration, 0);
		applyCurve(panner.positionY, voice.pos.y, t0, duration, 0);
		applyCurve(panner.positionZ, voice.pos.z, t0, duration, 0);
		// Fallback is three's rest facing, local +Z.
		if (voice.orient) {
			applyCurve(panner.orientationX, voice.orient.x, t0, duration, 0);
			applyCurve(panner.orientationY, voice.orient.y, t0, duration, 0);
			applyCurve(panner.orientationZ, voice.orient.z, t0, duration, 1);
		}
		head.connect(panner);
		head = panner;
	}

	head.connect(gain);
	gain.connect(busInput);

	source.start(startAt, seek);
	source.stop(stopAt);
};

/**
 * Replay a recorded take. `duration` is the take's scene length — for a capture that is
 * `frameCount / fps`. `sampleRate` should be the live context's, so decoded buffers need
 * no resampling.
 */
export const renderTake = async (
	take: RecordedTake,
	duration: number,
	sampleRate: number
): Promise<AudioBuffer | null> => {
	if (duration <= 0) return null;

	const frames = Math.ceil(duration * sampleRate);
	const context = new OfflineAudioContext(CHANNELS, frames, sampleRate);
	const t0 = take.armedAt;

	// Nodes created first, wired after — parent-before-child isn't guaranteed by order.
	const inputs = new Map<string, GainNode>();
	for (const bus of take.buses) {
		const node = context.createGain();
		applyCurve(node.gain, bus.gain, t0, duration, 1);
		inputs.set(bus.id, node);
	}
	for (const bus of take.buses) {
		const node = inputs.get(bus.id);
		if (!node) continue;
		const parent = bus.parent ? inputs.get(bus.parent) : null;
		node.connect(parent ?? context.destination);
	}

	applyListener(context, take, t0, duration);

	for (const voice of take.voices) {
		const bus = inputs.get(voice.bus) ?? inputs.get('master');
		if (!bus) continue;
		buildVoice(context, voice, bus, t0, duration);
	}

	return context.startRendering();
};
