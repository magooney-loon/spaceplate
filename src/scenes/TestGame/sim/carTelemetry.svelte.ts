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
import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat';

/** Written every physics step. Read by CarWheels and the mirror below — never by the HUD. */
export const carSim = {
	/** Signed road speed along the nose, m/s (real metres — not world units). */
	speedMs: 0,
	// `as number`: the spec is `as const`, so a bare `idleRpm` would type this
	// field as the literal 800 and reject every reading the engine ever produces.
	rpm: currentCar().hardware.idleRpm as number,
	/** -1 reverse, 0 neutral, 1…6. Starts in N, like the drivetrain itself. */
	gear: 0,
	/** Rises by one on every gear ENGAGEMENT — Q/E taps, the automatic's own
	 * shifts and its stopped drop-to-1st alike, since they all run through the
	 * drivetrain's engage(). A SEQ, not a copy of the drivetrain's one-step
	 * `shifted` flag: physics substeps several times per audio tick (see
	 * `hullHitSeq`), so a boolean set in substep 1 is already gone by the frame's
	 * tick — consumers edge-detect the seq instead. Monotonic on purpose: never
	 * reset, so park/detach can sync their edge state to it. */
	shiftSeq: 0,
	/** 0…1 wheelspin. */
	slip: 0,
	/** Steering rack, -1…1, left-positive — the fraction of lock the rack is at. */
	steer: 0,
	/** rad — `steer` × the car's own full lock (the tune's `maxSteerAngle`).
	 *  CarWheels renders this rather than re-deriving it — full lock is a
	 *  per-car number and the visual lock has to be the one the physics
	 *  steered at. */
	steerAngle: 0,
	/** rad — slip angle at the CG: the angle between where the nose points and where
	 *  the car is actually going. Positive = travelling to the car's RIGHT, i.e. the
	 *  tail is out in a left-hand slide. Zero when planted; a drift IS a big held
	 *  value here — how much of one a car can hold is its tune's business. */
	drift: 0,
	/** 0..1 — share of the lateral grip budget the current corner demands: the
	 *  sideways-bleed demand over the μ·g cap it's clamped to (controller.ts).
	 *  Pins at 1 exactly at max banking (v·ω = μ·g at the yaw cap), sits well under
	 *  it in a normal corner. The tyre-squeal driver reads this (carAudio): a
	 *  planted limit cornering lights no drift angle and no TC lamp — the load
	 *  itself is the only honest squeal signal. */
	latLoad: 0,
	/** 0..1 per axle — how much of it is on the ground (the suspension rays,
	 *  smoothed in sim/controller.ts). The tyres' grip scales by it, and so do
	 *  the tyre fx and the squeal: nothing smokes or screams in the air. */
	contactFront: 1,
	contactRear: 1,
	throttle: 0,
	brake: 0,
	handbrake: false,
	limiting: false,
	/** 0..1 — nitrous FLOW right now (ramped in the controller's task, not raw
	 *  key state). Read by CarExhaustFlames to tint the flames blue and hold the
	 *  pilot jet while the system sprays. */
	nitrous: 0,
	/** 0..1 — bottle level. Drains while spraying, regenerates otherwise. */
	nitrousTank: 1,
	/** 0..1 — nitrous PURGE flow: the pedal held with the spray gate shut
	 *  (no throttle, or N/R — the standstill hiss out of the hood's vents;
	 *  the controller's `purging`). Read by fx/NitrousPurge for the cryo
	 *  plume; carAudio rides it onto the drain loop's hiss. */
	nitrousPurge: 0,
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

	// ── Car pose (world) ────────────────────────────────────────────────────────
	/** The chassis body's world pose — translation + rotation as a quaternion,
	 *  written every physics step by `publishCarPose` (plain fields, no $state:
	 *  the same contract as the rest of this object). For world-anchored fx that
	 *  must test against the car's VOLUME: `fx/CarImpacts.svelte` bounces its
	 *  sparks off the hull bounds placed at this pose, so debris fired back into
	 *  the body ricochets off it instead of streaking through the paint. */
	bodyX: 0,
	bodyY: 0,
	bodyZ: 0,
	bodyQuatX: 0,
	bodyQuatY: 0,
	bodyQuatZ: 0,
	bodyQuatW: 1,

	// ── The debug feed ────────────────────────────────────────────────────────
	// Everything below exists because `debug/DebugRig.svelte` draws it and the
	// HUD's debug panel prints it. The driving model computed all of it already —
	// these are publishes, not new physics — but each is a number the rig would
	// otherwise have had to GUESS at, and a rig that guesses is a rig that lies.
	// (The rig's wheel roll used to fake wheelspin as `speedMs × (1 + slip·0.8)`;
	// `spin` below is the real overspeed the drivetrain integrated.)

	/** m/s — how much faster the DRIVEN contact patch is running than the road,
	 *  signed along the nose (drivetrain `state.spin`). The rig AND the car's own
	 *  wheels (fx/CarWheels) roll the driven axle at `speedMs + spin` and the
	 *  undriven one at `speedMs`, which is the whole "which wheels are turning"
	 *  reading — one feed, so the skeleton and the model cannot disagree. */
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
	/** World-unit contact point of the DEEPEST manifold this step — meaningless
	 *  while `hullContact` is false. */
	hullContactX: 0,
	hullContactY: 0,
	hullContactZ: 0,
	/** World-space contact normal, oriented from the contact point TOWARD the
	 *  car's own COM — i.e. away from the contacted surface and INTO the body
	 *  (the sign `hullContacts.ts`'s closing-speed read needs; the file orients
	 *  it there deliberately). A consumer that wants "out of the car" must flip
	 *  it — `fx/CarImpacts.svelte` does exactly that. */
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
	/** m/s of closing speed into the surface this step (the deepest manifold) —
	 *  the hit severity a rising edge is tested against. */
	hullHitDv: 0,
	/** s remaining on a HIT flash — counts down like `perfectLaunch`, set on a
	 *  rising Δv spike. Read by the rig to flash the hull white-hot. */
	hullHitFlash: 0,
	/** Increments once per real HIT (the rising edge) — the one-shot signal a
	 *  consumer (`fx/CarImpacts.svelte`) polls for, since `hullHitFlash` alone
	 *  can't tell "still decaying from the last hit" from "a fresh one just
	 *  landed". */
	hullHitSeq: 0,
	/** m/s the contact patch is sliding along the surface this step, and the
	 *  WORLD-SPACE unit direction it's sliding in — the SCRATCH signal (a
	 *  barrier scrape, not an arrival). Direction is meaningless at 0 speed. */
	hullSlideMs: 0,
	hullSlideDirX: 0,
	hullSlideDirY: 0,
	hullSlideDirZ: 0
};

