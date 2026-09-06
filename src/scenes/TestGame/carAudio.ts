// Car engine audio — TestGame's own, deliberately NOT the engine's audio system
// (core/audio + extensions/sound): that path routes every sound through GlobalAudio
// and soundTriggers, which is built for UI one-shots and weather beds, not for a
// scene-local engine that must follow the car's POSE (positional) and the
// drivetrain's STATE (per-frame pitch). Same call as carInput.svelte.ts vs the
// shared keymapper: scene-owned until the audio layer grows per-scene needs.
//
// THE CONTRACT (weatherAudio.ts is the precedent): CarEngineAudio.svelte mounts the
// six <PositionalAudio> loops and the two pop one-shots inside the car, hands them
// over via the attach functions below, and its task calls `tickCarAudio(delta)` —
// never an `$effect` (carSim is plain state; an effect would run once at mount
// and never again).
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

// ── The bed's loudness ──────────────────────────────────────────────────────
//
// Driven by the TACHO, never the pedals — the engine answers rpm and gears,
// not input. A throttle term was here first and read as an echo of the key:
// lift or downshift and the bed ducked to a mutter (0.22) in ~250 ms, which
// just sounded like the car vanishing. Instead the level rises gently with
// rpm: a downshift blip leans in, engine braking on a lift eases the level
// down at exactly the rate the tacho falls, and the pedals change nothing.

/** Bed level at idle rpm. */
const BED_IDLE = 0.45;
/** Bed level at the limiter. */
const BED_REDLINE = 0.8;
/** 1/s — level slew, so a shift's rpm jump can't click the gain. */
const LEVEL_SLEW = 8;
/** Below this weight a layer is silent — pause it rather than hiss at ~0. */
const AUDIBLE_WEIGHT = 0.004;

/** The mounted loops, index-aligned with LAYER_FILES/LAYER_RPM. Set by the component. */
const layers: (ThreePositionalAudio | undefined)[] = new Array(LAYER_FILES.length).fill(undefined);

/** Smoothed bed level — eases toward the rpm-implied loudness. */
let bedLevel = BED_IDLE;

export const attachEngineLayer = (index: number, audio: ThreePositionalAudio): void => {
	layers[index] = audio;
};

// ── Exhaust pops ─────────────────────────────────────────────────────────────
//
// CarExhaustFlames rolls the VISUAL pop (style, per-tip shares, double-bangs);
// this module voices it. Two takes: exhaustpop1 (mild) and exhaustpop2
// (aggressive) — take choice follows the pop's energy through a FUZZY crossover
// (never a hard threshold), and every hit is jittered in volume, rate and filter
// cutoff so no two bangs sound alike (the thunder-clap contract, weatherAudio).
// Polyphonic via clones parented at the pipe that fired: a double-bang overlaps
// instead of restarting, and the sound comes from the dominant tip. The wavs
// are PEAK-NORMALIZED to -3 dBFS offline (+6.03/+8.05 dB, pure gain, RMS now
// matched at ~-22) — a bang is a transient: it must SLAM past the bed's
// continuous RMS (-8.4 raw, ~-14 effective) or it simply doesn't exist — and
// POP_GAIN adds the last stretch on top.

/** Overall pop gain relative to the bed. 6.75 ≈ 5× the 1.35 that read as
 * silent — the files peak at -3 dBFS, so hits above ~1 clip the mixer; that is
 * the point (a bang that clips reads as a SLAM), but dial back toward ~3 if it
 * turns to crunch. */
const POP_GAIN = 14;
/** Per-take trim — the takes are loudness-matched at the file level now, so no
 * trim; kept as a knob in case one take should still read hotter. */
const POP_TAKE_GAIN = [1.0, 1.0];
/** The two mounted one-shot takes. Set by the component. */
const popTakes: (ThreePositionalAudio | undefined)[] = new Array(2).fill(undefined);
/** Live pop clones — pruned in the tick once spent. Rarely over 2–3. */
const livePops: ThreePositionalAudio[] = [];

export const attachPopAudio = (take: number, audio: ThreePositionalAudio): void => {
	popTakes[take] = audio;
};

