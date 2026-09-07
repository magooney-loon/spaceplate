// The suspension — FOUR RAYCAST SPRINGS, and the one owner of the car's ride
// height and body attitude. Two halves that must not be confused:
//
//   PHYSICS (`stepSuspension`, physics rate, from sim/controller.ts) — casts a
//   ray down at each wheel patch, turns the four compressions into ONE vertical
//   force and hands it to Rapier. This is what the car stands on. It replaced
//   four rigid ball colliders, and the reason is the kerbs: a ball is an
//   infinitely stiff spring, so a 3 cm lip under one wheel had to lift the whole
//   car 3 cm inside a single step, and with pitch and roll LOCKED there was no
//   corner free to absorb it. A spring takes ~0.2 s over the same lip. Rays also
//   cannot generate a ghost contact at a trimesh's internal edges, which is the
//   other half of the "snags on nothing" class of bug.
//
//   VISUAL (`updateSuspension`, render rate, from TestGame.svelte) — the body
//   attitude the model, the wheels and the debug rig are all posed with.
//
// ── Why the force is a SUM and the lean is a fake ────────────────────────────
// `enabledRotations={[false, true, false]}` leaves only yaw free, so a force
// applied at a corner contributes its share of the lift and its torque is
// DISCARDED. Four corner springs therefore buy exactly one thing physically —
// heave — and that is the half that matters for smoothness. The pitch and roll
// are synthesised here from two sources the body cannot express itself:
//   · LOAD TRANSFER, from the driving model's own accelerations (`carSim.accelFwd`
//     / `accelLat` — the force the controller hands Rapier over the mass, and the
//     sideways delta-v the grip model applied over the step; exact and noiseless,
//     where finite-differencing the interpolated pose needed a filter to be
//     readable, and `accelLat` inherits the grip clamp so a car already sliding
//     at μ·g stops leaning harder);
//   · ROAD FOLLOW, from how much further the ground is under each wheel than
//     under the others. This is what makes a kerb ROLL the car onto it instead of
//     jolting it, and what leans the body on camber.
// The two are summed into one per-corner target and chased by a spring-damper —
// so the visual body MOVES to an attitude rather than arriving at one. ζ < 1
// buys the overshoot; at 1 it is a soft slide into place, over 1 it is mush.
//
// ── THE COMPRESSION MOVES THE BODY, NOT THE WHEELS ──────────────────────────
// Getting this backwards is the bug the whole file came out of: the rig dived
// under power, squatted under braking and leaned INTO its corners. The corner
// numbers were right; the wrong END of the strut was moving. Wheels sit where
// their ray says the ground is (`wheelY`); the body moves around them, and
// `travel` is the per-corner offset that reconciles the two — measured off the
// attitude matrix, not assumed equal to the compression.
//
// Nothing here reads a rendered object or writes one. The physics half only ever
// adds a force; the visual half only ever produces numbers.

import * as THREE from 'three/webgpu';
import { Ray, type RigidBody as RapierRigidBody, type World } from '@dimforge/rapier3d-compat';
import { currentCar } from '../cars';
import { wheelPatches } from '../cars/spec';
import { G, UNITS_PER_METER } from '../units';
import { carSim } from './carTelemetry.svelte';
import { clamp } from './carMath';

const spec = currentCar();
const UPM = UNITS_PER_METER;

/** Wheel patches [x, z] in world-unit body space; index 0/2 are the −x side. */
const patches = wheelPatches(spec);
/** Hub height at rest, world units. */
const HUB_Y = spec.geometry.hubY * UPM;
/** Tyre radius, world units. */
const R = spec.model.wheelRadiusFallback * UPM;
/** The two lever arms the corner compressions become an attitude over. */
const WHEELBASE = patches[2][1] - patches[0][1];
const HALF_TRACK = Math.abs(patches[0][0]);

// ── Ray geometry (world units) ──────────────────────────────────────────────
// The ray starts ABOVE the hub, not at it: at full compression the hub itself
// can end up level with or under a kerb lip, and a ray that starts inside
// geometry reports a garbage distance. The headroom costs nothing.
const RAY_UP = 0.5;
const RAY_ORIGIN_Y = HUB_Y + RAY_UP;
/** Ray length at the wheel's rest position — what "no sag" would measure. */
const UNSPRUNG_DIST = RAY_UP + R;
/**
 * Static spring deflection. This is the ONE knob for ride softness: the natural
 * frequency is `sqrt(g / REST_SAG)`, so bigger = softer = more kerb absorbed,
 * at the cost of using up the 0.32 of clearance under the undertray sooner.
 * 0.18 puts a stiff-sports-car ~3 Hz on this world's gravity.
 */
