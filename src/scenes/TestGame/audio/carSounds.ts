// TestGame's SOUND MANIFEST — the scene's own data, declared through the engine's
// registry exactly like the engine's own `engineSounds.ts`, but living HERE: a game's
// sounds are the game's, and `core/audio/` stays mechanism only (DOCS/AUDIO.md).
//
// What belongs here is PER-SOUND DATA: urls (relative to `public/sounds/`), positional
// params (CarEngineAudio's old mount props, verbatim), per-sound trim (the old mount
// `volume` props plus the gains carAudio.ts used to hand-multiply), and pool depth for
// the overlapping one-shots (the old clone lists). Everything computed per frame or per
// hit — the rpm crossfade, the squeal levels, the pop jitter — stays in carAudio.ts.

import { defineSounds } from '$core';

/**
 * The car's positional params. World units (2.5 u/m): the chase cam trails ~8–15 u off
 * the tail, so ref 10 keeps the car at full presence at normal framing and lets it fall
 * off across the far side of the track. Every car sound shares it — one speaker, one
 * room.
 */
const CAR_POS = { ref: 10, rolloff: 1.4, max: 300 };

/**
 * What the CLONED one-shots actually ran with — NOT CAR_POS. `Audio.clone()` copies
 * the buffer/rate/filters but not ONE panner parameter (three has no
 * PositionalAudio.copy override), so every old pop and scrape-hit clone played at
 * the PANNER DEFAULTS: refDistance 1, rolloffFactor 1, 'inverse' — roughly a
 * 1/distance gain, ~10× quieter than CAR_POS at chase-cam range. POP_GAIN and
 * SCRAPE_HIT_GAIN were tuned by ear against that accidental curve, so parity means
 * declaring IT, not the mounted params the clones never saw. (The loops and the
 * played-in-place one-shots used the mounted CAR_POS — they keep it above.)
 */
const HIT_POS = { ref: 1, rolloff: 1 };

/** Nitrous engage/release + ignition one-shot level — the files peak near 0 dBFS. */
const SHOT_GAIN = 0.9;
/** Shift bark + handbrake ratchet level — the mechanicals sit under the ignition
 * shots; dial by ear against SHOT_GAIN. */
const MECH_GAIN = 0.7;
/** Overall pop gain relative to the bed. 6.75 ≈ 5× the 1.35 that read as silent —
 * the files peak at -3 dBFS, so hits above ~1 clip the mixer; that is the point (a
 * bang that clips reads as a SLAM), but dial back toward ~3 if it turns to crunch. */
const POP_GAIN = 14;
/** Hit-shriek gain — the take runs ~5 dB hotter RMS than the pops' files, so this is
 * POP_GAIN scaled down to land proportionally under the bangs. */
const SCRAPE_HIT_GAIN = 4.5;
/** Overlap depth for the polyphonic one-shots. The old livePops/liveScraps clone
 * lists were UNBOUNDED, and the bursts run deeper than they look: limiter stutter
 * fires ~10 pops/s with 0.3–0.8 s tails, and scrape hits land every 90 ms with
 * deadlines up to 0.72 s (~8 alive). 8 keeps the bursts whole; past it the pool
 * steals the voice closest to freeing, which truncates the least. */
const HIT_POLY = 8;

export const carSounds = defineSounds({
	// The rpm bed, lowest first — indices align 1:1 with LAYER_RPM in carAudio.ts.
	idle: { url: 'engine/idle.opus', ...CAR_POS },
	rpm1: { url: 'engine/rpm1.opus', ...CAR_POS },
	rpm2: { url: 'engine/rpm2.opus', ...CAR_POS },
	rpm3: { url: 'engine/rpm3.opus', ...CAR_POS },
	rpm4: { url: 'engine/rpm4.opus', ...CAR_POS },
	rpm5: { url: 'engine/rpm5.opus', ...CAR_POS },
	// Nitrous: the drain loop rides the flow; start fires on engage and its REVERSE
	// (nitrosend.opus, made offline via areverse) on release — the edge semantics
	// live in carAudio.ts.
	nitroDrain: { url: 'engine/nitrosdrain.opus', ...CAR_POS },
	nitroStart: { url: 'engine/nitrosstart.opus', volume: SHOT_GAIN, ...CAR_POS },
	nitroEnd: { url: 'engine/nitrosend.opus', volume: SHOT_GAIN, ...CAR_POS },
	// Turbo whine — only voiced for cars with `cluster.hasTurbo` (carAudio.ts);
	// level rides the same spool math as the boost gauge (CarCluster.svelte).
	turbo: { url: 'engine/turbo.opus', ...CAR_POS },
	// Ignition: M fires the crank, N the cut.
	turnOn: { url: 'engine/turnon.opus', volume: SHOT_GAIN, ...CAR_POS },
	turnOff: { url: 'engine/turnoff.opus', volume: SHOT_GAIN, ...CAR_POS },
	shift: { url: 'engine/gear_shift.opus', volume: MECH_GAIN, ...CAR_POS },
	handbrakePull: { url: 'engine/handbrake_pull.opus', volume: MECH_GAIN, ...CAR_POS },
	handbrakeRelease: { url: 'engine/handbrake_release.opus', volume: MECH_GAIN, ...CAR_POS },
	// The pop takes are split by ENERGY, not chance — the crossover in carAudio.ts is
	// fuzzy but energy-driven — so two ids rather than a variant set, which draws at
	// random.
	popMild: { url: 'engine/exhaustpop1.opus', volume: POP_GAIN, poly: HIT_POLY, ...HIT_POS },
	popLoud: { url: 'engine/exhaustpop2.opus', volume: POP_GAIN, poly: HIT_POLY, ...HIT_POS },
	// One recording, two jobs: the squeal loop at the contact patches and the scrape
	// as a LOOP under the sills + deadline-stopped hit-shrieks at the contact point.
	squeal: { url: 'engine/tires_squal_loop.opus', ...CAR_POS },
	scrapeLoop: { url: 'engine/metal_scraping.opus', ...CAR_POS },
	scrapeHit: {
		url: 'engine/metal_scraping.opus',
		volume: SCRAPE_HIT_GAIN,
		poly: HIT_POLY,
		...HIT_POS
	}
});

/** The bed's sound ids, lowest first — index-aligned with `LAYER_RPM` in carAudio.ts. */
export const BED_IDS = ['idle', 'rpm1', 'rpm2', 'rpm3', 'rpm4', 'rpm5'] as const;
