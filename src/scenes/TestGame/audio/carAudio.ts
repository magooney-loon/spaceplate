// Car engine audio — TestGame's own, deliberately NOT the engine's audio system
// (core/audio + extensions/sound): that path routes every sound through GlobalAudio
// and soundTriggers, which is built for UI one-shots and weather beds, not for a
// scene-local engine that must follow the car's POSE (positional) and the
// drivetrain's STATE (per-frame pitch). Same call as carSwitches.svelte.ts vs the
// shared keymapper: scene-owned until the audio layer grows per-scene needs.
//
// THE CONTRACT (weatherAudio.ts is the precedent): CarEngineAudio.svelte mounts the
// six <PositionalAudio> loops, the tyre-squeal loop and the pop/nitrous one-shots
// inside the car, hands
// them over via the attach functions below, and its task calls `tickCarAudio(delta)` —
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
import { currentCar } from '../cars';
import { clamp, damp } from '../sim/carMath';
import { carSim } from '../sim/carTelemetry.svelte';
import { carIgnition } from '../sim/carSwitches.svelte';
import { HULL_HIT_FULL_DV } from '../sim/hullContacts';
import { UNITS_PER_METER } from '../units';

/**
 * The six loop files, lowest first: the parked tickover, then the rising rpm bed.
 * Order matters — indices line up 1:1 with `LAYER_RPM` below.
 */
export const LAYER_FILES = [
	'idle.opus',
	'rpm1.opus',
	'rpm2.opus',
	'rpm3.opus',
	'rpm4.opus',
	'rpm5.opus'
] as const;

/**
 * The rpm each layer's recording sits at on THIS car's tacho — the
 * pitch-tracking anchors (per-car: the spec's `audio.layerRpm`). The two
 * layers bracketing the current rpm crossfade, each playing at
 * rate = rpm/anchor × pitchScale, so pitch rises CONTINUOUSLY with the tacho
 * instead of stepping at band edges. The anchors are guesses at the wavs —
 * dial them BY EAR: a wrong anchor is a layer that speaks in the wrong octave
 * while it holds the crossfade.
 */
const LAYER_RPM = currentCar().audio.layerRpm;
/** Per-car voice: scales every layer's rate, shifting the shared bed. */
const PITCH_SCALE = currentCar().audio.pitchScale;
/** This car's rpm bounds — read once; the car is constant for a session. */
const HW = currentCar().hardware;

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

// ── Nitrous ─────────────────────────────────────────────────────────────────
//
// Three voices: `nitrosstart` on ENGAGE, its REVERSE (`nitrosend`, made with
// ffmpeg areverse — buffer sources can't play backwards) on RELEASE, and the
// `nitrosdrain` loop while the bottle empties, volume following the FLOW
// (carSim.nitrous — the same smoothed 0..1 the flames/camera/HUD read). Edges
// are read off that flow: engage = crossing up through ~0.02, release = the
// first frame the flow clearly FALLS from on (a drop >3%/frame only happens
// when the pedal lifts or the bottle runs dry — both are releases). The files
// peak near 0 dBFS as delivered, so these gains are pure mixes.
// The PURGE (carSim.nitrousPurge) shares the drain loop, blended UNDER the
// spray — a quieter hiss of the same character from the same engine-bay mount
// the line and solenoids live under — so the standstill vent needs no fourth
// voice, and the engage/release one-shots ride the combined edges for free.

/** Drain-loop level at full flow — a hiss under the engine, not over it. */
const NITRO_GAIN = 0.5;
/** Engage/release one-shot level. */
const NITRO_SHOT_GAIN = 0.9;
/** Flow above this = system on (the ~0.13 s attack crosses it in a frame or two). */
const NITRO_ON_FLOW = 0.02;
/** Purge blend into the drain voice — the vent is a smaller hole than the
 *  nozzle: the same hiss at less than half the spray's presence. */
const NITRO_PURGE_MIX = 0.45;

