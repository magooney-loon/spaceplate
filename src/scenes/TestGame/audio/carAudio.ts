// Car engine audio — TestGame's own consumer of the engine's audio layer, and its
// ACCEPTANCE TEST (DOCS/AUDIO.md's carAudio table): everything this module used to do
// with raw <PositionalAudio> mounts, hand-multiplied gains and clones — the rpm bed,
// the pops, the squeal, the deadline shrieks — is expressed through the registry here.
// That is also what puts the car in a capture take: the offline render replays exactly
// what this module asks the facade for (core/audio/timeline.ts).
//
// THE CONTRACT (weatherAudio.ts is the precedent): CarEngineAudio.svelte mounts only
// anchor groups, takes a scope, and once buffers are ready calls
// `initCarAudio(scope, anchors)`; its task calls `tickCarAudio(delta)` — never an
// `$effect` (carSim is plain state; an effect would run once at mount and never
// again). Sound DATA lives in carSounds.ts; every mixing decision lives here. The old
// lifecycle functions are gone with the mounts: unmount is the scope's `release()`
// (the component's cleanup), and tab-hide parking is the engine's (AudioRuntime parks
// loops) — only the edge-state sync remains in `detachCarAudio`.
//
// WHY NO WEBGPU COMPUTE (the three.js webgpu_compute_audio example): that example
// processes a WHOLE buffer offline — compute → getArrayBufferAsync → play the
// result once. An engine note must follow rpm every frame, and per-frame GPU
// readback means a streaming scheduler whose only product is latency: three's
// Audio already pitch-shifts live via `setPlaybackRate` (setTargetAtTime-smoothed
// resampling — the same math the example's `element(index × pitch)` shader does),
// on the audio thread, with zero round-trips. If a compute-processed layer is ever
// wanted anyway, a per-sound declaration could hand the registry a raw AudioBuffer
// without touching this module's shape.

import type { Object3D } from 'three';
import { busAudible, sceneNow, type AudioScope, type PlayOptions, type VoiceHandle } from '$core';
import { currentCar } from '../cars';
import { clamp, damp } from '../sim/carMath';
import { carSim } from '../sim/carTelemetry.svelte';
import { carIgnition } from '../sim/carSwitches.svelte';
import { HULL_HIT_FULL_DV } from '../sim/hullContacts';
import { UNITS_PER_METER } from '../units';
import { BED_IDS, carSounds } from './carSounds';

/** Where the car's voices sit — CarEngineAudio's anchor groups, handed over at init. */
export type CarAnchors = {
	/** The engine bay: the rpm bed, nitrous, ignition and shift voices. */
	engineBay: Object3D;
	/** The cabin: the handbrake pair. */
	cabin: Object3D;
	/** The car's origin, in model metres: pops at the exhaust tips, scrape hits at
	 * the hull contact — per-play `position`s land in this space. */
	body: Object3D;
	/** Contact-patch height between the axles: the squeal loop. */
	tyres: Object3D;
	/** Under the sills: the scrape loop. */
	sills: Object3D;
};

let scope: AudioScope | null = null;
let anchors: CarAnchors | null = null;

/** One-shot through the scope. `poly: 1` declarations give the cut-and-restart the
 * old playOneShot had — a re-fire mid-play just goes again. */
const shot = (id: string, options?: PlayOptions): void => {
	scope?.play(id, options);
};

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

/** The bed's loop handles, index-aligned with BED_IDS/LAYER_RPM. Created paused at
 * init; the tick owns volume, rate and audibility. */
const bed: (VoiceHandle | null)[] = BED_IDS.map(() => null);

/** Smoothed bed level — eases toward the rpm-implied loudness. */
let bedLevel = BED_IDLE;

// ── Exhaust pops ─────────────────────────────────────────────────────────────
//
// CarExhaustFlames rolls the VISUAL pop (style, per-tip shares, double-bangs);
// this module voices it. Two takes: exhaustpop1 (mild) and exhaustpop2
// (aggressive) — take choice follows the pop's energy through a FUZZY crossover
// (never a hard threshold), and every hit is jittered in volume, rate and filter
// cutoff so no two bangs sound alike (the thunder-clap contract, weatherAudio).
// Polyphony is the registry's pool (`poly` on the declarations — the old clone
// list): a double-bang overlaps instead of restarting, and the sound comes from
// the dominant tip via a per-play `position`. The wavs are PEAK-NORMALIZED to
// -3 dBFS offline (+6.03/+8.05 dB, pure gain, RMS now matched at ~-22) — a bang
// is a transient: it must SLAM past the bed's continuous RMS (-8.4 raw, ~-14
// effective) or it simply doesn't exist — and the declaration's `volume` adds
// the last stretch on top.

