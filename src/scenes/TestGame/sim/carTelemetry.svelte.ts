// The car's instrument feed — the same split the sky uses (`core/skybox`): a
// PLAIN object written by the physics task, and a `$state` MIRROR for the HUD.
//
// Physics runs at a FIXED rate (`physicsState.framerate`, 60 by default and
// settable to 200). Writing $state at the physics rate means one Svelte
// invalidation per field per step for a needle no eye can follow, so the
// mirror is published at ~30 Hz and each field is quantised to what the dial can
// actually show. A value that rounds to the same number is not written at all.
// `publishCarHud` counts SECONDS, not steps, so the 30 Hz holds at any rate.

import { currentCar } from '../cars';
import { G } from '../units';
import { carView } from './carSwitches.svelte';
import type { Suspension } from './suspension';

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
	launch: 0,
	/** m/s² along the nose, + = accelerating forward. THE MODEL'S OWN NUMBER —
	 *  (driveForce + resistForce) / mass, i.e. exactly the longitudinal force the
	 *  controller hands Rapier — not a finite difference of the body's pose. The
	 *  suspension (sim/suspension.ts) reads it for squat/dive. */
	accelFwd: 0,
	/** m/s² across the car, + = pushed toward body +X (LEFT), i.e. positive in a
	 *  left-hand corner. The sideways bleed the grip model actually applied this
	 *  step, clamped at μ·g like everything else — so it saturates exactly when
	 *  the tyres do, and a car sliding at the limit stops leaning harder. */
	accelLat: 0,

	// ── The debug feed ────────────────────────────────────────────────────────
	// Everything below exists because `debug/DebugRig.svelte` draws it and the
	// HUD's debug panel prints it. The driving model computed all of it already —
	// these are publishes, not new physics — but each is a number the rig would
	// otherwise have had to GUESS at, and a rig that guesses is a rig that lies.
	// (The rig's wheel roll used to fake wheelspin as `speedMs × (1 + slip·0.8)`;
	// `spin` below is the real overspeed the drivetrain integrated.)

	/** m/s — how much faster the DRIVEN contact patch is running than the road,
	 *  signed along the nose (drivetrain `state.spin`). The rig rolls its driven
	 *  wheels at `speedMs + spin` and its undriven wheels at `speedMs`, which is
	 *  the whole "which wheels are turning" reading. */
	spin: 0,
	/** m/s — velocity component along body +X, straight off the controller's
	 *  `vLateral` with no sign games: whatever side +X is, this is the car's
	 *  motion along it. The rig's velocity arrow is `(velLat, 0, -speedMs)`. */
	velLat: 0,
	/** rad/s — the yaw rate actually commanded on the body this step. */
	yawRate: 0,
	/** N along the nose, signed — engine + engine braking, traction-clipped. */
	driveForce: 0,
	/** N along the nose, signed — brakes + drag + rolling; always opposes motion. */
	resistForce: 0,
	/** 0..1 — the FRICTION CIRCLE at the driven axle: the share of its grip budget
	 *  the drive force is spending. Tints the rig's driveline and drives the
	 *  looseness the cornering model reads. */
	powerLoad: 0,
	/** 0..1 — lateral grip left after wheelspin/brake/throttle/looseness. */
	gripFactor: 0,
	/** 0..1 — how loose the rear is right now (the loosest source wins). */
	loose: 0,
	/** The LIVE lateral μ the sideways bleed is capped at this step — what the
	 *  rig's friction circle is drawn at. Falls toward `handbrakeMuLat` as the
	 *  rear lets go. */
	muLat: 0,
	/** 0 = clutch on the floor (mid-shift), 1 = fully home. */
	clutch: 1,

	// ── Hull contact — the chassis vs. the world, NOT the ground contact ─────
	// Written every physics step by `sim/hullContacts.ts`, straight off
	// Rapier's narrow-phase contact manifolds (see that file's header for why
	// events can't do this job). The raycast springs above are the car's
	// ground contact; this is what the hull's belly, doors or corners are
	// actually touching — kerbs, barrier bases, a fence scrape.
	/** True the instant a manifold exists this step. */
	hullContact: false,
	/** World-unit contact point, averaged over the strongest manifold's solver
	 *  contacts — meaningless while `hullContact` is false. */
	hullContactX: 0,
	hullContactY: 0,
	hullContactZ: 0,
	/** World-space outward normal, oriented away from the car's own COM. */
	hullNormalX: 0,
	hullNormalY: 1,
	hullNormalZ: 0,
	/** The same contact point/normal in BODY-LOCAL space — what `DebugRig`
	 *  actually draws with, since it is mounted inside the RigidBody's own
	 *  Object3D (world-unit body space). */
	hullLocalX: 0,
	hullLocalY: 0,
	hullLocalZ: 0,
	hullNormalLocalX: 0,
	hullNormalLocalY: 1,
	hullNormalLocalZ: 0,
	/** m/s of normal velocity killed THIS STEP, summed across every manifold —
	 *  the hit severity a rising edge is tested against. */
	hullHitDv: 0,
	/** s remaining on a HIT flash — counts down like `perfectLaunch`, set on a
	 *  rising Δv spike. Read by the rig to flash the hull white-hot. */
	hullHitFlash: 0,
	/** m/s the contact patch is sliding along the surface this step — the
	 *  SCRATCH signal (a barrier scrape, not an arrival). */
	hullSlideMs: 0
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