/** The mounted nitrous voices. Set by the component. */
let nitroDrain: ThreePositionalAudio | undefined;
let nitroStart: ThreePositionalAudio | undefined;
let nitroEnd: ThreePositionalAudio | undefined;
/** Previous tick's flow + the release latch (fire once per spray). */
let nitroPrev = 0;
let nitroOn = false;
let nitroReleased = false;

export const attachNitroDrain = (audio: ThreePositionalAudio): void => {
	nitroDrain = audio;
};
export const attachNitroStart = (audio: ThreePositionalAudio): void => {
	nitroStart = audio;
};
export const attachNitroEnd = (audio: ThreePositionalAudio): void => {
	nitroEnd = audio;
};

/** One-shot semantics (clickAudio pattern): a re-fire mid-play cuts and
 * restarts — that read is correct, the system just went again. */
const playOneShot = (
	audio: ThreePositionalAudio | undefined,
	gain: number,
	master: number
): void => {
	if (!audio?.buffer) return;
	if (audio.isPlaying) audio.stop();
	audio.setVolume(gain * master);
	audio.play();
};

// ── Ignition ─────────────────────────────────────────────────────────────────
//
// The `ignition` slot toggles it (carSwitches.svelte.ts latches it). The bed, pops
// and nitrous all gate
// on `carIgnition.ready` — no combustion, no noise — and the one-shots voice
// the transitions. M starts a realistic startup: the turnon sound cranks, the
// physics task ramps RPM to ~2k then settles, and the idle bed fades in under
// the crank recording's tail (last STARTUP_BLEND seconds), so the two blend
// instead of hard-cutting when `ready` flips on the sound's end. N cuts instantly: bed silences
// under the turnoff shot, `ready` clears, the car coasts to a stop.

/** Turn-on/off one-shot level. Files peak near 0 dBFS as delivered. */
const IGNITION_GAIN = 0.9;

let turnOnSound: ThreePositionalAudio | undefined;
let turnOffSound: ThreePositionalAudio | undefined;
/** Previous tick's ignition — edge detect for the one-shots. */
let ignPrev = carIgnition.on;
/** AudioContext time the crank recording started — drives the bed's
 * fade-in under the recording's tail (see tick). */
let turnOnStart = 0;
/** Seconds of the bed fading in under the crank tail before `ready` flips. */
const STARTUP_BLEND = 0.9;

export const attachTurnOnSound = (audio: ThreePositionalAudio): void => {
	turnOnSound = audio;
	// When the crank recording ends, the startup sequence is done — the bed
	// can fade in and the player can drive. Wired here (not in tick) because
	// this runs once at mount, and the callback must not stack.
	audio.onEnded = () => {
		carIgnition.ready = true;
	};
};
export const attachTurnOffSound = (audio: ThreePositionalAudio): void => {
	turnOffSound = audio;
};

// ── Gear shift ───────────────────────────────────────────────────────────────
//
// One bark per engagement. The drivetrain flags `state.shifted` for the single
// STEP a gear change starts, and the physics substeps several times per tick,
// so the controller folds it into `carSim.shiftSeq` (hullHitSeq's contract) and
// this tick edge-detects the seq — same shape as the scrape hit below. Every
// path that slots a gear runs through engage(), so Q/E taps, the automatic's
// own shifts and its stopped drop-to-1st all land here. No ignition gate of
// its own: the controller gates shifting on ignition already, so a seq tick
// implies the key was on.

/** Shift bark level — the mechanical clunk sits under the ignition shots;
 * dial by ear against IGNITION_GAIN. */
const SHIFT_GAIN = 0.7;

/** The mounted one-shot. Set by the component. */
let shiftSound: ThreePositionalAudio | undefined;
/** The last shift this module has voiced — `shiftSeq`'s own edge state,
 * synced (not reset) on park/detach so re-entry can't voice a phantom. */
let shiftSeq = carSim.shiftSeq;

export const attachGearShift = (audio: ThreePositionalAudio): void => {
	shiftSound = audio;
};

