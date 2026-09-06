// The car spec — one car's complete description as DATA. Everything the scene,
// the sim and the FX components know about a specific car comes from here; the
// code is car-agnostic. Adding a car = one file in cars/ exporting a CarSpec
// plus an entry in the registry (cars/index.svelte.ts). No component edits.
//
// Conventions that hold for every car (they are the code's contracts, not
// per-car data):
// - SI units everywhere: metres, kg, newtons, seconds, rad. World conversion
//   happens ONLY at the controller/scene boundary (../units.ts).
// - Model space: the GLB's own metres, nose -Z, +X left, y up from the ground
//   plane (see geometry below for the measured anchors).
// - The GLB contract for wheels: wheel materials named `<wheelMaterialPrefix>*`
//   (case-insensitive), each wheel mesh containing ALL FOUR wheels merged, so
//   fx/CarWheels can recover the four pivots by bounding-box quadrant split.

import type { HandlingMode, HandlingTune } from '../sim/handling';

/** Which axle(s) the engine drives. RWD is fully implemented; FWD/AWD are
 *  spec-level plumbing only — the driven-axle LOAD math in the drivetrain is
 *  layout-aware, but their handling feel (front-slip understeer model, torque
 *  split) is deliberately unwritten until the cars exist to tune it against. */
export type CarLayout = 'rwd' | 'fwd' | 'awd';

/** One point of the wide-open-throttle crank torque curve. */
export type TorquePoint = readonly [rpm: number, nm: number];