const REST_SAG = 0.18;
/**
 * Ray distance at which the spring is exactly slack. Because the sag is built
 * INTO it, equilibrium lands at `UNSPRUNG_DIST` — i.e. the hub exactly one tyre
 * radius above the road, which is the ride height the ball colliders used to
 * hold. Swapping the contact model did not move the car.
 */
const REST_DIST = UNSPRUNG_DIST + REST_SAG;
/** How far a wheel may hang below rest before it counts as airborne. */
const DROOP = 0.3;
const MAX_TOI = UNSPRUNG_DIST + DROOP;
/**
 * Force saturation. The undertray box's bottom sits 0.32 above the road at rest
 * (spec `mountY` − `hy`·UPM − ride height), so beyond this the BOX takes over as
 * the bump stop — which is what an undertray is for, and is why it stays a
 * collider now that the wheels are not.
 */
const MAX_COMP = 0.44;
/** How far a wheel may be pushed UP into the arch before the visual gives up. */
const MAX_LIFT = 0.35;
/** Damping ratio of the physical spring. Cars run soft; this is stability-first. */
const DAMP_ZETA = 0.55;

// ── Visual constants (world units) ──────────────────────────────────────────
/** Load-transfer travel limits — droop is short, compression longer. */
const COMP_MIN = -0.05 * UPM;
const COMP_MAX = 0.11 * UPM;
/** Body movement per g of load transfer. The lean feel knob. */
const SQUAT_PER_G = 0.045 * UPM;
/**
 * How much of the road's per-corner height difference the body follows, and the
 * cap on it. 1.0 is a body that tracks camber exactly; the cap stops a kerb
 * strike or a wall of a hit from throwing the model at an angle the car never
 * reaches. ~0.3 is 4.4° of roll.
 */
const ROAD_FOLLOW = 1;
const ROAD_MAX = 0.3;
/** Visual spring: rate (1/s²) and damping ratio. ζ < 1 so the body bobs. */
const SPRING_K = 60;
const SPRING_ZETA = 0.62;
const SPRING_C = 2 * Math.sqrt(SPRING_K) * SPRING_ZETA;
/** Overshoot past the target clamp is allowed, but not indefinitely. */
const COMP_HARD_MIN = (COMP_MIN - ROAD_MAX) * 1.6;
const COMP_HARD_MAX = (COMP_MAX + ROAD_MAX) * 1.6;
/** s — a render delta longer than this is a tab-switch, not a slow frame. */
const MAX_STEP = 1 / 30;
/** World units — below this the pose has not visibly moved. */
const MOVED_EPS = 1e-5;

/**
 * The suspension's state. Plain object, not `$state`: one writer per half, and
 * every consumer reads it from its own task (the `carSim` / sky-descriptor
 * pattern).
 */
export const suspension = {
	// ── Written by the PHYSICS half ──────────────────────────────────────────
	/** Ray distance per corner, world units. `MAX_TOI` when airborne. */
	hitDist: [MAX_TOI, MAX_TOI, MAX_TOI, MAX_TOI],
	/** Is that corner's ray finding ground at all? */
	grounded: [false, false, false, false],
	/** Physical spring compression per corner, world units, ≥ 0. */
	load: [0, 0, 0, 0],
	/** Total upward force handed to Rapier last step (world force units). */
	force: 0,

	// ── Written by the VISUAL half ───────────────────────────────────────────
	/** Per-corner body displacement, world units, + = that corner moved DOWN. */
	comp: [0, 0, 0, 0],
	/** Body drop in world units, + = down. */
	heave: 0,
	/** rad about body +X. + = tail down / nose up (accelerating). */
	pitch: 0,
	/** rad about body +Z. + = right side down (a left-hand corner). */
	roll: 0,
	/** Wheel-centre height in body space, world units — where the RAY says the
	 *  wheel is. The debug rig places its hubs here. */
	wheelY: [HUB_Y, HUB_Y, HUB_Y, HUB_Y],
	/** Per-corner offset that puts a wheel at `wheelY` once the body's attitude
	 *  has been applied to it. What `CarWheels` adds in its `positionNode`. */
	travel: [0, 0, 0, 0],
	/** The attitude as a body-space transform about the body origin (road
	 *  level): `T(0, -heave, 0) · R(pitch, 0, roll)`. The visual group and the
	 *  rig's chassis are posed with this, so they cannot disagree. */
	matrix: new THREE.Matrix4(),
	/** Did the pose move this frame? The one `invalidate()` gate. */
	moved: false
};

// ── Physics half ────────────────────────────────────────────────────────────

const _ray = new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const _patch = new THREE.Vector3();
const _bodyQ = new THREE.Quaternion();