/**
 * Voice one pop. `energy` 0..1 sizes it (downshift bursts big, limiter stutters
 * small), `right` picks the pipe it speaks from (the visual pop's dominant tip).
 * Called from CarExhaustFlames' physics task.
 */
export const triggerExhaustPop = (energy: number, right: boolean): void => {
	// No combustion, no bang — ignition off gates the pops too (the flames still
	// pop visually; gating them is a flames-side change for another day). The bus
	// mute covers the player's settings; this gate is a cost decision, like every
	// `busAudible` read.
	if (!busAudible('sfx') || !carIgnition.on || !anchors) return;
	// Fuzzy crossover: mild below, aggressive above, a coin-flip zone between —
	// never the same take for the same pop twice in a row.
	const aggressive = energy > 0.55 + 0.25 * Math.random();
	// Same model-metre space the flames' tips live in (the body anchor is at the
	// car's origin, inside the visual scale group) — the tip comes from the car's
	// spec, the flames' own TIP_L/TIP_R twin.
	const [tipX, tipY, tipZ] = currentCar().geometry.exhaustTips[right ? 1 : 0];
	shot((aggressive ? carSounds.popLoud : carSounds.popMild).soundId, {
		at: anchors.body,
		position: [tipX, tipY, tipZ],
		// Energy sizes it, jitter keeps no two alike; rate and filter jitter live
		// here too. Floor 1.8 kHz on the lowpass: the jitter must vary BRIGHTNESS,
		// never muffle the crack.
		volume: (0.55 + 0.45 * energy) * (0.85 + 0.3 * Math.random()),
		rate: 0.88 + 0.24 * Math.random(),
		lowpass: 1800 * 2 ** (Math.random() * 3)
	});
};

// ── Nitrous ─────────────────────────────────────────────────────────────────
//
// Three voices: `nitrosstart` on ENGAGE, its REVERSE (`nitrosend`, made with
// ffmpeg areverse — buffer sources can't play backwards) on RELEASE, and the
// `nitrosdrain` loop while the bottle empties, volume following the FLOW
// (carSim.nitrous — the same smoothed 0..1 the flames/camera/HUD read). Edges
// are read off that flow: engage = crossing up through ~0.02, release = the
// first frame the flow clearly FALLS from on (a drop >3%/frame only happens
// when the pedal lifts or the bottle runs dry — both are releases).
// The PURGE (carSim.nitrousPurge) shares the drain loop, blended UNDER the
// spray — a quieter hiss of the same character from the same engine-bay mount
// the line and solenoids live under — so the standstill vent needs no fourth
// voice, and the engage/release one-shots ride the combined edges for free.

/** Drain-loop level at full flow — a hiss under the engine, not over it. */
const NITRO_GAIN = 0.5;
/** Flow above this = system on (the ~0.13 s attack crosses it in a frame or two). */
const NITRO_ON_FLOW = 0.02;
/** Purge blend into the drain voice — the vent is a smaller hole than the
 *  nozzle: the same hiss at less than half the spray's presence. */
const NITRO_PURGE_MIX = 0.45;

/** The drain loop's handle. Created paused at init. */
let nitroDrain: VoiceHandle | null = null;
/** Previous tick's flow + the release latch (fire once per spray). */
let nitroPrev = 0;
let nitroOn = false;
let nitroReleased = false;

// ── Ignition ─────────────────────────────────────────────────────────────────
//
// The `ignition` slot toggles it (carSwitches.svelte.ts latches it). The bed, pops
// and nitrous all gate on `carIgnition.ready` — no combustion, no noise — and the
// one-shots voice the transitions. M starts a realistic startup: the turnon sound
// cranks, the physics task ramps RPM to ~2k then settles, and the idle bed fades
// in under the crank recording's tail (last STARTUP_BLEND seconds), so the two blend
// instead of hard-cutting when `ready` flips on the sound's end. N cuts instantly: bed
// silences under the turnoff shot, `ready` clears, the car coasts to a stop.

/** Seconds of the bed fading in under the crank tail before `ready` flips. */
const STARTUP_BLEND = 0.9;

/** The crank's handle — kept (one-shots usually aren't) because the startup blend
 * and the `ready` flip both read it. */
