// 1990 Nissan Pulsar/Sunny GTI-R (RNN14) — FWD, as specified (the real GTI-R
// is famously AWD — a Group A rally homologation special — but FWD is the
// layout this demo was asked to give it, for drivetrain variety against the
// RWD GR86 and the AWD RS3). As DATA (cars/types.ts is the contract).
// Headline numbers (power/torque/0-60/weight/top speed) are the real car's,
// given directly; everything else is a best-real-world-estimate researched
// the same way gr86.ts's numbers were, in SI units — nothing here knows
// about world units (../units.ts is the track's scale, shared by every car).
//
// Geometry (wheelbase, track, hub height, axle positions, wheel radius) is
// MEASURED off the GLB (1990_nissan_pulsar_gti-r_compressed.glb) — but
// UNLIKE every other car in this scene, this GLB is NOT authored in real
// metres (measured wheelbase 9.176 model-units against the real car's
// 2.430 m — off by ×3.776). Every SI-metre geometry/hardware field below is
// the raw measurement divided by that 3.776 factor, and `model.scale` is
// `UNITS_PER_METER / 3.776` instead of the usual bare `UNITS_PER_METER`, so
// the visual car and its physics collider (cars/hull.ts, which scales the
// GLB's own raw vertices by `model.scale` directly) land at the same real-
// world size as every other car on this track. exhaustTips/purgeVents/lamp/
// tailLamp are the ONE exception — those stay in the GLB's raw (unconverted)
// units, because they're read inside the same `model.scale`-scaled group as
// the mesh itself (TestGame.svelte), not through UNITS_PER_METER. They're
// also HAND-PLACED from the body's measured proportions, same caveat as the
// GR86's purgeVents.
//
// The GLB's wheel assembly is ALREADY one material spanning all four wheels
// (`Nissanrnn141990pulsargtirwh0031_diff`) with no other material sharing its
// name — `model.wheelMaterialPrefix` below matches it directly, no asset
// rename needed (contrast cars/rs3.ts, whose wheel assembly split across
// four separately-named materials and DID need one).
//
// Only a Grip tune is meaningfully authored — see `tunes` below.

import { BASE_URL } from '$extensions/settings';
import type { CarSpec } from './types';
import type { HandlingTune } from '../sim/handling';

/** model-units → real metres for THIS car's non-metric GLB (see header). */
const GLB_UNITS_PER_METRE = 3.7762377487779153;
/** The world-unit scale every other car gets for free by being authored in
 *  metres (`UNITS_PER_METER`, 2.5) — corrected for this GLB's own unit. */
const MODEL_SCALE = 2.5 / GLB_UNITS_PER_METRE;

const grip: HandlingTune = {
	label: 'Grip',

	tireMuLong: 1.0,
	tireMuLat: 1.05,
	latGripGain: 1.5,
	handbrakeMuLat: 0.4,
	// FWD unloads the driven (front) axle under acceleration (spec.ts's
	// drivenAxleLoad), so wheelspin costs a bit more lateral grip than the
	// GR86's RWD 0.35.
	slipGripLoss: 0.4,
	tractionControl: true,
	looseBase: 0,
	throttleLoose: 0,
	brakeLoose: 0,

	// A shorter wheelbase wants a tighter turning circle than the GR86's.
	maxSteerAngle: 0.55,
	steerHighSpeedFactor: 0.5,
	steerFalloffSpeed: 52,
	steerResponse: 7.5,
	yawResponse: 8.5,

	// A light car's handbrake swings the tail more readily than the GR86's.
	handbrakeYawBoost: 2.4,
	powerYawBoost: 1,
	driftAlign: 0,
	handbrakeAlign: 0,
	maxDriftAngle: 0.75
};

