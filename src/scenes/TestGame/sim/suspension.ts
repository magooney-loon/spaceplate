// The suspension — ONE owner for the car's body attitude, shared by the debug
// rig (debug/DebugRig.svelte), the car MODEL (TestGame.svelte writes the visual
// group's pose) and the wheels (fx/CarWheels.svelte adds the travel). It used to
// live inside DebugRig, which meant the skeleton leaned and the car it was drawn
// over did not.
//
// VISUAL ONLY. This produces no forces and touches no rigid body: the chassis is
// one dynamic box with `enabledRotations={[false, true, false]}`, so the PHYSICS
// car cannot pitch or roll at all. What the player sees lean is the model, and
// what makes it lean is the load transfer the driving model is already applying.
// Nothing here feeds back — read the numbers, draw the attitude.
//
// ── The input is the model's own acceleration, not a measurement ─────────────
// `carSim.accelFwd` / `accelLat` are written by the controller from the force it
// hands Rapier and the sideways delta-v it applies (sim/controller.ts). The
// earlier version finite-differenced the body's interpolated world pose twice
// per frame and needed a one-pole just to be readable; this is exact, noiseless,
// free, and available a frame earlier. It also inherits the grip model's clamp
// for free: `accelLat` saturates at μ·g, so a car already sliding at the limit
// stops leaning harder — which is correct, and is not something a differenced
// pose would have told us.
//
// ── The four corners are the state, the pose is derived ─────────────────────
// Each corner runs a real SPRING-DAMPER toward its load-transfer target rather
// than a one-pole toward it. That is the difference between the body arriving at
// an attitude and the body MOVING to one: stab the brakes and the nose dives,
// overshoots slightly and settles, and a flick left-right rocks. `SPRING_ZETA`
// under 1 is what buys the overshoot; at 1 it is a soft slide into place, over 1
// it is mush. Semi-implicit Euler (velocity first, then position) — stable well
// past any frame rate the renderer will produce, and `delta` is clamped so a
// backgrounded tab doesn't return to a car mid-pogo.
//
// Corner compressions convert to heave/pitch/roll over the car's REAL lever
// arms, which is what keeps the numbers honest without a second feel constant.
// Measured on this math: 1.6° nose-down at 0.8 g of braking, 1.2° nose-up under
// acceleration, ~4.5° of roll at the cornering limit, hard-stopped at 3.1° and
// 5.2° — a road car's order of magnitude, and a GR86 really does roll 3-4° at
// max lateral. THE COMPRESSION MOVES THE BODY, NOT THE WHEELS: the
// wheels are on the road (they are the contact balls), so `travel` is the
// counter-offset that keeps them there while the body moves around them,
// measured off the attitude matrix itself rather than assumed.

import * as THREE from 'three/webgpu';
import { currentCar } from '../cars';
import { wheelPatches } from '../cars/spec';
import { G, UNITS_PER_METER } from '../units';
import { carSim } from './carTelemetry.svelte';
import { clamp } from './carMath';

const spec = currentCar();
const UPM = UNITS_PER_METER;

/** Wheel patches [x, z] in world-unit body space; index 0/2 are the −x side. */
const patches = wheelPatches(spec);
/** Hub height in world units — the contact balls' centre, and the rest line. */
const HUB_Y = spec.geometry.hubY * UPM;
/** The two lever arms the corner compressions become an attitude over. */
const WHEELBASE = patches[2][1] - patches[0][1];
const HALF_TRACK = Math.abs(patches[0][0]);

/** Travel limits (world units). There is no physical suspension to match, so
 *  these are what keeps the gauge honest: droop is short, compression longer. */
const COMP_MIN = -0.05 * UPM;
const COMP_MAX = 0.11 * UPM;
/** How far a corner moves per g of load transfer. The feel knob. */
const SQUAT_PER_G = 0.045 * UPM;
/** Spring rate (1/s²) and damping ratio. ζ < 1 so the body overshoots and
 *  settles — the bob is the whole point of using a spring here. */
