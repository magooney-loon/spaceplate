// Four raycast springs: the car's ride height and body attitude, per car
// (`createSuspension(spec)`). Two halves — see CLAUDE.md "The suspension":
// PHYSICS (`step`, physics rate) casts a ray per wheel patch and hands Rapier
// one summed vertical force; VISUAL (`update`, render rate) turns the four
// compressions into the heave/pitch/roll the model, wheels and debug rig are
// posed with. Nothing here reads or writes a rendered object directly.

import * as THREE from 'three/webgpu';
import { Ray, type RigidBody as RapierRigidBody, type World } from '@dimforge/rapier3d-compat';
import type { CarSpec } from '../cars/types';
import { wheelPatches } from '../cars/spec';
import { G, UNITS_PER_METER } from '../units';
import { carSim } from './carTelemetry.svelte';
import { clamp } from './carMath';

export function createSuspension(spec: CarSpec) {
	const UPM = UNITS_PER_METER;
	const s = spec.suspension;

	/** Wheel patches [x, z] in world-unit body space; index 0/2 are the −x side. */
	const patches = wheelPatches(spec);
	/** Hub height at rest, world units. */
	const HUB_Y = spec.geometry.hubY * UPM;
	/** Tyre radius, world units. */
	const R = spec.model.wheelRadiusFallback * UPM;
	/** The two lever arms the corner compressions become an attitude over. */
	const WHEELBASE = patches[2][1] - patches[0][1];
	const HALF_TRACK = Math.abs(patches[0][0]);

	// ── The spec's suspension block, SI → world units ──────────────────────────
	const REST_SAG = s.restSag * UPM;
	const DAMP_ZETA = s.dampZeta;
	const MAX_COMP = s.maxComp * UPM;
	const MAX_LIFT = s.maxLift * UPM;
	const COMP_MIN = s.compMin * UPM;
	const COMP_MAX = s.compMax * UPM;
	const SQUAT_PER_G = s.squatPerG * UPM;
	const ROAD_FOLLOW = s.roadFollow;
	const ROAD_MAX = s.roadMax * UPM;
	const SPRING_K = s.springK;
	const SPRING_ZETA = s.springZeta;
	const SLOPE_MAX = s.slopeMax * UPM;

	// ── Ray geometry (world units) ──────────────────────────────────────────────
	// The ray starts ABOVE the hub, not at it: at full compression the hub itself
	// can end up level with or under a kerb lip, and a ray that starts inside
	// geometry reports a garbage distance. The headroom costs nothing.
	const RAY_UP = 0.5;
	const RAY_ORIGIN_Y = HUB_Y + RAY_UP;
	/** Ray length at the wheel's rest position — what "no sag" would measure. */
	const UNSPRUNG_DIST = RAY_UP + R;
	/**
	 * Ray distance at which the spring is exactly slack. Because the sag is built
	 * INTO it, equilibrium lands at `UNSPRUNG_DIST` — i.e. the hub exactly one tyre
	 * radius above the road, which is the ride height the ball colliders used to
	 * hold. Swapping the contact model did not move the car.
	 */
	const REST_DIST = UNSPRUNG_DIST + REST_SAG;
	/** How far a wheel may hang below rest before it counts as airborne. */
	const DROOP = s.droop * UPM;
	const MAX_TOI = UNSPRUNG_DIST + DROOP;

	// ── Visual constants (world units) ──────────────────────────────────────────
	/** Visual spring damping coefficient, from the spec's ratio. */
	const SPRING_C = 2 * Math.sqrt(SPRING_K) * SPRING_ZETA;
	/** Overshoot past the target clamp is allowed, but not indefinitely. */
	const COMP_HARD_MIN = (COMP_MIN - ROAD_MAX) * 1.6;
	const COMP_HARD_MAX = (COMP_MAX + ROAD_MAX) * 1.6;
	/**
	 * The steepest surface the springs will push ALONG. A spring force aimed at
	 * the ground normal is what makes slopes real (the gravity-along-slope term
	 * falls out of it — see `step`), but a trimesh edge, a barrier face or a kerb
	 * cheek can hand back a near-horizontal normal, and firing 1290 kg along that
	 * is a cannon, not a road. Flatter than 60° is a WALL: the tilt is capped, the
	 * direction kept. The raw normal is still published for the fx (`normal`) —
	 * only the FORCE is capped.
	 */
	const MIN_NORMAL_Y = 0.5;
	/** s — a render delta longer than this is a tab-switch, not a slow frame. */
	const MAX_STEP = 1 / 30;
	/** World units — below this the pose has not visibly moved. */
	const MOVED_EPS = 1e-5;

	/**
	 * The suspension's state, with its two halves' entry points on it. Plain
	 * object, not `$state`: one writer per half, and every consumer reads it from
	 * its own task (the `carSim` / sky-descriptor pattern). One instance per car —
	 * the controller creates it and the scene passes it down (CarWheels, the rig).
	 */
	const suspension = {
		// ── Ray geometry, constant — for whoever needs to DRAW the cast ──────────
		/** World units, body space — where each corner's ray starts (above the hub,
		 *  see `RAY_UP`). The debug rig draws the cast from here; the model itself
		 *  never needs it, which is why it was a private constant until the rig
		 *  started showing the springs it stands on. */
		rayOriginY: RAY_ORIGIN_Y,
		/** World units — the longest a ray is cast. `hitDist` reads exactly this
		 *  when the corner is airborne. */
		maxToi: MAX_TOI,
		/** World units — the tyre radius the hub rides above whatever the ray found. */
		wheelRadius: R,
		/** World units, body space — where the road sits under a wheel at rest
		 *  (`HUB_Y − R`). The tyre fx measure their tuned heights from this line
		 *  and add `groundY(i) − restGroundY`, so the look on flat ground is the
		 *  tuned one and the ground under each wheel moves the fx off it. */
		restGroundY: HUB_Y - R,

		// ── Written by the PHYSICS half ──────────────────────────────────────────
		/** Ray distance per corner, world units. `MAX_TOI` when airborne. */
		hitDist: [MAX_TOI, MAX_TOI, MAX_TOI, MAX_TOI],
		/** Is that corner's ray finding ground at all? */
		grounded: [false, false, false, false],
		/** WORLD-space ground normal under each corner, xyz × 4 (corner i at
		 *  `3i`). Straight up while airborne — the last thing a consumer should
		 *  do with a missing surface is tilt something onto it. */
		normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
		/** Physical spring compression per corner, world units, ≥ 0. */
		load: [0, 0, 0, 0],
		/** The VERTICAL component of the force handed to Rapier last step (world
		 *  force units). Vertical rather than total because that is the reading
		 *  that means something — it is what holds the car up, and on the flat it
		 *  IS the total. The tangential rest is the slope term (`step`). */
		force: 0,
		/** The average GROUND NORMAL under the loaded corners, world space, unit —
		 *  straight up when the car is airborne. The controller drives on it: the
		 *  nose and the drive force are projected into this plane, so a car climbs
		 *  a hill instead of pushing into it. Capped to `MIN_NORMAL_Y` like the
		 *  force, so a barrier face cannot re-aim the drivetrain. */
		groundNormal: new THREE.Vector3(0, 1, 0),

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
		moved: false,

		// ── The two halves + lifecycle (functions below) ─────────────────────────
		step,
		update,
		reset,
		compressionRatio,
		loadRatio,
		loadShare,
		groundY
	};

	// ── Physics half ────────────────────────────────────────────────────────────

	const _ray = new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
	const _patch = new THREE.Vector3();
	const _bodyQ = new THREE.Quaternion();
	/** Scratch for `capNormal` — tasks never allocate (core/utils/CLAUDE.md). */
	const _dir = new THREE.Vector3();

	/**
	 * Cast the four rays, apply the summed spring force. Call after the
	 * controller's `resetForces`, on every path through the physics step
	 * (including parked/startup early-returns) — there are no wheel colliders,
	 * so a skipped step falls through onto the undertray. Takes no `delta`: the
	 * force is a pure function of compression and vertical velocity; Rapier
	 * integrates.
	 *
	 * The force is aimed at the ground normal, not straight up — aimed up it
	 * balanced gravity exactly on any surface (both forces vertical, zero
	 * horizontal sum), so a hill cost nothing to climb and gave nothing back
	 * going down. Aimed at the normal, the support's tangential part IS the
	 * gravity-along-slope term, so the hill pulls for real and the tyres have to
	 * hold it. On the flat this is `(0,1,0)` and nothing changes.
	 */
	function step(body: RapierRigidBody, world: World): void {
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

		let totalX = 0;
		let totalY = 0;
		let totalZ = 0;
		let nX = 0;
		let nY = 0;
		let nZ = 0;
		for (let i = 0; i < 4; i++) {
			_patch.set(patches[i][0], RAY_ORIGIN_Y, patches[i][1]).applyQuaternion(_bodyQ);
			_ray.origin.x = t.x + _patch.x;
			_ray.origin.y = t.y + _patch.y;
			_ray.origin.z = t.z + _patch.z;

			// `solid: true` so a ray that does start inside something reports 0 rather
			// than punching through to the far side; the body itself is excluded, or
			// every ray would hit the undertray it starts inside of.
			// WITH the normal — same cast, and the tyre fx lay onto the surface it found.
			const hit = world.castRayAndGetNormal(
				_ray,
				MAX_TOI,
				true,
				undefined,
				undefined,
				undefined,
				body
			);
			const grounded = hit !== null;
			const dist = grounded ? hit.timeOfImpact : MAX_TOI;
			suspension.grounded[i] = grounded;
			suspension.hitDist[i] = dist;
			const n = suspension.normal;
			if (grounded) {
				n[i * 3] = hit.normal.x;
				n[i * 3 + 1] = hit.normal.y;
				n[i * 3 + 2] = hit.normal.z;
			} else {
				n[i * 3] = 0;
				n[i * 3 + 1] = 1;
				n[i * 3 + 2] = 0;
			}

			const load = clamp(REST_DIST - dist, 0, MAX_COMP);
			suspension.load[i] = load;
			if (load <= 0) continue;
			// Damping opposes the BODY's vertical motion, not the compression rate:
			// the road's own rate would mean differentiating a raycast, and a ray that
			// steps across a lip differentiates to a spike. A wheel is unsprung mass
			// this model does not have anyway.
			const f = k * load - c * vy;
			if (f <= 0) continue;

			// The direction, capped off the vertical (MIN_NORMAL_Y). `_dir` holds the
			// capped normal; on the flat it is exactly (0, 1, 0).
			capNormal(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
			totalX += f * _dir.x;
			totalY += f * _dir.y;
			totalZ += f * _dir.z;
			// The plane the car is driving on, averaged over the corners that are
			// actually CARRYING it — an unloaded ray's normal is not the road the
			// tyres are on.
			nX += _dir.x;
			nY += _dir.y;
			nZ += _dir.z;
		}

		// The averaged ground plane for the controller. Length 0 = airborne, and the
		// only honest answer for a missing surface is straight up.
		const nLen = Math.hypot(nX, nY, nZ);
		if (nLen > 1e-6) suspension.groundNormal.set(nX / nLen, nY / nLen, nZ / nLen);
		else suspension.groundNormal.set(0, 1, 0);

		suspension.force = totalY;
		if (totalY > 0) body.addForce({ x: totalX, y: totalY, z: totalZ }, true);
	}

	/** Cap a raw ground normal off the vertical into `_dir` — see MIN_NORMAL_Y.
	 *  Keeps the direction it leans in, limits how far. */
	function capNormal(x: number, y: number, z: number): void {
		if (y >= MIN_NORMAL_Y) {
			_dir.set(x, y, z);
			return;
		}
		// A normal pointing DOWN is a flipped or back-facing triangle (the track's
		// trimeshes are one-sided — CLAUDE.md's collider rules); there is no road
		// under it, so the car rides on the vertical.
		const h = Math.hypot(x, z);
		if (y <= 0 || h < 1e-6) {
			_dir.set(0, 1, 0);
			return;
		}
		const lean = Math.sqrt(1 - MIN_NORMAL_Y * MIN_NORMAL_Y) / h;
		_dir.set(x * lean, MIN_NORMAL_Y, z * lean);
	}

	/** Park the rays — nothing is grounded until the next physics step says so. */
	function resetRays(): void {
		for (let i = 0; i < 4; i++) {
			suspension.hitDist[i] = UNSPRUNG_DIST;
			suspension.grounded[i] = false;
			suspension.load[i] = 0;
			suspension.normal[i * 3] = 0;
			suspension.normal[i * 3 + 1] = 1;
			suspension.normal[i * 3 + 2] = 0;
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
	/** Per-corner ray deviation from the mean — the input to the mode split below. */
	const dev = [0, 0, 0, 0];

	/**
	 * Advance the visual springs and rebuild the pose. Call ONCE per rendered
	 * frame from the scene's `{ before: autoRenderTask }` task, never from a
	 * physics task (see CLAUDE.md "The suspension").
	 */
	function update(delta: number): void {
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
		// Ground HIGHER under this wheel → shorter ray → the body rises there, and
		// `comp` is body-DOWN, so the sign falls straight out of the distance.
		// An airborne corner deviates by nothing rather than by a cliff.
		for (let i = 0; i < 4; i++) {
			dev[i] = suspension.grounded[i] ? suspension.hitDist[i] - meanDist : 0;
		}
		// THE FOUR DEVIATIONS SPLIT EXACTLY INTO THREE MODES over a rectangle of
		// patches — pitch (front vs rear), roll (side vs side) and WARP (the
		// diagonal, which a rigid body cannot express and a real chassis absorbs in
		// torsion). That split is the difference between following a HILL and
		// following a KERB, and they want opposite treatment: the pitch and roll
		// modes are the surface the car is standing on and it should sit on them
		// fully (`SLOPE_MAX` is a safety rail at ~19°/30°, not a feel knob), while
		// the warp is a single wheel on something and stays clamped at the old
		// `ROAD_MAX`. Clamping them together — which is what a per-corner
		// `clamp(dev, ±roadMax)` does — caps the SLOPE at the kerb limit: the car
		// rendered 2° nose-up on a 10° climb and visibly floated out of the hill.
		const pitchMode = (dev[0] + dev[1] - dev[2] - dev[3]) / 4;
		const rollMode = (dev[0] - dev[1] + dev[2] - dev[3]) / 4;
		const warpMode = (dev[0] - dev[1] - dev[2] + dev[3]) / 4;
		const pm = clamp(pitchMode, -SLOPE_MAX, SLOPE_MAX);
		const rm = clamp(rollMode, -SLOPE_MAX, SLOPE_MAX);
		const wm = clamp(warpMode, -ROAD_MAX, ROAD_MAX);
		for (let i = 0; i < 4; i++) {
			// σz = +1 front (0,1), σx = +1 on the −x side (0,2) — the `wheelPatches`
			// order, read off the index rather than off a name.
			const sz = i < 2 ? 1 : -1;
			const sx = i % 2 === 0 ? 1 : -1;
			road[i] = ROAD_FOLLOW * (pm * sz + rm * sx + wm * sz * sx);
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
			const y = clamp(RAY_ORIGIN_Y - suspension.hitDist[i] + R, HUB_Y - DROOP, HUB_Y + MAX_LIFT);
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
	function compressionRatio(i: number): number {
		return clamp((suspension.comp[i] - COMP_MIN) / (COMP_MAX - COMP_MIN), 0, 1);
	}

	/**
	 * PHYSICAL spring compression at corner `i`, 0 (slack, or airborne) … 1 (on
	 * the bump stop). NOT the same reading as `compressionRatio` above, and the
	 * difference is the point: that one is the VISUAL body displacement the lean
	 * is built from, this is what the ray actually measured and what the force
	 * handed to Rapier was computed from. The debug rig sizes its contact patches
	 * by this one, so a wheel dropping into a dip shrinks its patch even while the
	 * body's visual corner is still on its way down.
	 */
	function loadRatio(i: number): number {
		return clamp(suspension.load[i] / MAX_COMP, 0, 1);
	}

	/**
	 * Corner `i`'s share of the load it carries AT REST — 1 = its static quarter,
	 * 0 = airborne, >1 = carrying more than its share. This is the number the GRIP
	 * model wants, and it is exact rather than a proxy: the spring rate is derived
	 * from the live weight as `weight / (4 · REST_SAG)`, so a compression of
	 * exactly `REST_SAG` IS one quarter of the car's weight.
	 *
	 * It replaced a BINARY "is this corner's ray hitting anything", and the
	 * difference is the whole of "one wheel in the air must not delete a quarter
	 * of the grip": the body's total spring force has to equal its weight either
	 * way, so a corner going light is a corner whose load the others have already
	 * TAKEN — one lifted front wheel reads ~(0 + 1.9)/2 here where the binary
	 * count read (0 + 1)/2, and the front axle keeps the grip it physically still
	 * has. Uncapped on purpose; the axle-level clamp is the controller's.
	 */
	function loadShare(i: number): number {
		return suspension.load[i] / REST_SAG;
	}

	/**
	 * Body-space height of the ground under corner `i`, world units — where its
	 * ray hit. Body-down IS world-down (pitch and roll are locked), so this is
	 * exact under the rendered body pose too. Meaningful only while `grounded[i]`.
	 */
	function groundY(i: number): number {
		return RAY_ORIGIN_Y - suspension.hitDist[i];
	}

	/** Park everything — scene exit and Restart, so the next mount starts level. */
	function reset(): void {
		for (let i = 0; i < 4; i++) {
			suspension.comp[i] = 0;
			suspension.travel[i] = 0;
			suspension.wheelY[i] = HUB_Y;
			vel[i] = 0;
		}
		suspension.heave = 0;
		suspension.pitch = 0;
		suspension.roll = 0;
		suspension.groundNormal.set(0, 1, 0);
		suspension.matrix.identity();
		suspension.moved = false;
		resetRays();
	}

	return suspension;
}

export type Suspension = ReturnType<typeof createSuspension>;