export const gtir = {
	id: 'gtir',
	label: 'Nissan Pulsar GTI-R',
	layout: 'fwd',

	hardware: {
		// ── Mass & geometry ──────────────────────────────────────────────────
		/** kg, as given. */
		mass: 1220,
		/** m — measured off the GLB, converted (see header); matches the real
		 *  car's published 2.430 m by construction (the conversion factor was
		 *  derived from this same measurement). */
		wheelbase: 2.43,
		/** m — CoG height estimate for a small early-90s hatchback. No public
		 *  factory figure. */
		cogHeight: 0.48,
		/** Fraction of static weight on the REAR axle. A transverse turbo four
		 *  up front, FWD as specified — nose-heavy, ~62/38. */
		rearWeightBias: 0.38,
		/** m — measured off the GLB, converted. */
		wheelRadius: 0.284,

		// ── Rotating inertia — catalogue-scale estimates (no published
		// figures for this car; same role as the GR86's, see its own comments). ─
		/** kg·m² — a smaller-displacement four than the GR86's flat-four. */
		engineInertia: 0.16,
		/** kg·m² — FWD only, so just the front wheels/shafts/diff. */
		wheelInertia: 1.1,
		/** kg·m² — down from the GR86's 2100 for the smaller car. */
		yawInertia: 1700,
		fullSlipSpeed: 9,
		/** m/s — an early-90s ECU is not a precise one. */
		tcSlipSpeed: 2.2,
		gripRate: 130,

		// ── Engine (SR20DET, 2.0 l turbocharged inline-4) ────────────────────
		idleRpm: 900,
		limiterRpm: 7300,
		redlineRpm: 7000,
		maxRpm: 7800,
		limiterCut: 0.05,
		/** rpm — a small turbo needs to be spooled before the drop. */
		launchRpm: 4000,
		launchSpeed: 4,
		clutchMinBite: 0.42,
		launchWindowMinRpm: 3800,
		launchWindowMaxRpm: 5800,
		/** FWD's own launch is weaker than AWD's or a rear-biased RWD's — a
		 *  more modest plant than the GR86's 1.4 or the RS3's 1.5. */
		launchGripGain: 1.3,
		launchTorqueGain: 0.7,
		launchBoostDecay: 0.55,
		rpmResponse: 23,
		freeRevRate: 7.5,
		freeDropRate: 5.5,
		engineBrakeBase: 10,
		engineBrakePerRpm: 0.005,
		lugRpm: 1300,

		// ── Transmission (5-speed manual, as specified) ──────────────────────
		gearRatios: [3.321, 1.902, 1.308, 0.969, 0.755],
		reverseRatio: 3.153,
		finalDrive: 4.529,
		efficiency: 0.9,
		shiftTime: 0.26,
		clutchOpen: 0.42,
		revMatchRate: 14,
		clutchShock: 0.72,
		creepTorque: 35,
		creepSpeed: 2.0,

		autoUpshiftRpm: [3000, 7000],
		autoDownshiftRpm: [1400, 3800],
		autoShiftHold: 0.45,
		autoDemandRate: 1.2,

		// ── Brakes ───────────────────────────────────────────────────────────
		/** N — ≈1.17 g, a more modest kit than the heavier cars' (a small,
		 *  light early-90s hatchback). */
		brakeForce: 14000,
		handbrakeForce: 3900,

		// ── Aerodynamics & losses ────────────────────────────────────────────
		/** N per (m/s)² — ½·ρ·Cd·A with Cd 0.35 (a boxy early-90s hatch with
		 *  rally aero), A 1.95 m². */
		dragK: 0.4095,
		/** N — rolling resistance, ≈0.013·m·g. */
		rollingResistance: 156,
		/** m/s — ~230 km/h (143 mph), the conservative end of the given
		 *  144–165 mph range. */
		topSpeed: 63.9,

		// SR20DET curve: peakier than a modern turbo's flat plateau (an
		// old-school small-turbo character) — 284 Nm (210 lb-ft) at 4800 rpm,
		// 269 Nm at 6000 (269 Nm × 628.3 rad/s ≈ 169 kW, the claimed 227 hp,
		// at the rpm power peaks), tapering hard after.
		torqueCurve: [
			[0, 80],
			[900, 110],
			[1800, 150],
			[2600, 210],
			[3200, 260],
			[4000, 278],
			[4800, 284],
			[5400, 280],
			[6000, 269],
			[6600, 230],
			[7000, 190],
			[7300, 140]
		],

		/** Aftermarket wet nitrous kit — same "not real hardware" accessory
		 *  every car in this demo carries (see gr86.ts). */
		nitrousTorqueGain: 0.4,
		nitrousCapacity: 4,
		nitrousRegen: 1 / 14,
		nitrousAttack: 8,
		nitrousRelease: 4
	},

	// ── Suspension — rally-homologation firm (sim/suspension.ts reads these):
	// stiffer than the GR86's stock-sports springs, still a road car. ────────
	suspension: {
		restSag: 0.058,
		dampZeta: 0.6,
		maxComp: 0.14,
		droop: 0.09,
		maxLift: 0.11,
		compMin: -0.04,
		compMax: 0.085,
		/** A light car dives/squats more per g than the heavier cars'. */
		squatPerG: 0.05,
		roadFollow: 1,
		roadMax: 0.1,
		slopeMax: 0.4,
		springK: 68,
		springZeta: 0.6
	},

	// ── Geometry — MEASURED off the GLB and converted to real metres (see
	// header for the GLB_UNITS_PER_METRE factor), except exhaustTips/
	// purgeVents/lamp/tailLamp, which stay in the GLB's own RAW units (hand-
	// placed from the body's measured proportions — see header). ────────────
	geometry: {
		halfTrack: 0.7226,
		frontAxleZ: -1.923,
		rearAxleZ: 0.507,
		hubY: 0.284,
		/** m — half of the real car's 185 mm tyre. */
		tyreHalfWidth: 0.0925,
		/** Hand-placed near the rear bumper's dual tip openings, RAW GLB units. */
		exhaustTips: [
			[-0.55, 0.75, 4.45],
			[0.55, 0.75, 4.45]
		],
		/** Hand-placed on the hood ahead of the windshield base, RAW GLB units —
		 *  the real GTI-R's own intercooler hood scoop sits here, so the vent
		 *  reads as part of the car's own bodywork. */
		purgeVents: [
			[-1.45, 2.75, -6.6],
			[1.45, 2.75, -6.6]
		],
		lamp: {
			x: 1.85,
			y: 1.65,
			z: -9.6,
			pitch: -0.045,
			/** Period-correct halogen sealed beams — warm white. */
			color: [0.95, 0.9, 0.78]
		},
		tailLamp: {
			x: 2.05,
			y: 2.3,
			z: 4.35
		}
	},

	model: {
		url: `${BASE_URL}models/testgame/1990_nissan_pulsar_gti-r_compressed.glb`,
		name: 'Pulsar GTI-R',
		/** NOT `UNITS_PER_METER` — this GLB isn't authored in metres (see
		 *  header's `GLB_UNITS_PER_METRE`). */
		scale: MODEL_SCALE,
		spawn: {
			position: [15, 1, 0],
			rotation: [0, 0, 0]
		},
		/** Matches `Nissanrnn141990pulsargtirwh0031_diff` and nothing else in
		 *  this GLB — no asset rename needed (contrast cars/rs3.ts). */
		wheelMaterialPrefix: 'Nissan',
		wheelRadiusFallback: 0.284,
		paintMaterial: 'GTI-R_Paint',
		/** Period-correct early-90s Nissan colours — names are real, hexes are
		 *  approximations of them (no verified paint codes to hand in this
		 *  session, so `code` is left off rather than invented — see
		 *  PaintOption's own comment). First entry is the default: it's what
		 *  the GLB shipped painted in (Super Black). */
		paints: [
			{ id: 'superblack', label: 'Super Black', hex: '#0a0a0c', finish: 'solid' },
			{ id: 'vailwhite', label: 'Vail White', hex: '#f5f5f0', finish: 'solid' },
			{ id: 'gungrey', label: 'Gun Grey Metallic', hex: '#6b6e70', finish: 'metallic' },
			{ id: 'superred', label: 'Super Red', hex: '#b8151f', finish: 'solid' },
			{ id: 'silver', label: 'Silver Metallic', hex: '#9a9c9e', finish: 'metallic' },
			{ id: 'deepgreen', label: 'Deep Green Pearl', hex: '#1f3d2e', finish: 'pearl' }
		]
	},

	audio: {
		layerRpm: [1600, 2800, 3800, 4800, 5800, 7000],
		/** Up from the GR86's 1.0 — a smaller-displacement four reads higher. */
		pitchScale: 1.25
	},

	cluster: {
		shiftLightFrom: 5900,
		hasTurbo: true
	},

	// ── The setups ────────────────────────────────────────────────────────────
	// Only Grip is meaningfully authored: this engine's drift model is tuned
	// around REAR-slip (the CLAUDE.md rule — driftAlign, the oversteer terms,
	// the whole "loose rear" mechanism), and FWD handling feel is explicitly
	// unwritten (see cars/CLAUDE.md's "Multi-car" section) — a real FWD slide
	// is a front-slip/lift-off character this model doesn't have the terms
	// for yet. Rather than fake it, Drift is the SAME tune as Grip — the G
	// switch is legal but changes nothing.
	tunes: {
		grip,
		drift: grip
	}
} as const satisfies CarSpec;

export type Gtir = typeof gtir;
