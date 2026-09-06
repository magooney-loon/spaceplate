// The car's instrument feed — the same split the sky uses (`core/skybox`): a
// PLAIN object written by the physics task, and a `$state` MIRROR for the HUD.
//
// Physics runs at a fixed 200 Hz. Writing $state 200×/s means 200 Svelte
// invalidations per second per field for a needle no eye can follow, so the
// mirror is published at ~30 Hz and each field is quantised to what the dial can
// actually show. A value that rounds to the same number is not written at all.

import { currentCar } from '../cars';

/** Written every physics step. Read by CarWheels and the mirror below — never by the HUD. */
export const carSim = {
	/** Signed road speed along the nose, m/s (real metres — not world units). */
	speedMs: 0,
	// `as number`: the spec is `as const`, so a bare `idleRpm` would type this
	// field as the literal 800 and reject every reading the engine ever produces.
	rpm: currentCar().hardware.idleRpm as number,
	/** -1 reverse, 0 neutral, 1…6. */
	gear: 1,
	/** 0…1 wheelspin. */
	slip: 0,
	/** Steering rack, -1…1, left-positive — the fraction of lock the rack is at. */
	steer: 0,
	/** rad — `steer` × the SELECTED TUNE's full lock. CarWheels renders this rather
	 *  than re-deriving it, because full lock is a per-tune number now (Drift runs
	 *  more of it) and the visual lock has to be the one the physics steered at. */
	steerAngle: 0,
	/** rad — slip angle at the CG: the angle between where the nose points and where
	 *  the car is actually going. Positive = travelling to the car's RIGHT, i.e. the
	 *  tail is out in a left-hand slide. Zero when planted; a drift IS a big held
	 *  value here. Written in both tunes; only Drift can hold much of it. */
	drift: 0,
	/** 0..1 — share of the lateral grip budget the current corner demands: the
	 *  sideways-bleed demand over the μ·g cap it's clamped to (TestGame.svelte).
	 *  Pins at 1 exactly at max banking (v·ω = μ·g at the yaw cap), sits well under
	 *  it in a normal corner. The tyre-squeal driver reads this (carAudio): Grip's
	 *  planted limit cornering lights no drift angle and no TC lamp — the load
	 *  itself is the only honest squeal signal. */
	latLoad: 0,
	throttle: 0,
	brake: 0,
	handbrake: false,
	limiting: false,
	/** 0..1 — nitrous FLOW right now (ramped in TestGame.svelte's task, not raw
	 *  key state). Read by CarExhaustFlames to tint the flames blue and hold the
	 *  pilot jet while the system sprays. */
	nitrous: 0,
	/** 0..1 — bottle level. Drains while spraying, regenerates otherwise. */
	nitrousTank: 1,
	/** s remaining on the PERFECT LAUNCH cluster flash — set when a rev-match
	 *  launch lands (1st slotted from N, revs in the 4–6k window; drivetrain.ts
	 *  flags the frame), counted down in the task. The HUD mirrors it as a
	 *  boolean. */
	perfectLaunch: 0,
	/** The caught launch's tier, riding with the flash: 0 = STREET (4–5k),
	 *  1 = JUICY (5–5.5k), 2 = PERFECT (5.5–6k). Latched at the catch — the
	 *  label must not follow the live revs. */
	launchTier: 0,
	/** 0..1 — rev-match launch LIVE: depth in the window × what's left of the
	 *  clutch drop (drivetrain.state.launch). Read by the tyre-squeal source
	 *  (carAudio) and the launch camera kick (ChaseCamera); the cluster flash
	 *  is the separate perfectLaunch countdown above. */
	launch: 0
};