// ── Handbrake ─────────────────────────────────────────────────────────────
//
// The ratchet pair: PULL on the key's rising edge, RELEASE on the falling —
// the ignition one-shots' own shape, but off `carSim.handbrake`, which the
// controller publishes every step (the tick reads the car, like everything
// else here). No seq counter like shifts: the handbrake is a HELD level, not
// a one-step event — a key changes state at most once per frame, so a boolean
// edge at tick rate can't miss one. Not gated on ignition — a cable is not
// combustive (the module's own rule), and the handbrake works with the engine
// off. The tyres it locks already have their own voice: the squeal's handbrake
// term.

/** Handbrake one-shot level — cabin mechanicals, under the bed like the
 * shift bark; dial by ear. */
const HANDBRAKE_GAIN = 0.7;

/** The mounted pair. Set by the component. */
let handbrakePull: ThreePositionalAudio | undefined;
let handbrakeRelease: ThreePositionalAudio | undefined;
/** Previous tick's handbrake — edge detect for the pair. */
let handbrakePrev = carSim.handbrake;

export const attachHandbrakePull = (audio: ThreePositionalAudio): void => {
	handbrakePull = audio;
};
export const attachHandbrakeRelease = (audio: ThreePositionalAudio): void => {
	handbrakeRelease = audio;
};

// ── Tyres ────────────────────────────────────────────────────────────────────
//
// The squeal loop: ONE voice under the car, not per-corner — RWD wheelspin is a
// rear-axle sound, a drift is the whole car, and per-corner voices would need
// per-wheel slip the sim doesn't publish. Level = the LOOSEST of six sources,
// never a sum (the looseness model's own rule, handling.ts: sources that stack
// make a gentle cornering slide scream):
//   - WHEELSPIN: carSim.slip past the TC lamp's own 0.15 — lamp and squeal agree
//     the rears are lit.
//   - SLIDE: |drift| ramped 8°→25° (the cluster's slide flag reads 10°; a few
//     degrees is just a car cornering), gated on road speed — slip angle at a
//     standstill is noise.
//   - HANDBRAKE: locked rears scaled by speed, so the yank is audible before the
//     slip angle has developed.
//   - CORNERING: carSim.latLoad — the share of the lateral grip budget the corner
//     is spending. Grip's planted max banking never lights a drift angle, wheels
//     the rears or touches the brake, but the tyres ARE at their limit — the load
//     is the only honest signal that corner gives, so it sings from ~75% of
//     budget and pins at full lock at speed.
//   - LAUNCH: carSim.launch — the rev-match boost live: full quality through
//     the clutch drop, easing off with the tail into 1st. The chirp off the
//     line, sized by how hard the catch was.
//   - HARD BRAKE: the pedal at speed — there is no ABS/lockup channel, so the
//     squeal is the drama the missing tyre slip would have supplied. Fades out
//     below ~20 km/h, so a stop doesn't end in a squeak at the line.
// NOT gated on ignition — tyres are not combustive (the module's own rule); a
// handbrake slide with the engine off still squeals. Attack outruns release:
// squeal arrives with the slide and lingers a beat while the rubber catches up.

/** Squeal level at full slip — under the bed's redline presence. Dial by ear. */
const SQUEAL_GAIN = 0.6;
/** 1/s — attack (with the slide) vs release (the rubber catching up). */
const SQUEAL_ATTACK = 12;
const SQUEAL_RELEASE = 4;
/** Wheelspin floor — the TC lamp's own number (CarCluster), so the two agree. */
const SQUEAL_SLIP_ON = 0.15;
/** Slip-angle floor/ceiling, rad — 8° is cornering, 25° is a held drift. */
const SQUEAL_DRIFT_ON = (8 * Math.PI) / 180;
const SQUEAL_DRIFT_FULL = (25 * Math.PI) / 180;
/** Cornering-load floor — the share of the lateral budget a tyre sings from. */
const SQUEAL_LAT_ON = 0.75;
/** Cornering squeal weight — deliberately a bit under a slide: the tyres are
 * holding ON the limit, not letting go of it. */