/**
 * Cast the four rays, apply the summed spring force. Call from the controller's
 * physics step, AFTER its `resetForces` — Rapier accumulates forces until they
 * are cleared, so clearing after this would throw the car's own weight support
 * away. It must run on EVERY path through the step, including the parked and
 * startup early-returns: there are no wheel colliders any more, so a step that
 * skips this is a step the car falls through its own suspension onto the
 * undertray.
 *
 * The ray is straight down in WORLD space, which is also the body's own down —
 * only yaw is free, so the two can never diverge.
 *
 * Takes no `delta`: nothing here is integrated. The spring force is a pure
 * function of the current compression and the body's current vertical velocity,
 * and Rapier does the integrating.
 */
export function stepSuspension(body: RapierRigidBody, world: World): void {
	const t = body.translation();
	const r = body.rotation();
	_bodyQ.set(r.x, r.y, r.z, r.w);
	const vy = body.linvel().y;

	// Rate from the LIVE weight, not a constant: gravity is a Studio knob
	// (`physicsState.gravityY`) and `gravityScale` is the scene's unit bridge, so
	// deriving `k` per step is what keeps the ride height at `REST_SAG` whatever
	// either of them is set to. Four springs share the load.
	const mass = body.mass();
	const weight = mass * -world.gravity.y * body.gravityScale();
	const k = weight / (4 * REST_SAG);
	const c = 2 * DAMP_ZETA * Math.sqrt((k * mass) / 4);

	let total = 0;
	for (let i = 0; i < 4; i++) {
		_patch.set(patches[i][0], RAY_ORIGIN_Y, patches[i][1]).applyQuaternion(_bodyQ);
		_ray.origin.x = t.x + _patch.x;
		_ray.origin.y = t.y + _patch.y;
		_ray.origin.z = t.z + _patch.z;

		// `solid: true` so a ray that does start inside something reports 0 rather
		// than punching through to the far side; the body itself is excluded, or
		// every ray would hit the undertray it starts inside of.
		const hit = world.castRay(_ray, MAX_TOI, true, undefined, undefined, undefined, body);
		const grounded = hit !== null;
		const dist = grounded ? hit.timeOfImpact : MAX_TOI;
		suspension.grounded[i] = grounded;
		suspension.hitDist[i] = dist;

		const load = clamp(REST_DIST - dist, 0, MAX_COMP);
		suspension.load[i] = load;
		if (load <= 0) continue;
		// Damping opposes the BODY's vertical motion, not the compression rate:
		// the road's own rate would mean differentiating a raycast, and a ray that
		// steps across a lip differentiates to a spike. A wheel is unsprung mass
		// this model does not have anyway.
		const f = k * load - c * vy;
		if (f > 0) total += f;
	}

	suspension.force = total;
	if (total > 0) body.addForce({ x: 0, y: total, z: 0 }, true);
}

/** Park the rays — nothing is grounded until the next physics step says so. */
function resetRays(): void {
	for (let i = 0; i < 4; i++) {
		suspension.hitDist[i] = UNSPRUNG_DIST;
		suspension.grounded[i] = false;
		suspension.load[i] = 0;
	}
	suspension.force = 0;
}

// ── Visual half ─────────────────────────────────────────────────────────────

/** Corner velocities (world units/s) — the visual spring's other half. */
const vel = [0, 0, 0, 0];

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _hub = new THREE.Vector3();
const road = [0, 0, 0, 0];

/**
 * Advance the visual springs and rebuild the pose. Call ONCE per rendered frame
 * from a `{ before: autoRenderTask }` task — the scene's own (TestGame.svelte),
 * which registers before its children so everything downstream reads a fresh
 * pose in the same frame. Never from a physics task: this is pixels, not
 * simulation, and the substep count per frame is never constant (the CarWheels
 * rule).
 */
