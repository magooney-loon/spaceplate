// Car engine audio — TestGame's own, deliberately NOT the engine's audio system
// (core/audio + extensions/sound): that path routes every sound through GlobalAudio
// and soundTriggers, which is built for UI one-shots and weather beds, not for a
// scene-local engine that must follow the car's POSE (positional) and the
// drivetrain's STATE (per-frame pitch). Same call as carInput.svelte.ts vs the
// shared keymapper: scene-owned until the audio layer grows per-scene needs.
//
// THE CONTRACT (weatherAudio.ts is the precedent): CarEngineAudio.svelte mounts the
// <PositionalAudio> objects inside the car, hands them over via the attach
// functions below, and its task calls `tickCarAudio(delta)` — never an `$effect`
// (carSim is plain state; an effect would run once at mount and never again).
//
// WHY NO WEBGPU COMPUTE (the three.js webgpu_compute_audio example): that example
// processes a WHOLE buffer offline — compute → getArrayBufferAsync → play the
// result once. An engine note must follow rpm every frame, and per-frame GPU
// readback means a streaming scheduler whose only product is latency: three's
// Audio already pitch-shifts live via `setPlaybackRate` (setTargetAtTime-smoothed
// resampling — the same math the example's `element(index × pitch)` shader does),
// on the audio thread, with zero round-trips. If a compute-processed layer is ever
// wanted anyway, <PositionalAudio>'s src accepts a raw AudioBuffer — one such
// buffer can be dropped in at the mount site without touching this module's shape.

import type { PositionalAudio as ThreePositionalAudio } from 'three';
import { settingsState } from '$extensions/settings';
import { sceneState } from '$extensions/scene';
import { GR86 } from './gr86';
import { clamp, damp } from './carMath';
import { carSim } from './carTelemetry.svelte';

/**
 * The six loop files, lowest first: the parked tickover, then the rising rpm bed.
 * Order matters — indices line up 1:1 with `LAYER_RPM` below.
 */
export const LAYER_FILES = [
	'idle.wav',
	'rpm1.wav',
	'rpm2.wav',
	'rpm3.wav',
	'rpm4.wav',
	'rpm5.wav'
] as const;

/**
 * The rpm each layer's recording sits at — the pitch-tracking anchors. The two
 * layers bracketing the current rpm crossfade, each playing at rate = rpm/anchor,
 * so pitch rises CONTINUOUSLY with the tacho instead of stepping at band edges.
 * These are guesses at the wavs — dial them BY EAR: a wrong anchor is a layer
 * that speaks in the wrong octave while it holds the crossfade.
 */
const LAYER_RPM = [850, 1800, 3000, 4300, 5600, 6900];

/** Safety clamps for the derived rates (idle dips and limiter overshoots). */
const RATE_MIN = 0.7;
const RATE_MAX = 1.5;

// ── The bed's loudness ────────────────────────────────────────────────────────
//
// Off-throttle the engine mutters; on-throttle it shouts, and LIFT-OFF is the
// bed alone — no one-shot sample on top. A recorded "release" carries its own
// pitch envelope, which speaks twice over a bed that is already tracking rpm
// down; instead the throttle term is smoothed asymmetrically (fast in, quicker
// out) so a lift READS: the level drops away in ~250 ms under a pitch that
// follows the engine-braking rpm decay, which is what a real lift sounds like.

/** 1/s — throttle hardens the note in ~100 ms. */
const LOAD_ATTACK = 10;
/** 1/s — and empties it in ~250 ms on lift. */
const LOAD_RELEASE = 4;
/** Off-throttle bed level — the overrun burble. */
const BED_QUIET = 0.22;
/** Added at full throttle. */
const BED_LOAD = 0.63;
/** Below this weight a layer is silent — pause it rather than hiss at ~0. */
const AUDIBLE_WEIGHT = 0.004;

/** The mounted loops, index-aligned with LAYER_FILES/LAYER_RPM. Set by the component. */
const layers: (ThreePositionalAudio | undefined)[] = new Array(LAYER_FILES.length).fill(undefined);

/** Smoothed 0..1 throttle load — the bed's loudness term. */
let load = 0;

export const attachEngineLayer = (index: number, audio: ThreePositionalAudio): void => {
	layers[index] = audio;
};

/** Drop every held instance — CarEngineAudio's teardown, so the module never
 * points at dead objects (the scene is keep-alive; this runs on real unmount). */
export const detachCarAudio = (): void => {
	layers.fill(undefined);
};

/**
 * Park the engine: loops paused (progress kept — re-entry resumes mid-cycle, no
 * seam), state zeroed. Called on scene exit and on tab hide — rAF stops but the
 * AudioContext doesn't, and an engine droning at its last pitch behind a hidden
 * tab is a bug.
 */
export const parkCarAudio = (): void => {
	load = 0;
	for (const audio of layers) {
		if (audio?.isPlaying) audio.pause();
	}
};

export const tickCarAudio = (delta: number): void => {
	// Keep-alive: this component stays mounted while other scenes are current —
	// the engine must not sound from another scene's frames. parkCarAudio (the
	// component's scene-exit cleanup) has already paused everything by the time
	// this gate starts returning.
	if (sceneState.currentScene !== 'testGame') return;

	const master = settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0;
	const audible = master > 0;

	// Throttle load, one-pole both ways — fast in, quicker out (weatherAudio's
	// framerate-independent damp, from the shared carMath).
	const throttle = carSim.throttle;
	load += (throttle - load) * damp(throttle > load ? LOAD_ATTACK : LOAD_RELEASE, delta);
	const level = BED_QUIET + BED_LOAD * load;

	// Which band the rpm sits in. Clamped at the drivetrain's own floors/ceilings,
	// so the outer layers just play slightly slow/fast beyond their anchors.
	const rpm = clamp(carSim.rpm, GR86.idleRpm, GR86.limiterRpm);
	let band = 0;
	while (band < LAYER_RPM.length - 2 && rpm > LAYER_RPM[band + 1]) band++;
	const span = LAYER_RPM[band + 1] - LAYER_RPM[band];
	const f = clamp((rpm - LAYER_RPM[band]) / span, 0, 1);
	// Smoothstep crossfade — equal-power-ish, so the band centre doesn't dip.
	const s = f * f * (3 - 2 * f);

	for (let j = 0; j < layers.length; j++) {
		const audio = layers[j];
		// The buffer guard is real: `src` fetches asynchronously, so there are
		// frames where the PositionalAudio exists with no buffer — play() then
		// starts a silent source that refuses the real one (weatherAudio).
		if (!audio?.buffer) continue;
		const weight = j === band ? 1 - s : j === band + 1 ? s : 0;
		if (weight > AUDIBLE_WEIGHT && audible) {
			// Volume and rate first, then play — otherwise a layer entering the
			// crossfade gets a buffer's worth at whatever level was left over.
			audio.setVolume(weight * level * master);
			audio.setPlaybackRate(clamp(rpm / LAYER_RPM[j], RATE_MIN, RATE_MAX));
			if (!audio.isPlaying) audio.play();
		} else if (audio.isPlaying) {
			audio.pause();
		}
	}
};