const SQUEAL_LAT = 0.65;
/** Hard-brake weight — under a full slide; the fronts working, not a lockup. */
const SQUEAL_BRAKE = 0.7;
/** m/s — brake squeal fades out below this, so a stop doesn't end in a squeak. */
const SQUEAL_BRAKE_SPEED = 6;
/** Launch-chirp weight — the rev-match drop, scaled by the launch's own
 * quality-and-remaining signal. */
const SQUEAL_LAUNCH = 0.6;

/** The mounted squeal loop. Set by the component. */
let tireSqueal: ThreePositionalAudio | undefined;
/** Smoothed squeal level — asymmetric slew. */
let squealLevel = 0;

export const attachTireSqueal = (audio: ThreePositionalAudio): void => {
	tireSqueal = audio;
};

// ── Chassis scrape ──────────────────────────────────────────────────────────
//
// The hull-contact half of what fx/CarImpacts.svelte draws, voiced: pressed
// and sliding = the metal_scraping LOOP (level rides the same grind the spark
// stream's rate does), and the ARRIVAL — `hullHitSeq`'s rising edge, the same
// one-shot CarImpacts bursts on — = a short loud SHRIEK cloned at the contact
// point and cut off on a DEADLINE, because the recording is a 3 s scrape and a
// hit is over in a fraction of one. NOT gated on ignition — metal on metal is
// not combustive (the tyres' own rule); a wall scrape with the engine off
// still screams. The take is mono 48 kHz Opus peak-held at -3 dBFS (the pops'
// own convention) — downmixed with an explicit `pan` BEFORE the gain, because
// a plain `-ac 1` after `-af volume` sums the already-boosted channels and
// clips — and trimmed where its trailing silence began, so the loop doesn't
// pump.

/** Scrape loop level at full grind — a shade over the squeal: bare metal on
 *  concrete is the harshest thing this car does. Dial by ear. */
const SCRAPE_GAIN = 0.9;
/** 1/s — attack with the contact, release as it lifts. Both quicker than the
 *  squeal's: a scrape is dry friction, in and out with no rubber to catch up. */
const SCRAPE_ATTACK = 18;
const SCRAPE_RELEASE = 8;
/** m/s slide floor/ceiling — CarImpacts' own SCRAPE_MIN_SPEED /
 *  SCRAPE_FULL_SPEED, duplicated because they live in the component; keep the
 *  two in step or the sparks and the sound disagree about what grinds. */
const SCRAPE_MIN = 1.4;
const SCRAPE_FULL = 22;
/** Hit-shriek gain — the take runs ~5 dB hotter RMS than the pops' files, so
 *  this is POP_GAIN scaled down to land proportionally under the bangs. */
const SCRAPE_HIT_GAIN = 4.5;
/** s — hit-shriek length, floor + severity-sized range: a glancing tap is a
 *  chirp, a big arrival grinds half a second. */
const SCRAPE_HIT_MIN = 0.22;
const SCRAPE_HIT_RANGE = 0.5;

/** The mounted scrape loop. Set by the component. */
let scrapeLoop: ThreePositionalAudio | undefined;
/** The hit-shriek TEMPLATE — never played itself; every hit is a clone at the
 *  contact point (the pops' own contract). */
let scrapeHit: ThreePositionalAudio | undefined;
/** Smoothed scrape level — asymmetric slew. */
let scrapeLevel = 0;
/** The last hit this module has voiced — `hullHitSeq`'s own edge state,
 *  synced (not reset) on park/detach so re-entry can't voice a phantom. */
let scrapeSeq = carSim.hullHitSeq;
/** Live hit clones — deadline-stopped and pruned in the tick, like the pops. */
const liveScraps: ThreePositionalAudio[] = [];

export const attachScrapeLoop = (audio: ThreePositionalAudio): void => {
	scrapeLoop = audio;
};

