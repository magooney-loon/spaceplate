// 2023 Toyota GR86 — the demo's first car, as DATA (cars/types.ts is the
// contract). Everything here is the real car's numbers in SI units (metres,
// kilograms, newtons, seconds, rad); nothing in this file knows about world
// units (../units.ts is the track's scale, shared by every car).
//
// WHY SI: the driving model needs a torque curve, gear ratios and aero drag to
// feel like a car, and those only compose if they share one unit system. The
// controller converts at the boundary.
//
// The setups (Grip / Drift) live in `tunes` below — moved from handling.ts,
// which keeps only the HandlingTune contract and the cornering-model rules.
// Values + inline comments are the source of truth for both tunes (see the
// note in CLAUDE.md: measured figures in the prose predate revisions).

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
		 *  if you hold it, which is the contrast the tunes want. */
		fullSlipSpeed: 10,
		/** m/s — the GR86's ECU is a patient one: 2 m/s of overspeed before the
		 *  TC ceiling bites, so Grip's launch lands at `slip` 0.2 and the lamp
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
		/** s — clutch-out time per shift. Torque is cut for the whole window. */
		shiftTime: 0.28,

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
		// Tyre μ and the whole steering rack are NOT here — they are the setup,
		// not the car, and they differ between the Grip and Drift tunes (tunes
		// below).
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

		/**
		 * Aftermarket wet nitrous kit — emphatically NOT real GR86 hardware (the
		 * FA24 is naturally aspirated; the demo car just has a bottle in the boot).
		 * ≈ +45% ≈ +112 Nm on peak (≈ 360 Nm, ~100 hp on top) — big enough to light
		 * up 2nd in Grip and 3rd in Drift, honest enough that 3rd+ in Grip still
		 * hooks. The kit's bottle/regen/ramp numbers live here with it; the
		 * controller owns only the live level, the smoothed flow and the gating.
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
		/** m — ~4.4° of roll at full follow; the kerb-strike cap. */
		roadMax: 0.12,
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
			position: [15, 2, 0],
			rotation: [0, 0, 0]
		},
		/** The GLB's wheel materials are `WheelFLMtl` etc — prefix match. */
		wheelMaterialPrefix: 'wheel',
		/** m — measured wheel radius if the runtime bounding-box pass fails. */
		wheelRadiusFallback: 0.33
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

	// ── The setups ────────────────────────────────────────────────────────────
	tunes: {
		grip: {
			label: 'Grip',

			tireMuLong: 1.05,
			tireMuLat: 1.1,
			// Up from the real car's 1.3 — a friendlier, more forgiving cornering margin
			// so a slightly hot entry still hooks up instead of running wide.
			latGripGain: 1.6,
			handbrakeMuLat: 0.42,
			// Down from 0.55: wheelspin now only costs a third of the lateral tyre instead
			// of nearly half, so mashing the throttle out of a corner doesn't step the
			// back out as a side effect — that's DRIFT's job, not a Grip surprise.
			slipGripLoss: 0.35,
			// On, like the real car. The rears are caught at 2 m/s of overspeed, which is
			// where Grip's wheelspin always effectively sat — 1st still lights the TC lamp
			// off the line and nothing else in the tune notices.
			tractionControl: true,
			looseBase: 0,
			throttleLoose: 0,
			brakeLoose: 0,

			// 28.6°, a touch more than the real car's 24°: the demo favours tight turns.
			// Radius at full lock is 4.7 m against the real 5.4. This was 0.7 rad — 40°,
			// not the ≈29° the old comment claimed — which is a 3.0 m radius and 94°/s of
			// yaw at 18 km/h. That is where the low-speed twitchiness came from.
			maxSteerAngle: 0.5,
			// Up from 0.35: the rack keeps half its lock at speed instead of a third, so
			// the car doesn't go numb on the motorway.
			steerHighSpeedFactor: 0.5,
			// Up from 42: the falloff above stretches over a wider speed range, so it
			// keeps feeling direct through more of the range instead of going flat early.
			steerFalloffSpeed: 55,
			// Up from 5.5: a keyboard tap reaches its target lock quicker — less input lag.
			steerResponse: 7,
			// Up from 7: the body catches up to the yaw target faster, which reads as a
			// more eager, direct car.
			yawResponse: 9,

			handbrakeYawBoost: 2.2,
			// 1 and 0 — Grip is the original kinematic model, untouched.
			powerYawBoost: 1,
			driftAlign: 0,
			maxDriftAngle: 0.75
		},
		drift: {
			label: 'Drift',

			// Up from 0.8, then 0.9 (settled on 0.7) — still bleeding too much straight-line power to
			// wheelspin for a tune where `throttleLoose` below (not wheelspin) is meant to
			// be the thing that gets the car sideways. Close to Grip's 1.05 now: 1st
			// still lights up, 2nd still steps out, 3rd+ still hooks, but almost none of
			// the drift character was ever riding on losing power in a straight line.
			// (Not re-measured against the 6.2 s/0-60 figure above.)
			tireMuLong: 0.7,
			tireMuLat: 1.1,
			// The SAME as Grip. A coasting car should have a coasting car's grip: with
			// `looseBase` near zero, boost ≈ 1 and the yaw cap matches what the bleed can
			// service, so Drift corners exactly like Grip until something provokes it.
			// That contrast IS the feel — running this lower just made everything vague.
			latGripGain: 1.6,
			// A third of Grip's. This is the μ a fully committed slide bleeds at — at 0.42
			// the handbrake shed 4.1 m/s² sideways and the car was straight again in a
			// tenth of a second, which is why it read as a turn-tighter button.
			handbrakeMuLat: 0.15,
			// Wheelspin nearly wipes the lateral tyre, so power deepens a slide sharply.
			slipGripLoss: 0.69,
			// OFF. Nothing trims the surplus torque, so the rears spin up for real: 1st is
			// on the limiter in a blink, 2nd builds over a couple of seconds of held
			// throttle, 3rd and up still cannot out-pull the tyre. A donut now sits at the
			// limiter with the rears lit instead of at 2 900 rpm, which is the whole reason
			// this switch exists. It costs no acceleration — the tyre's limit is unchanged
			// — but under power in 1st and 2nd `slip` now reaches 1, so `driftAlign` fades
			// right out and the car is genuinely on its own until you lift.
			tractionControl: false,
			// A little livelier than before — the car has a hint of playfulness even
			// coasting, without giving up the planted-until-provoked contrast.
			looseBase: 0.05,
			// Up from 0.6: the throttle takes the tail out quicker still and with even
			// less pedal precision — this was the "kinda hard to drift" complaint, and
			// throttle is the main control, so it's the one that needed to answer sooner.
			throttleLoose: 0.75,
			// Up from 0.8, closer to the handbrake's 1: trail-braking into a corner
			// triggers a slide more readily — an easier, more generous "tap ↓ to set the
			// car" entry.
			brakeLoose: 0.9,

			// A LITTLE more lock than Grip, held a little further up the speed range — just
			// enough countersteer authority to catch a slide (Grip's rack falls to 35% by
			// motorway speed, which is fine for lane changes and useless for catching
			// anything). These were 0.62 / 0.55 / 8, and that rack was most of what read as
			// punchy: from a keyboard the only thing smoothing a binary key press is
			// `steerResponse`, and at 8/s a 0.2 s tap already had 80% of a bigger lock in.
			maxSteerAngle: 0.95,
			steerHighSpeedFactor: 0.95,
			steerFalloffSpeed: 92,
			// Up from 1.5: countersteer answers the key quicker, which is what actually
			// makes catching a slide feel controllable instead of laggy.
			steerResponse: 2.2,
			// Up from 2.5, still a shade under Grip's 9 so the body keeps some of its own
			// inertia — but with the quicker steerResponse above, the whole catch-and-hold
			// loop reacts faster than before.
			yawResponse: 3.2,

			// Bigger flick: the handbrake already sets looseness to 1, so it collects the
			// whole of `powerYawBoost`. 1.6 × 1.9 = 3.04 is the flick multiplier — a more
			// dramatic handbrake turn.
			handbrakeYawBoost: 1.6,
			// Down again, 2.6 → 2.3 → 1.9: still ran away before the player had time to
			// react — this is the rate the yaw AUTHORITY builds at while the throttle
			// holds the rear loose, and a keyboard has nothing but reaction time to
			// counter it with. Slower build, more window to catch it.
			powerYawBoost: 1.9,
			// Up again, 0.15 → 0.22 → 0.35. `align` is `driftAlign × (1 − loose)`, and
			// `loose` while the throttle is held is `throttleLoose` (0.75 above) — so on
			// a committed throttle slide only 25% of this is landing (~0.09), which is
			// deliberately weak so holding throttle can still hold the slide. LIFT is
			// where the catch actually happens: `loose` falls back to `looseBase` (0.05),
			// so ~95% of this lands (~0.33) — that's the "opposite lock catches it" moment,
			// and 0.22 wasn't landing hard enough there either.
			driftAlign: 0.35,
			// Up from 0.9: the drift can hold a bigger angle before the catch fully takes
			// over, for a more dramatic slide before it settles. The handbrake held at full
			// lock still spins the car out to fully sideways, which is what that input
			// should do.
			maxDriftAngle: 2.45
		}
	}
} as const satisfies CarSpec;

export type Gr86 = typeof gr86;
