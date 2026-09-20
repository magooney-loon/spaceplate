// 2023 Toyota GR86 — the demo's first car, as DATA (cars/types.ts is the
// contract). Everything here is the real car's numbers in SI units (metres,
// kilograms, newtons, seconds, rad); nothing in this file knows about world
// units (../units.ts is the track's scale, shared by every car).
//
// WHY SI: the driving model needs a torque curve, gear ratios and aero drag to
// feel like a car, and those only compose if they share one unit system. The
// controller converts at the boundary.
//
// The handling TUNE lives in `tune` below — moved from handling.ts, which
// keeps only the HandlingTune contract and the cornering-model rules. It is a
// NORMAL RWD SETUP, blended from the two tunes this car used to carry
// (Grip / Drift, retired with the switch) and biased toward the Drift half:
// planted and honest like the Grip one until you provoke it, but the Drift
// one's vocabulary once you do — the throttle and brake loosen the rear, the
// handbrake swings and self-aligns, there is lock to catch with, and a
// standstill full-throttle hold in 1st lights the rears (the burnout). Values
// + inline comments are the source of truth (see the note in CLAUDE.md:
// measured figures in the prose predate revisions).

import { BASE_URL } from '$extensions/settings';
import type { CarSpec } from './types';

export const gr86 = {
	id: 'gr86',
	label: 'Toyota GR86',
	layout: 'rwd',

	hardware: {
		// ── Mass & geometry ──────────────────────────────────────────────────
		/** kg — 2,875 lb with a driver aboard. */
		mass: 1290,
		/** m — front axle to rear axle. Sets the geometric steering radius. */
		wheelbase: 2.575,
		/** m — centre of gravity height. Drives longitudinal load transfer. */
		cogHeight: 0.46,
		/** Fraction of static weight on the driven (rear) axle — the GR86 is 53/47. */
		rearWeightBias: 0.47,
		/** m — 215/40R18: 18" rim (0.2286) + 40% of 215 mm sidewall. */
		wheelRadius: 0.315,

		// ── Rotating inertia ─────────────────────────────────────────────────
		// What the engine has to spin up before the car moves, and what keeps
		// spinning once the rears let go. `drivetrain.ts` turns these into an
		// equivalent MASS at the contact patch (I / r²), which is what wheelspin
		// accelerates.
		/** kg·m² — crank, flywheel, clutch and gearbox internals, measured at the
		 *  CRANK. It reaches the road through `totalRatio²`, so 1st carries
		 *  ~44 kg·m² of it and 3rd only ~8: that ratio² is the physical reason
		 *  low gears light the rears up instantly and high ones cannot spin them
		 *  at all. */
		engineInertia: 0.2,
		/** kg·m² — both driven-axle wheels, tyres, driveshafts and the diff
		 *  together. All that is left once the clutch is open, which is why a
		 *  shift hooks the car back up. */
		wheelInertia: 1.4,
		/** kg·m² — chassis yaw inertia. Catalog-scale figure for the platform;
		 *  the roundCuboid this replaced implied ~2280 (a box's m/12·(w² + l²)),
		 *  so contact-driven rotation firms up ~8% — steering is setAngvel and
		 *  never notices. The COM it ships with (chassisMassProperties) is the
		 *  53/47 lever rule: 15.5 cm ahead of the origin, where the old box's
		 *  z=0 centre never was. */
		yawInertia: 2100,
		/** m/s — 1st tops out ~12 m/s of spin at the limiter, 2nd ~10 after a long
		 *  pull, 3rd cannot spin at all: 10 puts 1st fully lit and 2nd only there
		 *  if you hold it — with the TC switch on that contrast reads as the lamp,
	 *  not smoke. */
		fullSlipSpeed: 10,
		/** m/s — the GR86's ECU is a patient one: 2 m/s of overspeed before the
		 *  TC ceiling bites, so the launch lands at `slip` 0.2 and the lamp
		 *  still lights when it is working. */
		tcSlipSpeed: 2,
		/** 1/s — the tyres snap the car back in line sharply once it hooks up. */
		gripRate: 138,

		// ── Engine (FA24, 2.4 l naturally aspirated) ─────────────────────────
		idleRpm: 800,
		/** Fuel cut. Redline on the dial is 7500; the ECU cuts just under it. */
		limiterRpm: 7400,
		/** Where the tacho's red zone starts — display only. */
		redlineRpm: 7000,
		/** Top of the HUD dial. */
		maxRpm: 8000,
		/** s — how long each fuel cut lasts, so the limiter bounces instead of flatlining. */
		limiterCut: 0.05,
		/** rpm the engine hangs at on a clutch-slipped launch at full throttle. */
		launchRpm: 3200,
		/** m/s at which the clutch is fully home in 1st — below this it slips. */
		launchSpeed: 4.5,
		/** Fraction of crank torque a fully slipping clutch still passes to the wheels. */
		clutchMinBite: 0.45,
		/** rpm — the FA24's rev-match window: 4–6k, and the closer to the top the
		 *  harder the launch (street launches sit just under the floor). */
		launchWindowMinRpm: 4000,
		launchWindowMaxRpm: 6000,
		/** +140% driven-axle μ at the top of the window — the plant that makes
		 *  the launch HARDER with depth (the request at full bite is already past
		 *  the tyre, so grip is the cap on thrust). Up from +100%: a caught PERFECT
		 *  launch is also the tool for a big standing burnout/donut (drop the clutch
		 *  clean, hold the lock over), so it wanted more headroom above the plain
		 *  clutch-slip start (`clutchMinBite`, unchanged) that a lazy standstill spin
		 *  is stuck with. (Not re-measured against the 0-60 figures elsewhere in this
		 *  file — those predate this revision.) */
		launchGripGain: 1.4,
		/** +75% WOT at the top, inside the traction limit — torque has to rise
		 *  with the plant or the μ bonus is never spent. Up from +50%, same reason
		 *  as `launchGripGain`. */
		launchTorqueGain: 0.75,
		/** 1/s — ~2 s of planted tail into 1st at full quality (was ~1.4 s at 0.7);
		 *  a lift or a gear change still kills it instantly. Slower so a launched
		 *  burnout/donut has room to develop before the boost is gone. */
		launchBoostDecay: 0.5,
		/** 1/s — how fast rpm chases its target when the clutch is engaged. */
		rpmResponse: 22,
		/** 1/s — free-revving (neutral or mid-shift): spin-up, then trailing-off. */
		freeRevRate: 7,
		freeDropRate: 5,
		/** Nm of engine braking = base + perRpm × rpm. ≈50 Nm at redline. */
		engineBrakeBase: 12,
		engineBrakePerRpm: 0.0055,
		/** Below this the engine lugs and gives back less than the curve says. */
		lugRpm: 1400,

		// ── Transmission (6-speed manual + 4.10 final) ───────────────────────
		/** 1st … 6th. Gear -1 is reverse, 0 is neutral — see cars/spec.ts. */
		gearRatios: [3.626, 2.188, 1.541, 1.213, 1.0, 0.767],
		reverseRatio: 3.437,
		finalDrive: 4.1,
		/** Driveline efficiency, crank torque → wheel torque. */
		efficiency: 0.9,
		/** s — the whole shift: pedal down, gear swapped, pedal back up. */
		shiftTime: 0.28,
		/** 45% of that on the floor (~0.13 s), then ~0.15 s of progressive
		 *  re-engagement. A quick road shift; a slower box wants more of both. */
		clutchOpen: 0.45,
		/** 1/s — a decent H-pattern driver blipping. Over the ~0.13 s the clutch is
		 *  open this closes ~85% of the mismatch, so a normal shift is smooth and
		 *  a big gear jump still lands with a thump. A DRIVER AID, gated on the TC
		 *  switch in the drivetrain: TC off (as it ships) and a manual box gets no
		 *  blip — tap the throttle inside the shift window to do it yourself. */
		revMatchRate: 14,
		/** 0.7 of the raw physical shock — the FA24's flywheel is light and the
		 *  full figure at a big mismatch chirps the rears on every downshift.
		 *  This is the knob for "downshifts feel weightless" / "too violent". */
		clutchShock: 0.7,
		/** Nm — the clutch's idle drag. Settles the car at ~6 km/h in 1st and
		 *  walks it backwards in R, which is what creep is; 2nd creeps lazily and
		 *  6th does not move at all, all from the gearing. */
		creepTorque: 40,
		/** m/s — creep is gone by ~8 km/h. */
		creepSpeed: 2.2,

		// ── The automatic's shift schedule ───────────────────────────────────
		// The same six gears, picked by the box (sim/drivetrain.ts). Wide open it
		// shifts at 6900, just under the 7400 cut and past the 7000 redline mark:
		// this engine is flat and dies at the limiter, so there is nothing to be
		// won by shifting earlier. Lifted it changes up at 2800, which lands 1st →
		// 2nd at ~1700 rpm — above the 1400 lug line with room to spare.
		autoUpshiftRpm: [2800, 6900],
		// Kickdown at 3600. An upshift at 6900 lands at worst (1st → 2nd) at
		// ~4160 rpm, so the box cannot change up and immediately want the lower
		// gear back. Lifted, 1300 is the coast-down schedule: it walks the box
		// back down to 1st as the car stops without ever lugging.
		autoDownshiftRpm: [1300, 3600],
		/** s — the FA24's box is a quick one, but it does not machine-gun. */
		autoShiftHold: 0.45,
		/** 1/s — ~0.8 s to lean on the pedal hard enough to hold a gear to 6900. */
		autoDemandRate: 1.2,

		// ── Brakes ───────────────────────────────────────────────────────────
		// Tyre μ and the whole steering rack are NOT here — they are the TUNE,
		// not the car (tune below).
		/** N — all four discs at full pedal: an aftermarket big-brake kit (the
		 *  nitrous precedent — emphatically not stock GR86 hardware). ≈1.23 g →
		 *  100-0 km/h in ~2.3 s, up from the stock kit's 0.9 g / ~2.9 s. Braking
		 *  has no lockup/ABS channel here, so demand past the tyre's μ simply
		 *  decelerates harder — the surplus IS the felt upgrade. */
		brakeForce: 15600,
		/** N — the handbrake's own (rear-only) retardation. */
		handbrakeForce: 4200,

		// ── Aerodynamics & losses ────────────────────────────────────────────
		/** N per (m/s)² — ½·ρ·Cd·A with Cd 0.28, A 2.02 m². */
		dragK: 0.3465,
		/** N — rolling resistance, ≈0.013·m·g. */
		rollingResistance: 165,
		/** m/s — 140 mph. The real car is electronically limited here, and so is this one. */
		topSpeed: 62.6,

		// FA24 wide-open-throttle curve. Peak 249 Nm (184 lb-ft) at 3700, and
		// 232 Nm at 7000 — which is exactly the 228 hp claim (170 kW /
		// 733 rad/s). Flat on purpose: this engine's character is that it pulls
		// the same everywhere and then dies at the limiter, which is what makes
		// the shift points matter.
		torqueCurve: [
			[0, 120],
			[800, 140],
			[1200, 182],
			[1800, 212],
			[2400, 231],
			[3000, 241],
			[3700, 249],
			[4500, 244],
			[5200, 240],
			[6000, 236],
			[6600, 234],
			[7000, 232],
			[7400, 214],
			[7800, 150]
		],

		/** Aftermarket wet nitrous kit — emphatically NOT real GR86 hardware (the
		 *  FA24 is naturally aspirated; the demo car just has a bottle in the boot).
		 *  ≈ +45% ≈ +112 Nm on peak (≈ 360 Nm, ~100 hp on top) — big enough that
		 *  1st/2nd under spray light the rears up for real (or the TC lamp, switch
		 *  permitting), honest enough that 3rd+ still hooks. The kit's
		 *  bottle/regen/ramp numbers live here with it; the
		 *  controller owns only the live level, the smoothed flow and the gating.
		 */
		nitrousTorqueGain: 0.45,
		/** s of full spray in a full bottle. */
		nitrousCapacity: 4,
		/** bottle fraction per s back while not spraying — ~14 s empty → full. */
		nitrousRegen: 1 / 14,
		/** 1/s — flow ramps in fast (the hit should bite) … */
		nitrousAttack: 8,
		/** … and tails off a touch slower, which reads as a sputter rather than
		 * a switch. */
		nitrousRelease: 4
	},

	// ── Suspension — stock-ish sports-car springs (sim/suspension.ts reads
	// these; SI metres, so a soft car is a big restSag). The values are the
	// module's old constants expressed in real units — 72 mm of sag is a ~1.9 Hz
	// spring (sqrt(g / sag)), soft enough to drink a 3 cm kerb lip without
	// putting the undertray on it. A luxury barge wants double the sag and half
	// the visual spring; a track car the reverse.
	suspension: {
		/** m — static deflection: ~1.9 Hz, the stiff-sports-car ride. */
		restSag: 0.072,
		/** Physical damping — stability-first, the body supplies the drama. */
		dampZeta: 0.55,
		/** m — past this compression the chassis hull IS the bump stop. */
		maxComp: 0.176,
		/** m — wheel hang below rest that still counts as grounded. */
		droop: 0.12,
		/** m — visual lift budget into the arch before the wheel gives up. */
		maxLift: 0.14,

		/** m — droop-side limit of the load-transfer lean. */
		compMin: -0.05,
		/** m — compression-side limit of the load-transfer lean. */
		compMax: 0.11,
		/** m per g — 4.5 cm per g: the lean you can feel, not a boat. */
		squatPerG: 0.045,
		/** Tracks camber exactly — a sports car holds its ground. */
		roadFollow: 1,
		/** m — ~4.4° of roll at full follow; the KERB-strike cap (the warp mode). */
		roadMax: 0.12,
		/** m — the SLOPE cap: ~19° of gradient, ~30° of camber. A rail, not a
		 *  feel knob — anything the car can drive on, it should sit flat on. */
		slopeMax: 0.45,
		/** 1/s² — the body chases an attitude in ~0.1 s, then bobs. */
		springK: 60,
		/** Under-critically damped, so the settle reads as a bob, not a slide. */
		springZeta: 0.62
	},

	geometry: {
		/** m — half the real car's rear track (1.55 m). The GLB's wheels are
		 *  measured at runtime by fx/CarWheels; this is the tyre-patch x for the
		 *  marks/smoke. A couple of cm of error is invisible under a
		 *  0.54-unit-wide ribbon. */
		halfTrack: 0.775,
		// Axle z in model space. Derived the same way the old SkidMarks/TireSmoke
		// constants were (weight-bias split of the wheelbase — approximate, but
		// visually validated); keep explicit so a future car's measured axles can
		// simply be written down.
		frontAxleZ: -2.575 * (1 - 0.47),
		rearAxleZ: 2.575 * 0.47,
		/** m — wheel-centre height in model space (measured off the GLB: wheel
		 *  centres at y 0.335). The WHEEL-CONTACT colliders' height — their
		 *  bottoms (radius `model.wheelRadiusFallback`) are the car's ONLY ground
		 *  contact, so at rest the visual tyres kiss the road instead of sinking
		 *  into it. */
		hubY: 0.335,
		/** m — half of 215 mm (the tyre); the skid ribbon's width. */
		tyreHalfWidth: 0.108,
		/** Measured, not placed by hand: the GLB's Draco `Nickel_Smooth` mesh
		 *  decoded offline, rear-most vertices clustered. nose −Z. */
		exhaustTips: [
			[-0.446, 0.293, 2.05],
			[0.446, 0.293, 2.05]
		],
		/** Hand-placed at the cowl corners (inboard of the wipers, a hair above
		 *  the hood surface) rather than measured like the tips: the show kit
		 *  purges through the hood at the windshield base, where the plume
		 *  clears the roofline from the chase cam. Re-measure off the GLB if it
		 *  ever reads off the surface. */
		purgeVents: [
			[-0.44, 0.88, -0.72],
			[0.44, 0.88, -0.72]
		],
		lamp: {
			x: 0.65,
			y: 0.66,
			z: -1.67,
			/** rad — the beams aim a touch nose-down. */
			pitch: -0.045,
			/** A real 2023 GR86 runs LED projectors — cool white. */
			color: [0.88, 0.93, 1.0]
		},
		/** Hand-placed at the rear quarter-panel corners (trunk height, same
		 *  spirit as purgeVents above) rather than measured off the GLB — the tail
		 *  cluster's own housing isn't a distinct mesh to cluster vertices from.
		 *  Re-measure if it ever reads off the bodywork. */
		tailLamp: {
			x: 0.7,
			y: 0.82,
			z: 1.85
		}
		// No collider numbers: the chassis is ONE rounded convex hull built from
		// the GLB itself at load (cars/hull.ts) — the measured silhouette (body x
		// ±0.91, greenhouse tapering to the roof at 1.31, mirrors to ±0.996 kept,
		// wheels excluded so the body is never a ground contact) + a 5 cm edge
		// fillet, belly clamped to the old 0.134 bump-stop line.
		// See TestGame.svelte's chassis comment for the full contract.
	},

	model: {
		url: `${BASE_URL}models/testgame/2023_toyota_gr86_compressed.glb`,
		name: 'GR86',
		/** This track: model metres × 2.5 == world units (units.ts). */
		scale: 2.5,
		/** Hand-tuned spawn pose, world units / radians. */
		spawn: {
			position: [15, 1, 0],
			rotation: [0, 0, 0]
		},
		/** The GLB's wheel materials are `WheelFLMtl` etc — prefix match. */
		wheelMaterialPrefix: 'wheel',
		/** m — measured wheel radius if the runtime bounding-box pass fails. */
		wheelRadiusFallback: 0.33,
		/** The GLB's shared body-panel material. */
		paintMaterial: 'Paint',
		/** The GLB's own merged front+rear lamp housing (fx/CarTaillights.svelte). */
		lampMaterial: 'Light_Bucket',
		/** The 2023+ GR86 order sheet (approximate hexes — a paint code is a
		 *  mixing recipe, not a screen colour). First entry is the default, and
		 *  it is Track bRED: that is what the GLB shipped painted in. */
		paints: [
			{ id: 'trackbred', label: 'Track bRED', code: 'DCK', hex: '#d5001c', finish: 'solid' },
			{ id: 'halo', label: 'Halo White', code: 'K1X', hex: '#f0f2f2', finish: 'solid' },
			{ id: 'raven', label: 'Raven Black', code: 'D4S', hex: '#0b0d10', finish: 'solid' },
			{ id: 'steel', label: 'Steel Metallic', code: 'G1U', hex: '#c6cbcf', finish: 'metallic' },
			{
				id: 'pavement',
				label: 'Pavement Metallic',
				code: 'P8Y',
				finish: 'metallic',
				hex: '#4a4e53'
			},
			{ id: 'neptune', label: 'Neptune Blue', code: 'DAR', hex: '#1c3fa8', finish: 'pearl' },
			{ id: 'trueno', label: 'Trueno Blue', code: 'WCH', hex: '#3468ce', finish: 'metallic' },
			{
				id: 'solar',
				label: 'Solar Shift',
				code: 'WCL',
				hex: '#6b55c9',
				finish: 'shift'
			},
			{ id: 'ridge', label: 'Ridge Green', code: 'DMG', hex: '#2c4f41', finish: 'metallic' },
			{ id: 'yuzu', label: 'Yuzu', code: 'C2Z', hex: '#f7ce0f', finish: 'solid' }
		]
	},

	audio: {
		/** Anchors are guesses at the shared wavs on THIS car's tacho — tune by
		 *  ear (audio/carAudio.ts owns the file list; the FILES are shared across
		 *  cars, the anchors are per-car). */
		layerRpm: [1400, 2600, 3800, 5000, 6200, 7400],
		/** The GR86 is the car the bed was recorded from — no shift. */
		pitchScale: 1.1
	},

	cluster: {
		shiftLightFrom: 5600,
		hasTurbo: false
	},

	// ── The tune ──────────────────────────────────────────────────────────────
	// One setup, the normal-RWD blend of the retired Grip/Drift pair. The first
	// cut sat mid-way and read too planted: the tail wouldn't throw on a
	// committed throttle and a standstill full-throttle hold in 1st hooked and
	// launched instead of burning out. Re-biased toward the Drift half — every
	// number's comment says where it sits between the two.
	tune: {
		// 0.75, drift-side — and that is the BURNOUT GATE, not a straight-line
		// knob: a standstill hold passes clutchMinBite 0.45 × ~244 Nm × the 1st
		// reduction ≈ 4.7 kN against `muLong × 5.9 kN` of static rear traction, so
		// the rears light up from a standstill only BELOW ~0.78. At 1.0 the car
		// hooked and simply launched; at 0.75 (Drift ran 0.7) a full-throttle hold
		// smokes. 2nd still steps out under WOT, 3rd+ still hooks (the transfer
		// term wins up there — 3rd's full WOT ≈ 4.5 kN against 0.75 × ~6.7 kN once
		// the load arrives).
		tireMuLong: 0.75,
		// The KINETIC μ, ABOVE the static cap on purpose (real physics runs it
		// below), blended in by CORNERING in the drivetrain: a straight-line
		// burnout runs the plain 0.75 — the wheel only keeps accelerating while
		// the engine out-asks the tyre, so the burnout gate survives — while a
		// drift gets up to 0.95 of push, so slides CARRY SPEED instead of bogging
		// down mid-corner. Flat 0.95 everywhere was tried first and killed the
		// standing burnout: at standstill the slipping clutch passes only ~4.7 kN
		// against 0.95 × 5.9 kN of kinetic push, so the wheel scrubbed back down
		// to hooked and the car just launched.
		slideMuLong: 0.95,
		// The real car's 1.1 — same number both old tunes carried.
		tireMuLat: 1.1,
		// Up from the real car's 1.3 — a friendlier, more forgiving cornering margin
		// so a slightly hot entry still hooks up instead of running wide. Both old
		// tunes agreed on this: a coasting car has a coasting car's grip, and the
		// contrast between planted and provoked IS the feel.
		latGripGain: 1.6,
		// Drift's value: paired with `handbrakeAlign` below it stops a tap-from-
		// 60 km/h in ~30 m, ~4 m sideways, ending near straight (Grip's older 0.42
		// predates that pairing and could skate). Also caps how far a throttle slide
		// can bleed down, so drifts barely notice it.
		handbrakeMuLat: 0.5,
		// Between Grip's 0.35 and Drift's 0.69, drift-biased: with the TC switch
		// off (as it ships) a spinning rear loses ~62% of its lateral tyre, so
		// power deepens a slide sharply. The TC switch on caps spin at 2 m/s
		// (slip 0.2, ~12%) — the ECU doing its job.
		slipGripLoss: 0.62,
		// 0, per the CLAUDE.md rule: looseness must be EARNED by an input, never
		// baked into the tyre. A planted-until-provoked car is the whole point.
		looseBase: 0,
		// Drift-weighted (the retired Drift tune ran 0.75): the throttle takes the
		// tail out on commitment, in EVERY gear — this is the friction circle, the
		// main drift control, and the reason the throttle works in gears that never
		// light up the rears.
		throttleLoose: 0.7,
		// Drift-weighted (Drift ran 0.9): trail-braking into a corner sets the car
		// readily — the "tap ↓ to set the angle" entry.
		brakeLoose: 0.75,

		// Drift-side of the middle: countersteer authority is the whole catch, and
		// the Grip-era 0.5 lock had none to spare. Less than Drift's lock-and-a-half
		// so the car doesn't dart on every keyboard tap.
		maxSteerAngle: 0.8,
		// Drift-side — the rack keeps three quarters of its lock at speed: enough
		// left to catch with, at any speed the car is slid at.
		steerHighSpeedFactor: 0.75,
		// Between Grip's 55 and Drift's 92 — the falloff stretches over most of the
		// speed range the car is actually driven at.
		steerFalloffSpeed: 80,
		// Slow rack on purpose (Drift ran 2.2, Grip 7): a binary key press has
		// nothing smoothing it but this, and big lock plus a fast rack darted on
		// every tap. Quick enough to answer a slide, slow enough not to start one.
		steerResponse: 3,
		// Drift-side (Drift 3.2, Grip 9) — the body keeps its own inertia and
		// rotates on its own time, which is half of what reads "drifty".
		yawResponse: 4,

		// Paired with `powerYawBoost` at 1.8 below: the flick multiplier is
		// 1.7 × 1.8 = 3.06, the retired Drift pair's 3.04.
		handbrakeYawBoost: 1.7,
		// Near Drift's 1.9: yaw authority builds toward +80% at full looseness,
		// fading back to 1 as the slide reaches `maxDriftAngle` — the slide
		// develops over a beat you can react to, not a wall it snaps against.
		powerYawBoost: 1.8,
		// Near Drift's 0.35. The auto-catch, scaled by `1 − loose` at the call
		// site: on a committed throttle slide (loose ≈ 0.7) only ~30% of it lands,
		// deliberately weak so holding throttle can hold the slide — LIFT is where
		// the catch happens, and near-full 0.32 lands there.
		driftAlign: 0.32,
		// Between Grip's 0 (off) and Drift's 3 — the catch while the handbrake is
		// held, which stops a handbrake stop from swapping ends. Steering still
		// wins a held handbrake turn; a tap-and-hold stop comes to rest near
		// straight.
		handbrakeAlign: 2.2,
		// Drift-side (Drift ran 2.45): the slide can get properly sideways and
		// HOLD before the catch fully takes over, then settles instead of
		// spinning. The steady-state angle lands well under this, a little past
		// half.
		maxDriftAngle: 1.9,
		// 0 — RWD: the front axle isn't driven, so it has nothing to spend
		// twice over. Kept explicit rather than assumed (handling.ts).
		powerPush: 0
	}
} as const satisfies CarSpec;

export type Gr86 = typeof gr86;