export const attachScrapeHit = (audio: ThreePositionalAudio): void => {
	scrapeHit = audio;
};

/** Voice one arrival: a clone of the scrape take AT the contact point (the
 *  hull-local reading is world-unit body space; the template's group lives in
 *  the visual model-metre group, so ÷UPM — the pops' TIP_L/R rule), pitched
 *  and lowpass-jittered so no two hits speak alike (the thunder-clap
 *  contract), stopped on a severity-sized deadline. */
function triggerScrapeHit(severity: number, master: number): void {
	if (master <= 0) return;
	const src = scrapeHit;
	if (!src?.buffer || !src.parent) return;
	const hit = src.clone() as ThreePositionalAudio;
	hit.position.set(
		carSim.hullLocalX / UNITS_PER_METER,
		carSim.hullLocalY / UNITS_PER_METER,
		carSim.hullLocalZ / UNITS_PER_METER
	);
	hit.userData.hideInTree = true;
	hit.userData.selectable = false;
	src.parent.add(hit);
	hit.setVolume(SCRAPE_HIT_GAIN * (0.55 + 0.45 * severity) * (0.85 + 0.3 * Math.random()) * master);
	// A hit is a SHARPER scrape than the loop's grind: base rate over 1, jitter
	// and severity on top — the same clamps the bed lives under.
	hit.setPlaybackRate(0.88 + 0.35 * severity + 0.3 * Math.random());
	// Brightness jitter, floored so it never muffles the shriek (the pops' rule).
	const filter = hit.context.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 2400 * 2 ** (Math.random() * 2.5);
	hit.setFilters([filter]);
	// The deadline — the buffer is a 3 s scrape, the hit is a fraction of one.
	hit.userData.deadline = hit.context.currentTime + SCRAPE_HIT_MIN + SCRAPE_HIT_RANGE * severity;
	hit.play();
	liveScraps.push(hit);
}

/**
 * Voice one pop. `energy` 0..1 sizes it (downshift bursts big, limiter stutters
 * small), `right` picks the pipe it speaks from (the visual pop's dominant tip).
 * Called from CarExhaustFlames' physics task.
 */