let turnOn: VoiceHandle | null = null;
/** Previous tick's ignition — edge detect for the one-shots. */
let ignPrev = carIgnition.on;
/** Scene time the crank started — drives the bed's fade-in under the tail. */
let turnOnSceneStart = 0;
/** True from the crank's first frame until it ends — what stops a mid-startup N
 * press (a `stop()`, not a natural end) from counting as "the recording ended". */
let cranking = false;

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

/** The last shift this module has voiced — `shiftSeq`'s own edge state,
 * synced (not reset) on detach so re-entry can't voice a phantom. */
let shiftSeq = carSim.shiftSeq;

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

/** Previous tick's handbrake — edge detect for the pair. */
let handbrakePrev = carSim.handbrake;

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
 *  holding ON the limit, not letting go of it. */
const SQUEAL_LAT = 0.65;
/** Hard-brake weight — under a full slide; the fronts working, not a lockup. */
const SQUEAL_BRAKE = 0.7;
/** m/s — brake squeal fades out below this, so a stop doesn't end in a squeak. */
const SQUEAL_BRAKE_SPEED = 6;
/** Launch-chirp weight — the rev-match drop, scaled by the launch's own
 *  quality-and-remaining signal. */
const SQUEAL_LAUNCH = 0.6;

/** The squeal loop's handle. Created paused at init. */
let squealLoop: VoiceHandle | null = null;
/** Smoothed squeal level — asymmetric slew. */
let squealLevel = 0;

// ── Chassis scrape ──────────────────────────────────────────────────────────
//
// The hull-contact half of what fx/CarImpacts.svelte draws, voiced: pressed
// and sliding = the metal_scraping LOOP (level rides the same grind the spark
// stream's rate does), and the ARRIVAL — `hullHitSeq`'s rising edge, the same
// one-shot CarImpacts bursts on — = a short loud SHRIEK at the contact point
// (a pooled positional voice with a per-play `position`, the pops' own rule)
// and cut off on a DEADLINE via `{ duration }`, because the recording is a 3 s
// scrape and a hit is over in a fraction of one. NOT gated on ignition — metal
// on metal is not combustive (the tyres' own rule); a wall scrape with the
// engine off still screams. The take is mono 48 kHz Opus peak-held at -3 dBFS
// (the pops' own convention) — downmixed with an explicit `pan` BEFORE the
// gain, because a plain `-ac 1` after `-af volume` sums the already-boosted
// channels and clips — and trimmed where its trailing silence began, so the
// loop doesn't pump.

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
/** s — hit-shriek length, floor + severity-sized range: a glancing tap is a
 *  chirp, a big arrival grinds half a second. */
const SCRAPE_HIT_MIN = 0.22;
const SCRAPE_HIT_RANGE = 0.5;

/** The scrape loop's handle. Created paused at init. */
let scrapeLoopVoice: VoiceHandle | null = null;
/** Smoothed scrape level — asymmetric slew. */
let scrapeLevel = 0;
/** The last hit this module has voiced — `hullHitSeq`'s own edge state,
 * synced (not reset) on detach so re-entry can't voice a phantom. */
let scrapeSeq = carSim.hullHitSeq;

/** Voice one arrival: a pooled scrape voice AT the contact point (the hull-local
 *  reading is world-unit body space; the body anchor lives in the visual
 *  model-metre group, so ÷UPM — the pops' TIP_L/R rule), pitched and
 *  lowpass-jittered so no two hits speak alike (the thunder-clap contract),
 *  stopped on a severity-sized deadline. */
