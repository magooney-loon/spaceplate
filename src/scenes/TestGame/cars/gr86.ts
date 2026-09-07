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
		 * The one HARDWARE number lives here: crank torque multiplier at full
		 * spray. ≈ +45% ≈ +112 Nm on peak (≈ 360 Nm, ~100 hp on top) — big enough
		 * to light up 2nd in Grip and 3rd in Drift, honest enough that 3rd+ in
		 * Grip still hooks. Everything else about the system (bottle size, regen,
		 * ramp) is gameplay and lives in the controller (sim/controller.ts).
		 */
		nitrousTorqueGain: 0.45
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
		lamp: {
			x: 0.65,
			y: 0.66,
			z: -1.67,
			/** rad — the beams aim a touch nose-down. */
			pitch: -0.045,
			/** A real 2023 GR86 runs LED projectors — cool white. */
			color: [0.88, 0.93, 1.0]
		},
		/** The UNDERTRAY box — NOT the ground contact (four wheel-contact balls
		 *  are; see TestGame.svelte): it meets geometry only on real hits, riding
		 *  ~13 cm above the rest line so it clears seams and lips entirely. It is
		 *  still FRICTIONLESS with the Min combine rule (see TestGame.svelte) and
		 *  still the collider that carries the body's mass. ROUNDED (spec
		 *  `rounding`): what lets the belly GLANCE off kerbs and barrier bases on
		 *  the hits it does take. mountY is in WORLD units (the collider group
		 *  sits outside the visual scale group); the rounding arg is pre-scaled
		 *  at the call site — Threlte's collider-arg scaling is positional and
		 *  would otherwise leave the radius in model metres. */
		collider: {
			hx: 0.95,
			hy: 0.55,
			hz: 2.1,
			rounding: 0.18,
			mountY: 1.71
		}
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
		pitchScale: 1
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

			// The rears hold ~5 550 N: 1st lights up hard, 2nd steps out, 3rd and up hook
			// back in. High enough to keep the car properly quick — 0-60 in 6.2 s, near
			// Grip's 5.7 — because `throttleLoose` below, not wheelspin, is what gets the
			// car sideways. Trying to make wheelspin the trigger meant dropping this to
			// 0.6 and paying two and a half seconds for it.
			tireMuLong: 0.8,
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
			slipGripLoss: 0.95,
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
			looseBase: 0.15,
			// Up from 0.55: the throttle takes the tail out quicker and with less pedal
			// precision — you don't have to bury it to feel the rear step out, which is
			// the whole point of an easy drift control.
			throttleLoose: 0.7,
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
			// whole of `powerYawBoost`. 1.6 × 2.6 = 4.16 is the flick multiplier — a more
			// dramatic handbrake turn.
			handbrakeYawBoost: 1.6,
			// Unchanged. This one was already tuned DOWN from a punchy 4.5 to 2.6 because
			// more snap made the car harder, not easier, to hold — the easier-to-control
			// direction here is a stronger `driftAlign` catch, not a bigger flick.
			powerYawBoost: 2.6,
			// Up from 1.6: a firmer auto-catch, so a slide is less likely to run away into
			// a spin and opposite lock does more of the work for you.
			driftAlign: 2.2,
			// Up from 0.9: the drift can hold a bigger angle before the catch fully takes
			// over, for a more dramatic slide before it settles. The handbrake held at full
			// lock still spins the car out to fully sideways, which is what that input
			// should do.
			maxDriftAngle: 1.05
		}
	}
} as const satisfies CarSpec;

export type Gr86 = typeof gr86;
