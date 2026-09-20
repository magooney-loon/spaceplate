// 2018 Audi RS3 Sportback — AWD (quattro), as DATA (cars/types.ts is the
// contract). Headline numbers (power/torque/0-60/top speed/weight) are the
// real car's, given directly; everything else the spec needs that wasn't
// given (torque curve shape, individual gear ratios, wheelbase, weight bias,
// CoG height, brakes, drag) is a best-real-world-estimate researched the same
// way toyota_gr86.ts's numbers were, in SI units — nothing here knows about world
// units (../units.ts is the track's scale, shared by every car). The 6-speed
// manual gearbox is as specified — the real RS3 ships a 7-speed S tronic
// dual-clutch, but this demo models every car through the same manual/auto
// gearbox code, so it's given here as 6 ratios rather than 7.
//
// Geometry (wheelbase, track, hub height, axle positions, wheel radius) is
// MEASURED off the GLB itself (2018_audi_rs_3_sportback_compressed.glb),
// the same way toyota_gr86.ts's were — the model is authored in real metres (a
// 2.636 m measured wheelbase against the real car's 2.631 m), so
// `model.scale` is the same `UNITS_PER_METER` every other car in this scene
// uses. exhaustTips/purgeVents/lamp/tailLamp are HAND-PLACED from the body's
// measured proportions (no distinct mesh to cluster vertices from, same
// caveat as the GR86's purgeVents) — re-measure/nudge if they ever read off
// the model.
//
// The GLB's wheel assembly is FOUR separate materials (tire, brake, disk,
// hub) with no shared prefix in the source file — renamed at the asset level
// (public/models/testgame/…, geometry/Draco data untouched, only the
// material name strings) to `Wheel*` so this car satisfies the same GLB
// contract as the GR86 (`model.wheelMaterialPrefix` below): one case-
// insensitive prefix across every wheel-assembly material.
//
// One tune, the default setup — see `tune` below.

import { BASE_URL } from '$extensions/settings';
import type { CarSpec } from '../types';
import type { HandlingTune } from '../../sim/handling';

const tune: HandlingTune = {
	// AWD puts all four tyres to work under power — more longitudinal bite
	// than the GR86's RWD 0.75, and enough lateral grip that a 1575 kg car
	// still corners like the performance AWD hatch it is.
	tireMuLong: 1.15,
	// Equal to the static cap — the plain physical model (no kinetic grease
	// until AWD handling feel is written).
	slideMuLong: 1.15,
	tireMuLat: 1.15,
	latGripGain: 1.55,
	handbrakeMuLat: 0.42,
	// AWD shares wheelspin's cost across four tyres instead of two, so a
	// moment of slip bleeds less lateral grip than a RWD/FWD car's.
	slipGripLoss: 0.3,
	looseBase: 0,
	// 0 — power never loosens the REAR here (that would be power-oversteer,
	// not the planted quattro character); the understeer half below is what
	// power actually does to this car.
	throttleLoose: 0,
	// A trail-brake tap is the deliberate provoke: braking moves load off the
	// rear the same as it does on the GR86, just weighted down from its 0.75
	// — planted resists it, doesn't refuse it.
	brakeLoose: 0.32,

	// A touch less lock than the GR86 — a longer wheelbase wants a slightly
	// wider turn radius to feel natural.
	maxSteerAngle: 0.48,
	steerHighSpeedFactor: 0.5,
	steerFalloffSpeed: 58,
	steerResponse: 7,
	yawResponse: 9,

	handbrakeYawBoost: 2.0,
	// 1 — power never boosts yaw authority here; see `powerPush` below for
	// what power actually does (the opposite: it pulls the cap DOWN).
	powerYawBoost: 1,
	// A real auto-catch now the car can actually be provoked (trail-brake,
	// handbrake) — planted means it recovers quickly once let go, not that it
	// can't be unsettled at all.
	driftAlign: 2.6,
	// Catches a handbrake stop instead of letting it skate — the GR86's 2.2,
	// a shade over for the AWD's extra stability.
	handbrakeAlign: 2.4,
	maxDriftAngle: 0.7,
	// The quattro character: power pushes the nose wide rather than rotating
	// the tail — light, since only part of the drive load is up front (AWD
	// splits the traction limit's use across both driven axles, unlike the
	// GTI-R's FWD spending its whole budget at the front). Was 0.35 — same
	// fix as the GTI-R's: too much cap cut mid-corner reads as fighting the
	// car, not as planted.
	powerPush: 0.18
};