const SPRING_K = 60;
const SPRING_ZETA = 0.62;
const SPRING_C = 2 * Math.sqrt(SPRING_K) * SPRING_ZETA;
/** Overshoot is allowed past the target clamp, but not indefinitely. */
const COMP_HARD_MIN = COMP_MIN * 1.6;
const COMP_HARD_MAX = COMP_MAX * 1.6;
/** s — a render delta longer than this is a tab-switch, not a slow frame. */
const MAX_STEP = 1 / 30;
/** World units — below this the pose has not visibly moved. */
const MOVED_EPS = 1e-5;

/**
 * The body attitude, recomputed once per frame by `updateSuspension`. Plain
 * object, not `$state`: one writer, and every consumer reads it from its own
 * render-stage task (the `carSim` / sky-descriptor pattern).
 */
export const suspension = {
	/** Per-corner compression in world units, + = loaded. Order is `wheelPatches`. */
	comp: [0, 0, 0, 0],
	/** Body drop in world units, + = down. */
	heave: 0,
	/** rad about body +X. + = tail down / nose up (accelerating). */
	pitch: 0,
	/** rad about body +Z. + = right side down (a left-hand corner). */
	roll: 0,
	/** Per-corner wheel offset in world units that keeps the tyre on the road
	 *  while the body moves around it — i.e. the negated body displacement at
	 *  that patch. Add it to the wheel's y in body space. */
	travel: [0, 0, 0, 0],
	/** The attitude as a body-space transform about the body origin (road
	 *  level): `T(0, -heave, 0) · R(pitch, 0, roll)`. What the visual group and
	 *  the rig's chassis are posed with, so they cannot disagree. */
	matrix: new THREE.Matrix4(),
	/** Did the pose move this frame? The one `invalidate()` gate. */
	moved: false
};

/** Corner velocities (world units/s) — the spring's other half. */
const vel = [0, 0, 0, 0];

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _hub = new THREE.Vector3();

/**
 * Advance the springs and rebuild the pose. Call ONCE per rendered frame, from a
 * `{ before: autoRenderTask }` task — the scene's own (TestGame.svelte), which
 * registers before its children so everything downstream reads a fresh pose in
 * the same frame. Never from a physics task: this is pixels, not simulation, and
 * the substep count per frame is never constant (the CarWheels rule).
 */
export function updateSuspension(delta: number): void {
	const dt = Math.min(delta, MAX_STEP);
	if (dt <= 0) return;

	// Load transfer in g. Longitudinal loads the rear under power (patch z > 0)
	// and the front under braking; lateral loads the OUTSIDE, so the sign is
	// flipped against +X (which is the car's left).
	const gLong = carSim.accelFwd / G;
	const gLat = carSim.accelLat / G;

	let biggestMove = 0;
	for (let i = 0; i < 4; i++) {
		const target = clamp(
			gLong * SQUAT_PER_G * (patches[i][1] > 0 ? 1 : -1) -
				gLat * SQUAT_PER_G * (patches[i][0] > 0 ? 1 : -1),
			COMP_MIN,
			COMP_MAX
		);
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

	// The wheels are the contact balls: they do not move, the body moves around
	// them. Measured off the matrix rather than assumed equal to `comp`, so the
	// warp the attitude dropped above cannot float a tyre.
	for (let i = 0; i < 4; i++) {
		_hub.set(patches[i][0], HUB_Y, patches[i][1]).applyMatrix4(suspension.matrix);
		suspension.travel[i] = HUB_Y - _hub.y;
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

/** Park the springs — scene exit and Restart, so the next mount starts level. */
export function resetSuspension(): void {
	for (let i = 0; i < 4; i++) {
		suspension.comp[i] = 0;
		suspension.travel[i] = 0;
		vel[i] = 0;
	}
	suspension.heave = 0;
	suspension.pitch = 0;
	suspension.roll = 0;
	suspension.matrix.identity();
	suspension.moved = false;
}