/**
 * The parked feed — snapshotted at module load, BEFORE anything has written to
 * it, so `resetCarTelemetry` restores the list this object declares rather than a
 * second hand-maintained copy of it. That copy is what `carDebugHud.layout` was
 * missing from, and the failure mode is silent: a field added above and forgotten
 * below simply carries the last car's reading back into the next mount.
 *
 * Two fields are restored from somewhere else instead, at the call site: `rpm`
 * (the snapshot froze the FIRST car's idle, and a reset happens across a car
 * SWITCH) and the two monotonic seqs (see their own docs — consumers sync their
 * edge state to them, so a reset must never rewind one).
 */
const CAR_SIM_DEFAULTS = { ...carSim };

/** The HUD's reactive view. Quantised, ~30 Hz. */
export const carHud = $state({
	kmh: 0,
	mph: 0,
	// `as number`: the spec is `as const`, so a bare `idleRpm` would type this
	// field as the literal 800 and reject every reading the engine ever produces.
	rpm: currentCar().hardware.idleRpm as number,
	gear: 0,
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
	launchTier: 0,
	/** THE MINIMAP'S FEED — the body's world XZ and its yaw in whole degrees.
	 *  The HUD cannot read `carSim.body*` (one invalidation per field per
	 *  physics step), and on a map the size of a coaster the 0.5-unit buckets
	 *  below are a fifth of a pixel. Yaw is the BODY's, in world degrees about
	 *  +Y; turning it into an SVG rotation is the marker's job, not the
	 *  telemetry's. */
	mapX: 0,
	mapZ: 0,
	mapYaw: 0
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
	hullSlideMs: 0,
	/** World-unit position, straight off `carSim.body*` — the same numbers the
	 *  minimap buckets, at debug precision instead of half-a-unit. */
	posX: 0,
	posY: 0,
	posZ: 0
});

/** The debug mirror's parked values, same snapshot-at-load trick as
 *  `CAR_SIM_DEFAULTS`. `load` and `grounded` come back out again because they are
 *  ARRAYS: handing the same two back on every reset would let `publishDebug`
 *  write through into the defaults. They are zeroed element-wise instead. */