/**
 * The DEBUG panel's reactive view — the same 30 Hz mirror discipline as `carHud`,
 * for the numbers the debug rig draws as geometry. Separate object, and PUBLISHED
 * ONLY WHILE THE RIG IS UP (`carView.mode !== 'model'`): it is roughly twice the
 * field count of the cluster's, all of it invisible in normal play, and a $state
 * write nobody reads is still an invalidation. The panel that reads it
 * (TestGameHud) is mounted on the same condition, so the gate and the consumer
 * can't drift apart.
 *
 * Per-corner arrays are FL, FR, RL, RR — the `wheelPatches` order, everywhere.
 */
export const carDebugHud = $state({
	/** 'rwd' | 'fwd' | 'awd' — constant, but the panel names the driveline it is
	 *  explaining and nothing else in the HUD carries it. */
	layout: currentCar().layout as string,
	/** N along the nose. */
	driveForce: 0,
	resistForce: 0,
	/** g — the model's own longitudinal and lateral accelerations. */
	accelFwd: 0,
	accelLat: 0,
	/** m/s along body +X. */
	velLat: 0,
	/** °/s. */
	yawRate: 0,
	/** m/s — driven contact-patch overspeed. */
	spin: 0,
	/** 0..1. */
	slip: 0,
	powerLoad: 0,
	gripFactor: 0,
	latLoad: 0,
	loose: 0,
	clutch: 0,
	/** The live lateral μ, and the tyre's full one for comparison. */
	muLat: 0,
	/** N (world force units) — total upward force the four springs handed Rapier. */
	springForce: 0,
	/** Per corner: PHYSICAL compression 0..1, and whether the ray found ground. */
	load: [0, 0, 0, 0],
	grounded: [false, false, false, false],
	/** The chassis hull vs. the world — see `carSim`'s own hull* fields. */
	hullContact: false,
	hullHitDv: 0,
	hullSlideMs: 0
});

const HUD_INTERVAL = 1 / 30;
let elapsed = 0;

/**
 * Push `carSim` into `carHud` at most 30×/s, only where a shown value changed.
 *
 * `suspension` is optional and only exists for the debug mirror — the four
 * springs' state lives on the controller's instance rather than in `carSim`
 * (the rig reads that instance directly; only the HUD, a sibling tree that can
 * reach neither, needs it mirrored). Callers that have it should pass it; the
 * shape of the cluster's feed is unchanged either way.
 */