function triggerScrapeHit(severity: number): void {
	if (!anchors) return;
	shot(carSounds.scrapeHit.soundId, {
		at: anchors.body,
		position: [
			carSim.hullLocalX / UNITS_PER_METER,
			carSim.hullLocalY / UNITS_PER_METER,
			carSim.hullLocalZ / UNITS_PER_METER
		],
		volume: (0.55 + 0.45 * severity) * (0.85 + 0.3 * Math.random()),
		// A hit is a SHARPER scrape than the loop's grind: base rate over 1, jitter
		// and severity on top — the same clamps the bed lives under.
		rate: 0.88 + 0.35 * severity + 0.3 * Math.random(),
		// Brightness jitter, floored so it never muffles the shriek (the pops' rule).
		lowpass: 2400 * 2 ** (Math.random() * 2.5),
		// The deadline — the buffer is a 3 s scrape, the hit is a fraction of one.
		duration: SCRAPE_HIT_MIN + SCRAPE_HIT_RANGE * severity
	});
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Create the car's voices — CarEngineAudio's mount step, called once buffers are
 * ready. Every loop starts PAUSED: the tick owns when anything is heard (autoplay
 * policy + the sfx bus), exactly like the old `autoplay={false}` mounts.
 */
export const initCarAudio = (carScope: AudioScope, at: CarAnchors): void => {
	scope = carScope;
	anchors = at;
	for (let i = 0; i < BED_IDS.length; i++) {
		bed[i] = scope.loop(carSounds[BED_IDS[i]].soundId, { at: at.engineBay, paused: true });
	}
	nitroDrain = scope.loop(carSounds.nitroDrain.soundId, { at: at.engineBay, paused: true });
	squealLoop = scope.loop(carSounds.squeal.soundId, { at: at.tyres, paused: true });
	scrapeLoopVoice = scope.loop(carSounds.scrapeLoop.soundId, { at: at.sills, paused: true });
};

/**
 * Drop every held handle and sync the edge states — CarEngineAudio's teardown, after
 * the scope has released the voices. Sync, not reset, everywhere: ignition is a latched
 * switch and must survive remounts, and syncing is what stops a phantom shot at
 * re-entry.
 */
export const detachCarAudio = (): void => {
	scope = null;
	anchors = null;
	bed.fill(null);
	nitroDrain = null;
	squealLoop = null;
	scrapeLoopVoice = null;
	turnOn = null;
	cranking = false;
	nitroPrev = 0;
	nitroOn = false;
	nitroReleased = false;
	ignPrev = carIgnition.on;
	shiftSeq = carSim.shiftSeq;
	handbrakePrev = carSim.handbrake;
	squealLevel = 0;
	scrapeLevel = 0;
	bedLevel = BED_IDLE;
	scrapeSeq = carSim.hullHitSeq;
};

// ── The tick ─────────────────────────────────────────────────────────────────

export const tickCarAudio = (delta: number): void => {
	// Before init (buffers still loading) or after detach — nothing to drive. The
	// tick itself stays mounted with the component, but voices don't exist yet/any
	// more, and all the edge states are synced at init/detach boundaries.
	if (!scope || !anchors) return;

	// The sfx bus carries the player's settings (the old hand-multiplied `master`).
	// `busAudible` is only ever a COST decision: the gain node has already made a
	// muted bus silent, but a loop nobody can hear should not be decoding. Ignition
	// gates everything combustive — bed, pops, nitrous. The one-shots below still
	// play through this (they ARE the transitions), so they fire regardless of
	// `audible`. The bed fades in under the crank recording's tail (startupBlend
	// 0→1 over its last STARTUP_BLEND seconds) instead of cutting in when the
	// recording ends — `ready` still flips at the crank's end and still gates
	// driving, just not the bed's fade.
	const audible = busAudible('sfx') && carIgnition.ready;
	let startupBlend = carIgnition.ready ? 1 : 0;
	if (carIgnition.on && !carIgnition.ready && turnOn?.playing) {
		const elapsed = sceneNow() - turnOnSceneStart;
		const remaining = turnOn.duration - elapsed;
		startupBlend = clamp(1 - remaining / STARTUP_BLEND, 0, 1);
	}
	const bedAudible = audible || startupBlend > 0;

	// ── Ignition edges: voice the transitions, bed handles the rest. ──────────
	if (carIgnition.on !== ignPrev) {
		ignPrev = carIgnition.on;
		if (carIgnition.on) {
			turnOn = scope.play(carSounds.turnOn.soundId, { at: anchors.engineBay });
			turnOnSceneStart = sceneNow();
			cranking = true;
		} else {
			shot(carSounds.turnOff.soundId, { at: anchors.engineBay });
			// Engine dies NOW, not after the shot — the turnoff recording expects a
			// silent bed under it. Also clear ready so the cluster dims instantly.
			// Stop the crank if it's still going — a mid-startup N press must not
			// leave it droning, or count as a natural end (cranking clears).
			carIgnition.ready = false;
			cranking = false;
			turnOn?.stop();
			turnOn = null;
			for (const layer of bed) layer?.pause();
		}
	}
	// The crank's natural end flips `ready` — the old `onEnded` callback, polled
	// here at frame rate (ears cannot tell). `cranking` is the guard: only a
	// PLAYING crank that fell silent on its own counts.
	if (cranking && turnOn && !turnOn.playing) {
		cranking = false;
		turnOn = null;
		carIgnition.ready = true;
	}

	// ── Gear shifts: edge on the seq, one bark per engagement. ─────────────
	if (carSim.shiftSeq !== shiftSeq) {
		shiftSeq = carSim.shiftSeq;
		shot(carSounds.shift.soundId, { at: anchors.engineBay });
	}

	// ── Handbrake edges: pull on the rise, release on the fall. ─────────────
	if (carSim.handbrake !== handbrakePrev) {
		handbrakePrev = carSim.handbrake;
		shot((carSim.handbrake ? carSounds.handbrakePull : carSounds.handbrakeRelease).soundId, {
			at: anchors.cabin
		});
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

	for (let j = 0; j < bed.length; j++) {
		const layer = bed[j];
		if (!layer) continue;
		const weight = j === band ? 1 - s : j === band + 1 ? s : 0;
		if (weight > AUDIBLE_WEIGHT && bedAudible) {
			// Volume and rate first, then resume — otherwise a layer entering the
			// crossfade gets a buffer's worth at whatever level was left over.
			// (resume/pause no-op on the wrong state, which is the old
			// isPlaying check inlined.)
			layer.volume = weight * level * startupBlend;
			layer.rate = clamp((rpm / LAYER_RPM[j]) * PITCH_SCALE, RATE_MIN, RATE_MAX);
			layer.resume();
		} else {
			layer.pause();
		}
	}

	// ── Nitrous: edges on the flow, then the drain loop rides what's left.
	// The purge blends in UNDER the spray — same drain voice, same solenoid
	// one-shots on the combined edges (a purge engage is an engage). ──────
	const flow = clamp(Math.max(carSim.nitrous, carSim.nitrousPurge * NITRO_PURGE_MIX), 0, 1);
	if (!nitroOn && flow > NITRO_ON_FLOW) {
		nitroOn = true;
		nitroReleased = false;
		shot(carSounds.nitroStart.soundId, { at: anchors.engineBay });
	} else if (nitroOn && !nitroReleased && nitroPrev > NITRO_ON_FLOW && flow < nitroPrev * 0.97) {
		// The flow only falls while ON at the moment the pedal lifts or the bottle
		// runs dry — one frame later than the physics knows it, close enough for ears.
		nitroReleased = true;
		shot(carSounds.nitroEnd.soundId, { at: anchors.engineBay });
	}
	if (nitroOn && flow <= NITRO_ON_FLOW) {
		nitroOn = false;
		nitroReleased = false;
	}
	nitroPrev = flow;

	if (nitroDrain) {
		// Same contract as the bed: volume first, then resume/pause on audibility.
		nitroDrain.volume = flow * NITRO_GAIN;
		if (flow > 0.01 && audible) nitroDrain.resume();
		else nitroDrain.pause();
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

	if (squealLoop) {
		// The bed's contract: volume and rate first, then resume/pause. Rate rides
		// the level — the harder the slide, the more frantic the squeal. busAudible,
		// not `audible`: tyres are not combustive (the module's own rule).
		squealLoop.volume = squealLevel * SQUEAL_GAIN;
		squealLoop.rate = 0.85 + 0.4 * squealLevel;
		if (squealLevel > AUDIBLE_WEIGHT && busAudible('sfx')) squealLoop.resume();
		else squealLoop.pause();
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

	if (scrapeLoopVoice) {
		// Volume and rate first, then resume/pause. Rate rides the grind — the
		// faster the slide, the more frantic the metal. busAudible: metal on metal
		// is not combustive either.
		scrapeLoopVoice.volume = scrapeLevel * SCRAPE_GAIN;
		scrapeLoopVoice.rate = 0.8 + 0.5 * scrapeLevel;
		if (scrapeLevel > AUDIBLE_WEIGHT && busAudible('sfx')) scrapeLoopVoice.resume();
		else scrapeLoopVoice.pause();
	}

	if (carSim.hullHitSeq !== scrapeSeq) {
		scrapeSeq = carSim.hullHitSeq;
		triggerScrapeHit(clamp(carSim.hullHitDv / HULL_HIT_FULL_DV, 0, 1));
	}

	// (No reaping: the pops and shrieks are POOLED — `poly` on the declarations —
	// and the registry owns stealing and reuse. The old livePops/liveScraps lists
	// and their deadline checks were exactly the machinery the pool replaced.)
};