export type CarSpec = {
	id: string;
	/** Shown wherever the car is named (HUD, logs). */
	label: string;
	layout: CarLayout;

	// ── Hardware — the car itself, pure SI. Never varies between setups. ──────
	hardware: {
		/** kg. */
		mass: number;
		/** m — front axle to rear axle. Steering geometry + load transfer. */
		wheelbase: number;
		/** m — centre of gravity height. Drives longitudinal load transfer. */
		cogHeight: number;
		/** Fraction of static weight on the REAR axle (the GR86 is 53/47). */
		rearWeightBias: number;
		/** m — loaded tyre radius. */
		wheelRadius: number;

		/** kg·m² — crank+flywheel+clutch+gearbox at the CRANK (reaches the road
		 *  through ratio², which is why low gears spin up instantly). */
		engineInertia: number;
		/** kg·m² — driven-axle wheels, tyres, shafts and diff together. */
		wheelInertia: number;

		idleRpm: number;
		/** Fuel cut. */
		limiterRpm: number;
		/** Where the tacho's red zone starts — display only. */
		redlineRpm: number;
		/** Top of the HUD dial. */
		maxRpm: number;
		/** s — how long each fuel cut lasts, so the limiter bounces. */
		limiterCut: number;
		/** rpm the engine hangs at on a clutch-slipped launch at full throttle. */
		launchRpm: number;
		/** m/s at which the clutch is fully home in 1st — below it slips. */
		launchSpeed: number;
		/** Fraction of crank torque a fully slipping clutch still passes. */
		clutchMinBite: number;
		/** 1/s — how fast rpm chases its target when the clutch is engaged. */
		rpmResponse: number;
		/** 1/s — free-revving (neutral or mid-shift): spin-up, then trailing-off. */
		freeRevRate: number;
		freeDropRate: number;
		/** Nm of engine braking = base + perRpm × rpm. */
		engineBrakeBase: number;
		engineBrakePerRpm: number;
		/** Below this the engine lugs and gives back less than the curve says. */
		lugRpm: number;

		/** Forward gears 1..n. Gear -1 is reverse, 0 neutral — see cars/spec.ts. */
		gearRatios: readonly number[];
		reverseRatio: number;
		finalDrive: number;
		/** Driveline efficiency, crank torque → wheel torque. */
		efficiency: number;
		/** s — clutch-out time per shift. Torque is cut for the whole window. */
		shiftTime: number;

		/** N — all four discs at full pedal. */
		brakeForce: number;
		/** N — the handbrake's own (rear-only) retardation. */
		handbrakeForce: number;

		/** N per (m/s)² — ½·ρ·Cd·A. */
		dragK: number;
		/** N — rolling resistance. */
		rollingResistance: number;
		/** m/s — governed top speed. */
		topSpeed: number;

		/** Wide-open-throttle crank torque curve, ascending by rpm. */
		torqueCurve: readonly TorquePoint[];
		/** Crank torque multiplier at full nitrous spray (the one nitrous HARDWARE
		 *  number; bottle/regen/ramp are gameplay and live in the controller). */
		nitrousTorqueGain: number;
	};

	// ── Geometry — measured off the GLB, model metres, nose -Z. ───────────────
	geometry: {
		/** m — half the rear track (tyre patch x for both rear wheels). */
		halfTrack: number;
		/** m — front axle centre, z in model space (negative: ahead of the origin). */
		frontAxleZ: number;
		/** m — rear axle centre, z in model space. */
		rearAxleZ: number;
		/** m — half the tyre's contact width; the skid ribbon's width. */
		tyreHalfWidth: number;
		/** Exhaust tip openings, model metres — flames spawn here, pop audio
		 *  parents here. Two entries, [left, right]. */
		exhaustTips: readonly (readonly [number, number, number])[];
		/** Headlamp anchors, model metres, + the pitch the beams aim at. */
		lamp: {
			x: number;
			y: number;
			z: number;
			/** rad — nose-down (negative) beam pitch. */
			pitch: number;
			color: readonly [number, number, number];
		};
		/** Chassis collider: a roundCuboid in model metres. `rounding` DILATES in
		 *  rapier (total half-extent = h + r), so the scene subtracts it from each
		 *  half-extent; `mountY` is the collider group's offset in WORLD units
		 *  (inside the RigidBody, outside the visual scale group). */
		collider: {
			hx: number;
			hy: number;
			hz: number;
			rounding: number;
			mountY: number;
		};
	};

	// ── Model — where the GLB is and how it sits in the world. ────────────────
	model: {
		/** Absolute URL (usually `${BASE_URL}models/testgame/…`). */
		url: string;
		/** Scene name for the car's group (scene tree / logs). */
		name: string;
		/** Visual scale of the model-metre group (this city: == UNITS_PER_METER). */
		scale: number;
		/** Hand-tuned spawn pose in WORLD units / radians — RigidBody reads it at creation. */
		spawn: {
			position: readonly [number, number, number];
			rotation: readonly [number, number, number];
		};
		/** Wheel materials in the GLB start with this prefix (case-insensitive) —
		 *  fx/CarWheels finds and re-meshes them. A new GLB must match, or this
		 *  and the measurement fallback below move together. */
		wheelMaterialPrefix: string;
		/** m — wheel radius fallback if runtime measurement fails. */
		wheelRadiusFallback: number;
	};

	// ── Audio — the engine NOTE. Files are SHARED across cars (one recorded
	//    bed); what differs per car is where the layers sit on its own tacho and
	//    how far the shared samples get pitch-shifted to voice it differently. ──
	audio: {
		/** rpm anchor of each shared layer file (idle + rpm1..5) on THIS car's
		 *  tacho — six entries, ascending (audio/carAudio.ts owns the file list). */
		layerRpm: readonly number[];
		/** Multiplier on every layer's playback rate — the cheap per-car voice:
		 *  1.0 is the GR86 as recorded; a future car shifts the whole bed. */
		pitchScale: number;
	};

	// ── Cluster — dial facts for hud/CarCluster. ──────────────────────────────
	cluster: {
		/** rpm the shift lights start filling from. */
		shiftLightFrom: number;
		/** False while no car in the demo is turbocharged — keeps the boost mini-
		 *  dial decorative ("N/A") until one is. */
		hasTurbo: boolean;
	};

	/** The setups (Grip / Drift) — a tune shop's view of THIS car. Read fresh
	 *  every physics step; switching mid-corner is legal. */
	tunes: Record<HandlingMode, HandlingTune>;
};