/**
 * Voice one pop. `energy` 0..1 sizes it (downshift bursts big, limiter stutters
 * small), `right` picks the pipe it speaks from (the visual pop's dominant tip).
 * Called from CarExhaustFlames' physics task — already scene-gated there.
 */
export const triggerExhaustPop = (energy: number, right: boolean): void => {
	const master = settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0;
	if (master <= 0) return;
	// Fuzzy crossover: mild below, aggressive above, a coin-flip zone between —
	// never the same take for the same pop twice in a row.
	const aggressive = energy > 0.55 + 0.25 * Math.random();
	const take = aggressive ? 1 : 0;
	const src = popTakes[take];
	if (!src?.buffer || !src.parent) return;

	const pop = src.clone() as ThreePositionalAudio;
	// Same model-metre space the flames' TIP_L/TIP_R live in (the group is at the
	// car's origin, inside the ×2.5 visual group).
	pop.position.set((right ? 1 : -1) * 0.446, 0.293, 2.05);
	pop.userData.hideInTree = true;
	pop.userData.selectable = false;
	src.parent.add(pop);

	pop.setVolume(
		POP_GAIN * POP_TAKE_GAIN[take] * (0.55 + 0.45 * energy) * (0.85 + 0.3 * Math.random()) * master
	);
	pop.setPlaybackRate(0.88 + 0.24 * Math.random());
	// Filter jitter — a fresh BiquadFilterNode per clone (clone() shares the
	// template's filter array by reference; weatherAudio's modulateClap note).
	// Floor 1.8 kHz: the jitter must vary BRIGHTNESS, never muffle the crack.
	const filter = pop.context.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 1800 * 2 ** (Math.random() * 3);
	pop.setFilters([filter]);
	pop.play();
	livePops.push(pop);
};

/** Drop every held instance — CarEngineAudio's teardown, so the module never
 * points at dead objects (the scene is keep-alive; this runs on real unmount). */
export const detachCarAudio = (): void => {
	layers.fill(undefined);
	popTakes.fill(undefined);
	livePops.length = 0;
};

/**
 * Park the engine: loops paused (progress kept — re-entry resumes mid-cycle, no
 * seam), state zeroed. Called on scene exit and on tab hide — rAF stops but the
 * AudioContext doesn't, and an engine droning at its last pitch behind a hidden
 * tab is a bug.
 */
export const parkCarAudio = (): void => {
	bedLevel = BED_IDLE;
	for (const audio of layers) {
		if (audio?.isPlaying) audio.pause();
	}
	// A bang must not outlive its scene — clones are raw graph children, nothing
	// else would stop them (the mounted takes unmount with the component).
	for (const pop of livePops) {
		pop.stop();
		pop.parent?.remove(pop);
	}
	livePops.length = 0;
};

export const tickCarAudio = (delta: number): void => {
	// Keep-alive: this component stays mounted while other scenes are current —
	// the engine must not sound from another scene's frames. parkCarAudio (the
	// component's scene-exit cleanup) has already paused everything by the time
	// this gate starts returning.
	if (sceneState.currentScene !== 'testGame') return;

	const master = settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0;
	const audible = master > 0;

	// Level from the TACHO: idle → limiter maps BED_IDLE → BED_REDLINE, one-pole
	// so a shift's rpm jump can't click the gain. No input anywhere in this term.
	const rpm = clamp(carSim.rpm, GR86.idleRpm, GR86.limiterRpm);
	const rpmFrac = (rpm - GR86.idleRpm) / (GR86.limiterRpm - GR86.idleRpm);
	bedLevel += (BED_IDLE + (BED_REDLINE - BED_IDLE) * rpmFrac - bedLevel) * damp(LEVEL_SLEW, delta);
	const level = bedLevel;

	// Which band the rpm sits in. Clamped at the drivetrain's own floors/ceilings,
	// so the outer layers just play slightly slow/fast beyond their anchors.
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

	// Reap spent pop clones — they are raw graph children (not components), so
	// this is the only cleanup path. A pop lives <1 s; the list stays tiny.
	for (let i = livePops.length - 1; i >= 0; i--) {
		const pop = livePops[i];
		if (!pop.isPlaying) {
			pop.parent?.remove(pop);
			livePops.splice(i, 1);
		}
	}
};