/** The HUD's reactive view. Quantised, ~30 Hz. */
export const carHud = $state({
	kmh: 0,
	mph: 0,
	// `as number`: the spec is `as const`, so a bare `idleRpm` would type this
	// field as the literal 800 and reject every reading the engine ever produces.
	rpm: currentCar().hardware.idleRpm as number,
	gear: 1,
	slip: 0,
	/** Slip angle in whole DEGREES, unsigned — the drift readout. */
	driftDeg: 0,
	throttle: 0,
	brake: 0,
	handbrake: false,
	limiting: false,
	/** 0..1 flow — quantised to 0.1, enough for the cluster's flowing lamp. */
	nitrous: 0,
	/** 0..1 bottle — quantised to 0.01, read as whole percent by the N2O gauge. */
	nitrousTank: 1,
	/** PERFECT LAUNCH flash live (carSim.perfectLaunch > 0). */
	perfectLaunch: false,
	/** The flash's tier label index — STREET / JUICY / PERFECT (TestGameHud
	 *  owns the strings; the flash is the centre-screen one). */
	launchTier: 0
});

const HUD_INTERVAL = 1 / 30;
let elapsed = 0;

/** Push `carSim` into `carHud` at most 30×/s, only where a shown value changed. */
export function publishCarHud(dt: number): void {
	elapsed += dt;
	if (elapsed < HUD_INTERVAL) return;
	elapsed = 0;

	const speed = Math.abs(carSim.speedMs);
	const kmh = Math.round(speed * 3.6);
	const mph = Math.round(speed * 2.23694);
	// 20 rpm buckets: ~370 steps across the dial, far finer than a needle reads.
	const rpm = Math.round(carSim.rpm / 20) * 20;
	const slip = Math.round(carSim.slip * 20) / 20;
	const driftDeg = Math.round(Math.abs(carSim.drift) * (180 / Math.PI));

	if (carHud.kmh !== kmh) carHud.kmh = kmh;
	if (carHud.mph !== mph) carHud.mph = mph;
	if (carHud.rpm !== rpm) carHud.rpm = rpm;
	if (carHud.gear !== carSim.gear) carHud.gear = carSim.gear;
	if (carHud.slip !== slip) carHud.slip = slip;
	if (carHud.driftDeg !== driftDeg) carHud.driftDeg = driftDeg;
	if (carHud.throttle !== carSim.throttle) carHud.throttle = carSim.throttle;
	if (carHud.brake !== carSim.brake) carHud.brake = carSim.brake;
	if (carHud.handbrake !== carSim.handbrake) carHud.handbrake = carSim.handbrake;
	if (carHud.limiting !== carSim.limiting) carHud.limiting = carSim.limiting;
	const nitrous = Math.round(carSim.nitrous * 10) / 10;
	if (carHud.nitrous !== nitrous) carHud.nitrous = nitrous;
	const nitrousTank = Math.round(carSim.nitrousTank * 100) / 100;
	if (carHud.nitrousTank !== nitrousTank) carHud.nitrousTank = nitrousTank;
	const launch = carSim.perfectLaunch > 0;
	if (carHud.perfectLaunch !== launch) carHud.perfectLaunch = launch;
	if (carHud.launchTier !== carSim.launchTier) carHud.launchTier = carSim.launchTier;
}

/** Park the instruments — used when the scene stops driving (scene switch, blur). */
export function resetCarTelemetry(): void {
	carSim.speedMs = 0;
	carSim.rpm = currentCar().hardware.idleRpm;
	carSim.gear = 1;
	carSim.slip = 0;
	carSim.steer = 0;
	carSim.steerAngle = 0;
	carSim.drift = 0;
	carSim.latLoad = 0;
	carSim.throttle = 0;
	carSim.brake = 0;
	carSim.handbrake = false;
	carSim.limiting = false;
	carSim.nitrous = 0;
	// The bottle refills on scene exit to match the fresh component state the
	// next mount starts with.
	carSim.nitrousTank = 1;
	carSim.perfectLaunch = 0;
	carSim.launchTier = 0;
	carSim.launch = 0;
	elapsed = HUD_INTERVAL;
	publishCarHud(0);
}