export const triggerExhaustPop = (energy: number, right: boolean): void => {
	const master = settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0;
	if (master <= 0) return;
	// No combustion, no bang — ignition off gates the pops too (the flames still
	// pop visually; gating them is a flames-side change for another day).
	if (!carIgnition.on) return;
	// Fuzzy crossover: mild below, aggressive above, a coin-flip zone between —
	// never the same take for the same pop twice in a row.
	const aggressive = energy > 0.55 + 0.25 * Math.random();
	const take = aggressive ? 1 : 0;
	const src = popTakes[take];
	if (!src?.buffer || !src.parent) return;

	const pop = src.clone() as ThreePositionalAudio;
	// Same model-metre space the flames' tips live in (the group is at the car's
	// origin, inside the visual scale group) — the tip comes from the car's spec,
	// the flames' own TIP_L/TIP_R twin.
	const [tipX, tipY, tipZ] = currentCar().geometry.exhaustTips[right ? 1 : 0];
	pop.position.set(tipX, tipY, tipZ);
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
 * points at dead objects (this runs on real unmount). */
export const detachCarAudio = (): void => {
	layers.fill(undefined);
	popTakes.fill(undefined);
	livePops.length = 0;
	nitroDrain = undefined;
	nitroStart = undefined;
	nitroEnd = undefined;
	nitroPrev = 0;
	nitroOn = false;
	nitroReleased = false;
	turnOnSound = undefined;
	turnOffSound = undefined;
	shiftSound = undefined;
	shiftSeq = carSim.shiftSeq;
	handbrakePull = undefined;
	handbrakeRelease = undefined;
	handbrakePrev = carSim.handbrake;
	tireSqueal = undefined;
	squealLevel = 0;
	scrapeLoop = undefined;
	scrapeHit = undefined;
	scrapeLevel = 0;
	scrapeSeq = carSim.hullHitSeq;
	liveScraps.length = 0;
	// Sync, not reset — ignition is a latched switch and must survive remounts;
	// syncing (not zeroing) is what stops a phantom turn-on shot at re-entry.
	ignPrev = carIgnition.on;
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
	// Nitrous too — the loop pauses (progress kept), the one-shots stop, and the
	// edge state resets so re-entry starts clean.
	nitroPrev = 0;
	nitroOn = false;
	nitroReleased = false;
	if (nitroDrain?.isPlaying) nitroDrain.pause();
	if (nitroStart?.isPlaying) nitroStart.stop();
	if (nitroEnd?.isPlaying) nitroEnd.stop();
	// Ignition one-shots stop too, and the edge state syncs (not resets — the
	// switch is latched, a phantom turn-on at re-entry would be a bug). Ready
	// syncs too — if ignition was off at exit, stay off; if on, the bed comes back.
	ignPrev = carIgnition.on;
	if (turnOnSound?.isPlaying) turnOnSound.stop();
	if (turnOffSound?.isPlaying) turnOffSound.stop();
	// The shift bark too — one-shots stop dead, and the edge state syncs (the
	// seq contract) so re-entry doesn't voice a shift that landed while parked.
	shiftSeq = carSim.shiftSeq;
	if (shiftSound?.isPlaying) shiftSound.stop();
	// The handbrake pair too — and its edge state syncs (ignPrev's own rule:
	// sync, don't reset, or re-entry voices a phantom release).
	handbrakePrev = carSim.handbrake;
	if (handbrakePull?.isPlaying) handbrakePull.stop();
	if (handbrakeRelease?.isPlaying) handbrakeRelease.stop();
	// Tyres too — the loop pauses (progress kept), the level resets so re-entry
	// doesn't fade in a squeal the car isn't making.
	squealLevel = 0;
	if (tireSqueal?.isPlaying) tireSqueal.pause();
	// The scrape too — same three moves: loop pauses (progress kept), shrieks
	// stop dead (a hit must not drone behind a hidden tab), and the edge state
	// SYNCS so re-entry doesn't voice a hit that landed while parked.
	scrapeLevel = 0;
	scrapeSeq = carSim.hullHitSeq;
	if (scrapeLoop?.isPlaying) scrapeLoop.pause();
	for (const scrap of liveScraps) {
		if (scrap.isPlaying) scrap.stop();
		scrap.parent?.remove(scrap);
	}
	liveScraps.length = 0;
};

export const tickCarAudio = (delta: number): void => {
	const master = settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0;
	// Ignition gates everything combustive — bed, pops, nitrous. The one-shots
	// below still play through this (they ARE the transitions), so they take
	// `master` directly, not `audible`. The bed fades in under the crank
	// recording's tail (startupBlend 0→1 over its last STARTUP_BLEND seconds)
	// instead of cutting in when the recording ends — ready still flips onEnded
	// and still gates driving, just not the bed's fade.
	const audible = master > 0 && carIgnition.ready;
	let startupBlend = carIgnition.ready ? 1 : 0;
	if (carIgnition.on && !carIgnition.ready && turnOnSound?.buffer && turnOnSound.isPlaying) {
		const elapsed = turnOnSound.context.currentTime - turnOnStart;
		const remaining = turnOnSound.buffer.duration - elapsed;
		startupBlend = clamp(1 - remaining / STARTUP_BLEND, 0, 1);
	}
	const bedAudible = audible || startupBlend > 0;

	// ── Ignition edges: voice the transitions, bed handles the rest. ──────────
	if (carIgnition.on !== ignPrev) {
		ignPrev = carIgnition.on;
		playOneShot(carIgnition.on ? turnOnSound : turnOffSound, IGNITION_GAIN, master);
		if (carIgnition.on) {
			turnOnStart = turnOnSound?.context.currentTime ?? 0;
		}
		if (!carIgnition.on) {
			// Engine dies NOW, not after the shot — the turnoff recording expects a
			// silent bed under it. Also clear ready so the cluster dims instantly.
			// Kill the turnon sound if it's still cranking — a mid-startup N press
			// must not leave the onended callback dangling.
			carIgnition.ready = false;
			if (turnOnSound?.isPlaying) turnOnSound.stop();
			for (const audio of layers) {
				if (audio?.isPlaying) audio.pause();
			}
		}
	}

	// ── Gear shifts: edge on the seq, one bark per engagement. ─────────────
	if (carSim.shiftSeq !== shiftSeq) {
		shiftSeq = carSim.shiftSeq;
		playOneShot(shiftSound, SHIFT_GAIN, master);
	}

	// ── Handbrake edges: pull on the rise, release on the fall. ─────────────
	if (carSim.handbrake !== handbrakePrev) {
		handbrakePrev = carSim.handbrake;
		playOneShot(carSim.handbrake ? handbrakePull : handbrakeRelease, HANDBRAKE_GAIN, master);
	}

	// Level from the TACHO: idle → limiter maps BED_IDLE → BED_REDLINE, one-pole
	// so a shift's rpm jump can't click the gain. No input anywhere in this term.
	const rpm = clamp(carSim.rpm, HW.idleRpm, HW.limiterRpm);
	const rpmFrac = (rpm - HW.idleRpm) / (HW.limiterRpm - HW.idleRpm);
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
		if (weight > AUDIBLE_WEIGHT && bedAudible) {
			// Volume and rate first, then play — otherwise a layer entering the
			// crossfade gets a buffer's worth at whatever level was left over.
			audio.setVolume(weight * level * startupBlend * master);
			audio.setPlaybackRate(clamp((rpm / LAYER_RPM[j]) * PITCH_SCALE, RATE_MIN, RATE_MAX));
			if (!audio.isPlaying) audio.play();
		} else if (audio.isPlaying) {
			audio.pause();
		}
	}

	// ── Nitrous: edges on the flow, then the drain loop rides what's left.
	// The purge blends in UNDER the spray — same drain voice, same solenoid
	// one-shots on the combined edges (a purge engage is an engage). ──────
	const flow = clamp(Math.max(carSim.nitrous, carSim.nitrousPurge * NITRO_PURGE_MIX), 0, 1);
	if (!nitroOn && flow > NITRO_ON_FLOW) {
		nitroOn = true;
		nitroReleased = false;
		playOneShot(nitroStart, NITRO_SHOT_GAIN, master);
	} else if (nitroOn && !nitroReleased && nitroPrev > NITRO_ON_FLOW && flow < nitroPrev * 0.97) {
		// The flow only falls while ON at the moment the pedal lifts or the bottle
		// runs dry — one frame later than the physics knows it, close enough for ears.
		nitroReleased = true;
		playOneShot(nitroEnd, NITRO_SHOT_GAIN, master);
	}
	if (nitroOn && flow <= NITRO_ON_FLOW) {
		nitroOn = false;
		nitroReleased = false;
	}
	nitroPrev = flow;

	if (nitroDrain?.buffer) {
		// Same contract as the bed: volume first, then play/pause on audibility.
		nitroDrain.setVolume(flow * NITRO_GAIN * master);
		if (flow > 0.01 && audible) {
			if (!nitroDrain.isPlaying) nitroDrain.play();
		} else if (nitroDrain.isPlaying) {
			nitroDrain.pause();
		}
	}

	// ── Tyres: the loosest source wins, eased, then the loop rides it. ─────────
	const speed = Math.abs(carSim.speedMs);
	const spin = clamp((carSim.slip - SQUEAL_SLIP_ON) / (1 - SQUEAL_SLIP_ON), 0, 1);
	const slide =
		clamp(
			(Math.abs(carSim.drift) - SQUEAL_DRIFT_ON) / (SQUEAL_DRIFT_FULL - SQUEAL_DRIFT_ON),
			0,
			1
		) * clamp(speed / 4, 0, 1);
	const hand = carSim.handbrake ? 0.8 * clamp(speed / 10, 0, 1) : 0;
	const hard = carSim.brake * SQUEAL_BRAKE * clamp(speed / SQUEAL_BRAKE_SPEED, 0, 1);
	const lat = SQUEAL_LAT * clamp((carSim.latLoad - SQUEAL_LAT_ON) / (1 - SQUEAL_LAT_ON), 0, 1);
	const launchSq = carSim.launch * SQUEAL_LAUNCH;
	const squeal = Math.max(spin, slide, hand, hard, lat, launchSq);
	squealLevel +=
		(squeal - squealLevel) * damp(squeal > squealLevel ? SQUEAL_ATTACK : SQUEAL_RELEASE, delta);
	// The release asymptote never lands on 0 — snap it, or the loop hisses at ~0
	// for the rest of the session after the first slide.
	if (squeal === 0 && squealLevel < 0.01) squealLevel = 0;

	if (tireSqueal?.buffer) {
		// The bed's contract: volume and rate first, then play/pause. Rate rides
		// the level — the harder the slide, the more frantic the squeal.
		tireSqueal.setVolume(squealLevel * SQUEAL_GAIN * master);
		tireSqueal.setPlaybackRate(0.85 + 0.4 * squealLevel);
		if (squealLevel > AUDIBLE_WEIGHT && master > 0) {
			if (!tireSqueal.isPlaying) tireSqueal.play();
		} else if (tireSqueal.isPlaying) {
			tireSqueal.pause();
		}
	}

	// ── Chassis scrape: the loop rides the grind, hits shriek on the edge. ──────
	// The SAME signal CarImpacts draws — grind from hullSlideMs over the scrape
	// floor, hits from hullHitSeq's rising edge. Polling the edge at frame rate
	// is safe: HIT_COOLDOWN (90 ms) is longer than any frame, so two increments
	// can never land inside one tick.
	const grind = carSim.hullContact
		? clamp((carSim.hullSlideMs - SCRAPE_MIN) / (SCRAPE_FULL - SCRAPE_MIN), 0, 1)
		: 0;
	scrapeLevel +=
		(grind - scrapeLevel) * damp(grind > scrapeLevel ? SCRAPE_ATTACK : SCRAPE_RELEASE, delta);
	// The release asymptote never lands on 0 — snap it, or the loop hisses at ~0
	// after the first scrape (the squeal's own rule).
	if (grind === 0 && scrapeLevel < 0.01) scrapeLevel = 0;

	if (scrapeLoop?.buffer) {
		// Volume and rate first, then play/pause. Rate rides the grind — the
		// faster the slide, the more frantic the metal.
		scrapeLoop.setVolume(scrapeLevel * SCRAPE_GAIN * master);
		scrapeLoop.setPlaybackRate(0.8 + 0.5 * scrapeLevel);
		if (scrapeLevel > AUDIBLE_WEIGHT && master > 0) {
			if (!scrapeLoop.isPlaying) scrapeLoop.play();
		} else if (scrapeLoop.isPlaying) {
			scrapeLoop.pause();
		}
	}

	if (carSim.hullHitSeq !== scrapeSeq) {
		scrapeSeq = carSim.hullHitSeq;
		triggerScrapeHit(clamp(carSim.hullHitDv / HULL_HIT_FULL_DV, 0, 1), master);
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
	// Reap scrape shrieks — DEADLINE-stopped as well as spent: the buffer
	// outlives the hit by seconds, so waiting for `isPlaying` to clear would
	// let a tap drone on. Same raw-children rule as the pops.
	for (let i = liveScraps.length - 1; i >= 0; i--) {
		const scrap = liveScraps[i];
		const due = scrap.context.currentTime >= (scrap.userData.deadline as number);
		if (!scrap.isPlaying || due) {
			if (scrap.isPlaying) scrap.stop();
			scrap.parent?.remove(scrap);
			liveScraps.splice(i, 1);
		}
	}
};