export function publishCarHud(dt: number, suspension?: Suspension): void {
	elapsed += dt;
	if (elapsed < HUD_INTERVAL) return;
	elapsed = 0;

	if (suspension && carView.mode !== 'model') publishDebug(suspension);

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

/** Round to `places` decimals — the debug panel's quantiser. Coarser than the
 *  raw value on purpose: a field that re-renders on the 4th decimal is a field
 *  nobody can read, and every write is an invalidation. */
const q = (v: number, places: number): number => {
	const f = 10 ** places;
	return Math.round(v * f) / f;
};

/** The debug mirror's half of the 30 Hz publish. Called from `publishCarHud`
 *  above, never on its own — one accumulator, so the two mirrors stay in step. */
function publishDebug(suspension: Suspension): void {
	const d = carDebugHud;
	const driveForce = Math.round(carSim.driveForce);
	if (d.driveForce !== driveForce) d.driveForce = driveForce;
	const resistForce = Math.round(carSim.resistForce);
	if (d.resistForce !== resistForce) d.resistForce = resistForce;
	const accelFwd = q(carSim.accelFwd / G, 2);
	if (d.accelFwd !== accelFwd) d.accelFwd = accelFwd;
	const accelLat = q(carSim.accelLat / G, 2);
	if (d.accelLat !== accelLat) d.accelLat = accelLat;
	const velLat = q(carSim.velLat, 2);
	if (d.velLat !== velLat) d.velLat = velLat;
	const yawRate = q(carSim.yawRate * (180 / Math.PI), 1);
	if (d.yawRate !== yawRate) d.yawRate = yawRate;
	const spin = q(carSim.spin, 2);
	if (d.spin !== spin) d.spin = spin;
	const slip = q(carSim.slip, 2);
	if (d.slip !== slip) d.slip = slip;
	const powerLoad = q(carSim.powerLoad, 2);
	if (d.powerLoad !== powerLoad) d.powerLoad = powerLoad;
	const gripFactor = q(carSim.gripFactor, 2);
	if (d.gripFactor !== gripFactor) d.gripFactor = gripFactor;
	const latLoad = q(carSim.latLoad, 2);
	if (d.latLoad !== latLoad) d.latLoad = latLoad;
	const loose = q(carSim.loose, 2);
	if (d.loose !== loose) d.loose = loose;
	const clutch = q(carSim.clutch, 2);
	if (d.clutch !== clutch) d.clutch = clutch;
	const muLat = q(carSim.muLat, 2);
	if (d.muLat !== muLat) d.muLat = muLat;
	const springForce = Math.round(suspension.force);
	if (d.springForce !== springForce) d.springForce = springForce;
	if (d.hullContact !== carSim.hullContact) d.hullContact = carSim.hullContact;
	const hullHitDv = q(carSim.hullHitDv, 2);
	if (d.hullHitDv !== hullHitDv) d.hullHitDv = hullHitDv;
	const hullSlideMs = q(carSim.hullSlideMs, 2);
	if (d.hullSlideMs !== hullSlideMs) d.hullSlideMs = hullSlideMs;
	for (let i = 0; i < 4; i++) {
		const load = q(suspension.loadRatio(i), 2);
		if (d.load[i] !== load) d.load[i] = load;
		if (d.grounded[i] !== suspension.grounded[i]) d.grounded[i] = suspension.grounded[i];
	}
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
	carSim.accelFwd = 0;
	carSim.accelLat = 0;
	carSim.spin = 0;
	carSim.velLat = 0;
	carSim.yawRate = 0;
	carSim.driveForce = 0;
	carSim.resistForce = 0;
	carSim.powerLoad = 0;
	carSim.gripFactor = 0;
	carSim.loose = 0;
	carSim.muLat = 0;
	carSim.clutch = 1;
	carSim.hullContact = false;
	carSim.hullContactX = 0;
	carSim.hullContactY = 0;
	carSim.hullContactZ = 0;
	carSim.hullNormalX = 0;
	carSim.hullNormalY = 1;
	carSim.hullNormalZ = 0;
	carSim.hullLocalX = 0;
	carSim.hullLocalY = 0;
	carSim.hullLocalZ = 0;
	carSim.hullNormalLocalX = 0;
	carSim.hullNormalLocalY = 1;
	carSim.hullNormalLocalZ = 0;
	carSim.hullHitDv = 0;
	carSim.hullHitFlash = 0;
	carSim.hullSlideMs = 0;
	elapsed = HUD_INTERVAL;
	publishCarHud(0);
	// The debug mirror has no `suspension` to publish from here (the controller
	// is being torn down), so it is parked directly — otherwise the panel still
	// reads the last corner loads on the way back into the scene.
	const d = carDebugHud;
	d.driveForce = 0;
	d.resistForce = 0;
	d.accelFwd = 0;
	d.accelLat = 0;
	d.velLat = 0;
	d.yawRate = 0;
	d.spin = 0;
	d.slip = 0;
	d.powerLoad = 0;
	d.gripFactor = 0;
	d.latLoad = 0;
	d.loose = 0;
	d.clutch = 0;
	d.muLat = 0;
	d.springForce = 0;
	d.hullContact = false;
	d.hullHitDv = 0;
	d.hullSlideMs = 0;
	for (let i = 0; i < 4; i++) {
		d.load[i] = 0;
		d.grounded[i] = false;
	}
}