export function updateSuspension(delta: number): void {
	const dt = Math.min(delta, MAX_STEP);
	if (dt <= 0) return;

	// ── Road follow ─────────────────────────────────────────────────────────
	// Only the DEVIATION from the average, because the average is the heave and
	// Rapier has already moved the real body by it — following it here as well
	// would count the same bump twice. An airborne corner contributes nothing:
	// its ray is at full length and would otherwise read as a cliff.
	let sum = 0;
	let n = 0;
	for (let i = 0; i < 4; i++) {
		if (!suspension.grounded[i]) continue;
		sum += suspension.hitDist[i];
		n++;
	}
	const meanDist = n > 0 ? sum / n : UNSPRUNG_DIST;
	for (let i = 0; i < 4; i++) {
		// Ground HIGHER under this wheel → shorter ray → the body rises there, and
		// `comp` is body-DOWN, so the sign falls straight out of the distance.
		road[i] = suspension.grounded[i]
			? clamp(ROAD_FOLLOW * (suspension.hitDist[i] - meanDist), -ROAD_MAX, ROAD_MAX)
			: 0;
	}

	// ── Load transfer ───────────────────────────────────────────────────────
	// Longitudinal loads the rear under power (patch z > 0) and the front under
	// braking; lateral loads the OUTSIDE, so its sign is flipped against +X,
	// which is the car's left.
	const gLong = carSim.accelFwd / G;
	const gLat = carSim.accelLat / G;

	let biggestMove = 0;
	for (let i = 0; i < 4; i++) {
		const transfer = clamp(
			gLong * SQUAT_PER_G * (patches[i][1] > 0 ? 1 : -1) -
				gLat * SQUAT_PER_G * (patches[i][0] > 0 ? 1 : -1),
			COMP_MIN,
			COMP_MAX
		);
		const target = transfer + road[i];
		vel[i] += (SPRING_K * (target - suspension.comp[i]) - SPRING_C * vel[i]) * dt;
		const raw = suspension.comp[i] + vel[i] * dt;
		const next = clamp(raw, COMP_HARD_MIN, COMP_HARD_MAX);
		// A corner on the bump stop has stopped moving — leave the velocity in and
		// it winds up against the stop and fires the body off it on release.
		if (next !== raw) vel[i] = 0;
		const moved = Math.abs(next - suspension.comp[i]);
		if (moved > biggestMove) biggestMove = moved;
		suspension.comp[i] = next;
	}

	// Corners → attitude. The three modes a rigid body can express; the fourth
	// (warp) is what a real chassis absorbs in torsion and is simply dropped.
	// Signs, because getting them backwards is exactly the bug this replaced:
	//   heave — compression brings the body DOWN to meet the hub;
	//   pitch — rotation about +X moves a point at z by −z·θ, so a rear that
	//           compresses more than the front lifts the NOSE. Power → nose up,
	//           brakes → nose down;
	//   roll  — rotation about +Z moves a point at x by +x·φ, and +X is LEFT, so
	//           a compressed right side drops the right. Turn left → lean right,
	//           OUT of the corner and onto the loaded wheels.
	const c = suspension.comp;
	suspension.heave = (c[0] + c[1] + c[2] + c[3]) / 4;
	suspension.pitch = (c[2] + c[3] - c[0] - c[1]) / 2 / WHEELBASE;
	// patches x is +LEFT and index 0/2 carry the negative x, so 0/2 are the RIGHT
	// pair. Read the side off the sign, never off a name.
	suspension.roll = (c[0] + c[2] - c[1] - c[3]) / 2 / (2 * HALF_TRACK);

	_euler.set(suspension.pitch, 0, suspension.roll);
	_quat.setFromEuler(_euler);
	_pos.set(0, -suspension.heave, 0);
	suspension.matrix.compose(_pos, _quat, _one);

	// ── Wheels ──────────────────────────────────────────────────────────────
	// A wheel sits one tyre radius above whatever its ray found — so it climbs a
	// kerb, hangs in a dip and holds full droop in the air. `travel` is then what
	// puts it there once the body's attitude has moved the arch around it,
	// measured off the matrix rather than assumed equal to `comp` (the matrix
	// dropped the warp mode, and an assumption would float a tyre by it).
	for (let i = 0; i < 4; i++) {
		const y = clamp(
			RAY_ORIGIN_Y - suspension.hitDist[i] + R,
			HUB_Y - DROOP,
			HUB_Y + MAX_LIFT
		);
		suspension.wheelY[i] = y;
		_hub.set(patches[i][0], HUB_Y, patches[i][1]).applyMatrix4(suspension.matrix);
		suspension.travel[i] = y - _hub.y;
	}

	suspension.moved = biggestMove > MOVED_EPS;
}

/**
 * Where corner `i` sits in its travel, 0 (full droop) … 1 (full compression).
 * The debug rig's strut tint reads it; the clamp range lives here rather than
 * being re-declared at the consumer, which is how the rig and the model came to
 * disagree in the first place. Overshoot is clamped OUT — the colour is a
 * reading of load, not of the spring's momentary excursion past it.
 */
export function compressionRatio(i: number): number {
	return clamp((suspension.comp[i] - COMP_MIN) / (COMP_MAX - COMP_MIN), 0, 1);
}

/** Park everything — scene exit and Restart, so the next mount starts level. */
export function resetSuspension(): void {
	for (let i = 0; i < 4; i++) {
		suspension.comp[i] = 0;
		suspension.travel[i] = 0;
		suspension.wheelY[i] = HUB_Y;
		vel[i] = 0;
	}
	suspension.heave = 0;
	suspension.pitch = 0;
	suspension.roll = 0;
	suspension.matrix.identity();
	suspension.moved = false;
	resetRays();
}