export const audi_rs3 = {
	id: 'audi_rs3',
	label: 'Audi RS3 Sportback',
	layout: 'awd',

	hardware: {
		// ── Mass & geometry ──────────────────────────────────────────────────
		/** kg — mid-point of the given 1565–1585 kg range. */
		mass: 1575,
		/** m — measured off the GLB (2.636 m); the real car's own figure is 2.631 m. */
		wheelbase: 2.636,
		/** m — CoG height estimate for a compact AWD 5-door hatch on 19s. No
		 *  public factory figure; a shade above the GR86's 0.46 for the taller
		 *  quattro driveline. */
		cogHeight: 0.52,
		/** Fraction of static weight on the REAR axle. The RS3 carries its
		 *  longitudinal turbo five ahead of the front axle — nose-heavy, ~60/40. */
		rearWeightBias: 0.4,
		/** m — measured off the GLB's wheel/tyre mesh. */
		wheelRadius: 0.325,

		// ── Rotating inertia — catalogue-scale estimates (no published figures
		// for this car; same role as the GR86's, see its own comments). ────────
		engineInertia: 0.22,
		/** kg·m² — AWD carries more driveline mass (both diffs, four half-shafts,
		 *  a centre coupling) than a single driven axle. */
		wheelInertia: 1.8,
		/** kg·m² — up from the GR86's 2100 for the extra mass and size. */
		yawInertia: 2500,
		/** m/s — AWD is much harder to spin than a single driven axle, so this
		 *  reads lit sooner than the GR86's 10. */
		fullSlipSpeed: 8,
		/** m/s — quattro's own ECU steps in quickly. */
		tcSlipSpeed: 1.5,
		gripRate: 140,

		// ── Engine (2.5 TFSI EA855evo, turbocharged inline-5) ────────────────
		idleRpm: 850,
		limiterRpm: 7100,
		redlineRpm: 6800,
		maxRpm: 7500,
		limiterCut: 0.05,
		/** rpm — a turbo launch wants to be caught with the turbo already spun up. */
		launchRpm: 4200,
		launchSpeed: 5,
		clutchMinBite: 0.5,
		launchWindowMinRpm: 4000,
		launchWindowMaxRpm: 6200,
		/** AWD's own launch trick IS the plant — a bigger grip gain than the
		 *  GR86's RWD 1.4 reads honest here. */
		launchGripGain: 1.5,
		launchTorqueGain: 0.6,
		launchBoostDecay: 0.5,
		rpmResponse: 20,
		/** A turbo five's reciprocating/turbo inertia revs a little slower than
		 *  the GR86's flat-four. */
		freeRevRate: 6.5,
		freeDropRate: 4.5,
		engineBrakeBase: 15,
		engineBrakePerRpm: 0.006,
		lugRpm: 1300,

		// ── Transmission (6-speed manual, as specified) + AWD final drive ────
		gearRatios: [3.4, 2.1, 1.45, 1.1, 0.9, 0.75],
		reverseRatio: 3.2,
		finalDrive: 3.65,
		/** Down from the GR86's 0.9 — an AWD driveline (a centre coupling plus
		 *  two differentials) loses more to friction than a single-axle box. */
		efficiency: 0.88,
		shiftTime: 0.24,
		clutchOpen: 0.4,
		revMatchRate: 15,
		clutchShock: 0.65,
		creepTorque: 45,
		creepSpeed: 2.3,

		autoUpshiftRpm: [2900, 6900],
		autoDownshiftRpm: [1300, 3700],
		autoShiftHold: 0.4,
		autoDemandRate: 1.3,

		// ── Brakes ───────────────────────────────────────────────────────────
		/** N — ≈1.29 g, the same "aftermarket kit" headroom over stock the
		 *  GR86's brakeForce models (its own ≈1.23 g). */
		brakeForce: 20000,
		handbrakeForce: 5100,

		// ── Aerodynamics & losses ────────────────────────────────────────────
		/** N per (m/s)² — ½·ρ·Cd·A with Cd 0.33, A 2.3 m² (a wider, taller
		 *  AWD hatch than the GR86's coupe). */
		dragK: 0.455,
		/** N — rolling resistance, ≈0.013·m·g. */
		rollingResistance: 201,
		/** m/s — 250 km/h (155 mph), electronically limited, as given. */
		topSpeed: 69.44,

		// EA855evo curve: a flat ≈480 Nm plateau from ~1950–5850 rpm (the
		// turbocharged five's whole character), tapering after. 480 Nm ×
		// 612.7 rad/s (5850 rpm) ≈ 294 kW — the claimed 400 hp, at the rpm
		// power peaks.
		torqueCurve: [
			[0, 200],
			[800, 320],
			[1400, 430],
			[1950, 480],
			[3000, 480],
			[4500, 480],
			[5850, 480],
			[6200, 460],
			[6800, 400],
			[7100, 300]
		],

		/** Aftermarket wet nitrous kit — same "not real hardware" accessory
		 *  every car in this demo carries (see toyota_gr86.ts). Smaller proportional
		 *  gain than the GR86's — this engine already makes big power stock. */
		nitrousTorqueGain: 0.35,
		nitrousCapacity: 4,
		nitrousRegen: 1 / 14,
		nitrousAttack: 8,
		nitrousRelease: 4
	},

	// ── Suspension — a performance AWD chassis: firmer than the GR86's
	// stock-sports springs, still a road car (sim/suspension.ts reads these). ──
	suspension: {
		restSag: 0.065,
		dampZeta: 0.58,
		maxComp: 0.16,
		droop: 0.1,
		maxLift: 0.13,
		compMin: -0.045,
		compMax: 0.1,
		/** AWD's weight transfer is shared across four contact patches, so it
		 *  squats/dives less per g than the GR86's 0.045. */
		squatPerG: 0.04,
		roadFollow: 1,
		roadMax: 0.11,
		slopeMax: 0.42,
		springK: 65,
		springZeta: 0.65
	},

	// ── Geometry — MEASURED off the GLB (model metres, nose -Z), except
	// exhaustTips/purgeVents/lamp/tailLamp which are hand-placed (see header). ─
	geometry: {
		/** m — measured (average of the front/rear wheel-centre halves). */
		halfTrack: 0.741,
		/** m — measured wheel-centre z. */
		frontAxleZ: -1.281,
		rearAxleZ: 1.355,
		/** m — measured wheel-centre height. */
		hubY: 0.179,
		/** m — half of ~245 mm (avg of the real car's 235 front / 255 rear). */
		tyreHalfWidth: 0.1225,
		/** Hand-placed at the rear bumper's oval tip openings. */
		exhaustTips: [
			[-0.48, 0.15, 2.2],
			[0.48, 0.15, 2.2]
		],
		/** Hand-placed at the cowl corners, same spirit as the GR86's. */
		purgeVents: [
			[-0.42, 0.85, -0.78],
			[0.42, 0.85, -0.78]
		],
		lamp: {
			x: 0.62,
			y: 0.52,
			z: -1.8,
			pitch: -0.045,
			/** Matrix LED headlights — cool white. */
			color: [0.85, 0.92, 1.0]
		},
		tailLamp: {
			x: 0.62,
			y: 0.75,
			z: 2.02
		}
	},

	model: {
		url: `${BASE_URL}models/testgame/2018_audi_rs_3_sportback_compressed.glb`,
		name: 'Audi RS3',
		/** The GLB is authored in real metres (measured wheelbase 2.636 m
		 *  against the real 2.631 m) — same UNITS_PER_METER every car uses. */
		scale: 2.5,
		spawn: {
			position: [15, 1, 0],
			rotation: [0, 0, 0]
		},
		/** Renamed at the asset level (see header) so the tire/brake/disk/hub
		 *  materials share this prefix, case-insensitive. */
		wheelMaterialPrefix: 'wheel',
		wheelRadiusFallback: 0.325,
		paintMaterial: 'MAT_RS3_2018_Base.004',
		/** The GLB's own merged front+rear lamp housing (fx/CarTaillights.svelte).
		 *  As exported it had NO emissive at all (unlike the GR86's own
		 *  `Light_Bucket`) — baked one in directly at the asset level: the base
		 *  colour texture IS the lamp cluster's real artwork (tail lens, third
		 *  brake strip, side marker, lower reflector all present as their own
		 *  regions), so the emissive map is that same texture with everything
		 *  that ISN'T one of those regions (the chrome trim, the dark headlight-
		 *  lens oval) masked to black, plus KHR_materials_emissive_strength 10 —
		 *  same strength the GR86 ships at. Geometry/Draco data untouched; only
		 *  new bytes appended (one bufferView/image/texture) and the material's
		 *  own emissiveTexture/emissiveFactor/extension fields written. */
		lampMaterial: 'MAT_Lights.001',
		/** Real RS3 (8V facelift) order-sheet colours — names are the actual
		 *  factory names, hexes are approximations of them (no verified paint
		 *  codes to hand in this session, so `code` is left off rather than
		 *  invented — see PaintOption's own comment). First entry is the
		 *  default: it's what the GLB shipped painted in. */
		paints: [
			{ id: 'turboblue', label: 'Turbo Blue', hex: '#1a3fc4', finish: 'solid' },
			{ id: 'glacierwhite', label: 'Glacier White Metallic', hex: '#f2f3f0', finish: 'metallic' },
			{ id: 'mythosblack', label: 'Mythos Black Metallic', hex: '#0c0d10', finish: 'metallic' },
			{ id: 'nardogrey', label: 'Nardo Grey', hex: '#8f9296', finish: 'solid' },
			{ id: 'kyalamigreen', label: 'Kyalami Green', hex: '#37493a', finish: 'metallic' },
			{ id: 'tangored', label: 'Tango Red Metallic', hex: '#a52019', finish: 'metallic' },
			{ id: 'daytonagrey', label: 'Daytona Grey Pearl', hex: '#43474b', finish: 'pearl' },
			{ id: 'catalunyared', label: 'Catalunya Red Metallic', hex: '#7a1620', finish: 'metallic' },
			{ id: 'prismshift', label: 'Prism Shift', hex: '#6f4fd8', finish: 'shift' }
		]
	},

	audio: {
		layerRpm: [1400, 2800, 4000, 5200, 6200, 7000],
		/** A touch deeper than the GR86 (1.0) for the turbo five's lower, more
		 *  mechanical note. */
		pitchScale: 0.9
	},

	cluster: {
		shiftLightFrom: 5900,
		hasTurbo: true
	},

	// ── The tune ──────────────────────────────────────────────────────────────
	// THE default setup, plain and grip-biased: this engine's oversteer terms
	// (driftAlign, looseness, the "loose rear" mechanism) are a REAR-slip
	// model, and AWD handling feel is explicitly unwritten (see CLAUDE.md's
	// "Multi-car" section) — a real AWD slide needs a torque-split model this
	// engine doesn't have yet, so the kinematic baseline is the honest tune.
	tune
} as const satisfies CarSpec;

export type AudiRs3 = typeof audi_rs3;