const { load: _load, grounded: _grounded, ...CAR_DEBUG_DEFAULTS } = { ...carDebugHud };

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

	// The minimap's pose. Half-unit position buckets (~0.2 m) and whole-degree
	// yaw, so a parked car writes nothing at all. The body's pitch and roll are
	// LOCKED (`enabledRotations` leaves only yaw), which is what makes the yaw
	// exact from two quaternion components instead of a matrix decomposition.
	const mapX = Math.round(carSim.bodyX * 2) / 2;
	const mapZ = Math.round(carSim.bodyZ * 2) / 2;
	const mapYaw = Math.round(2 * Math.atan2(carSim.bodyQuatY, carSim.bodyQuatW) * (180 / Math.PI));
	if (carHud.mapX !== mapX) carHud.mapX = mapX;
	if (carHud.mapZ !== mapZ) carHud.mapZ = mapZ;
	if (carHud.mapYaw !== mapYaw) carHud.mapYaw = mapYaw;
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
	// The driveline the panel is NAMING. Constant for a mount, but this module is
	// a singleton and the Garage switches cars under it, so the value is re-read
	// rather than kept from whichever car happened to boot first — which is
	// exactly what it used to do, labelling the AWD RS3 'RWD' for the whole
	// session. An object lookup at 30 Hz, and only while the rig is up.
	const layout = currentCar().layout as string;
	if (d.layout !== layout) d.layout = layout;
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
	const posX = q(carSim.bodyX, 2);
	if (d.posX !== posX) d.posX = posX;
	const posY = q(carSim.bodyY, 2);
	if (d.posY !== posY) d.posY = posY;
	const posZ = q(carSim.bodyZ, 2);
	if (d.posZ !== posZ) d.posZ = posZ;
	for (let i = 0; i < 4; i++) {
		const load = q(suspension.loadRatio(i), 2);
		if (d.load[i] !== load) d.load[i] = load;
		if (d.grounded[i] !== suspension.grounded[i]) d.grounded[i] = suspension.grounded[i];
	}
}

/** The pose half of the feed — the chassis body's world translation and
 *  rotation, straight off Rapier, written onto `carSim` every physics step from
 *  PlayerCar.svelte's own task (right after `pollHullContacts`, so pose and hull
 *  contact describe the same step). Out-param scratch for the translation —
 *  `worldCom`'s own zero-allocation pattern; `rotation()` mirrors
 *  hullContacts.ts and takes the small allocation instead. */
const _poseT = { x: 0, y: 0, z: 0 };
export function publishCarPose(body: RapierRigidBody): void {
	const t = body.translation(_poseT);
	const r = body.rotation();
	carSim.bodyX = t.x;
	carSim.bodyY = t.y;
	carSim.bodyZ = t.z;
	carSim.bodyQuatX = r.x;
	carSim.bodyQuatY = r.y;
	carSim.bodyQuatZ = r.z;
	carSim.bodyQuatW = r.w;
}

/**
 * Park the instruments — used when the scene stops driving (scene switch, blur).
 *
 * Both mirrors are restored from the defaults snapshotted at module load, so
 * this cannot fall out of step with the field lists above the way a second
 * hand-written copy of them did. The exceptions are all named explicitly.
 */
export function resetCarTelemetry(): void {
	// The seqs are MONOTONIC by contract — consumers sync their edge state to
	// them, so a reset reads them back rather than rewinding them. `rpm` and
	// `nitrousTank` come from the car rather than the snapshot: a reset happens
	// across a car SWITCH, and the bottle refills on exit to match the fresh
	// component state the next mount starts with (which is what the snapshot
	// holds anyway — it is restated here because it is a decision, not a zero).
	const { shiftSeq, hullHitSeq } = carSim;
	Object.assign(carSim, CAR_SIM_DEFAULTS, {
		rpm: currentCar().hardware.idleRpm,
		nitrousTank: 1,
		shiftSeq,
		hullHitSeq
	});
	elapsed = HUD_INTERVAL;
	publishCarHud(0);

	// The debug mirror has no `suspension` to publish from here (the controller
	// is being torn down), so it is parked directly — otherwise the panel still
	// reads the last corner loads on the way back into the scene. `layout` is
	// re-read from the car for the same reason `publishDebug` does it: the next
	// mount may be a different driveline.
	Object.assign(carDebugHud, CAR_DEBUG_DEFAULTS, { layout: currentCar().layout as string });
	for (let i = 0; i < 4; i++) {
		carDebugHud.load[i] = 0;
		carDebugHud.grounded[i] = false;
	}
}
