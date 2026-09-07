<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
	import { currentCar } from '../cars';
	import { wheelPatches } from '../cars/spec';
	import { G, UNITS_PER_METER } from '../units';
	import { carSim } from '../sim/carTelemetry.svelte';

	// The debug rig — the car's SKELETON, drawn instead of (or over) the model.
	//
	// The driving model is KINEMATIC: one dynamic body for the chassis (no jointed
	// wheels, no sprung suspension — the grip lives in the drivetrain/task, and the
	// chassis roundCuboid IS the ground contact). The model is the illusion; this
	// rig draws what is actually being driven:
	//   - four wheels at the spec's wheel patches, front pair steered at
	//     `carSim.steerAngle` (the same radians CarWheels renders — never
	//     re-derived, so rig and model can't disagree), rolling at road speed
	//     (rears plus the drivetrain's `slip`; rears LOCK under handbrake);
	//   - per-wheel half-shafts out of a centre diff at each axle line, plus a
	//     driveshaft back to the rear diff — independent suspension means a solid
	//     axle bar could not follow both hubs anyway;
	//   - four suspension struts whose compression is MEASURED, not modelled:
	//     finite difference of the body's world pose → body-frame acceleration →
	//     squat/dive front-to-rear and roll left-to-right. The honest visual of
	//     the load transfer the drivetrain applies — clamped, because there is no
	//     physical travel to match; it is a gauge, not a spring;
	//   - the UNDERTRAY box as a wireframe ROUNDED box at the collider group's
	//     own mount — the actual roundCuboid shape Rapier holds — and the wheels
	//     ARE the four contact balls (same patches, same hub height, same radius
	//     as TestGame.svelte's colliders), so the rig shows exactly what the car
	//     stands on.
	//
	// THE COMPRESSION MOVES THE BODY, NOT THE HUBS. This was inverted at first
	// and read as a car that dived under power and squatted under braking, and
	// leaned INTO its corners. The corner compressions were right the whole
	// time; the wrong END of the strut was being moved. The hubs are the CONTACT
	// BALLS — they sit on the road and cannot move — so a compressed corner has
	// to bring the BODY down to meet its hub, exactly like the real thing. Every
	// body-mounted part (chassis box, strut towers, both diffs, the transfer
	// puck) therefore rides the chassis transform, and the half-shafts/struts
	// articulate between that and the fixed hubs — which is what independent
	// suspension looks like. The one honest cost: the wireframe box is no longer
	// pixel-exact to the collider's pose. The collider does NOT pitch or roll
	// (`enabledRotations` leaves only yaw free), so the ±1.4° pitch / ±2.4° roll
	// here is the GAUGE, drawn on the shape rather than beside it. Its rest pose,
	// size and rounding are still the true ones.
	//
	// VISUALIZATION ONLY — nothing here feeds back into physics. The task runs at
	// `{ before: autoRenderTask }` (render time) for the same reason CarWheels
	// does: a physics-task integration pulses against the interpolated body
	// (TestGame/CLAUDE.md, "THE ROLL IS INTEGRATED IN RENDER TIME").
	//
	// The Rapier collider debug (physics extension panel, Studio-gated) draws the
	// world's colliders; this draws the car's kinematics. They complement.

	let { active = false }: { active?: boolean } = $props();

	const spec = currentCar();
	const UPM = UNITS_PER_METER;
	// Wheel patches [x, z] in world-unit body space, FL FR RL RR (nose −Z, +X left).
	const patches = wheelPatches(spec);
	const zFront = patches[0][1];
	const zRear = patches[2][1];

	// ── Constants (world units unless noted) ─────────────────────────────────
	const R = spec.model.wheelRadiusFallback * UPM; // tyre radius
	const TREAD = spec.geometry.tyreHalfWidth * 2 * UPM; // tyre width
	// THE RIG WHEELS ARE THE CONTACT BALLS: the physics wheels are ball colliders
	// at these same patches, at hubY, with this same R (TestGame.svelte) — so what
	// you see rolling here IS what the car stands on.
	const HUB_REST = spec.geometry.hubY * UPM;
	// The undertray box's TRUE world extents. The rounding arg is PRE-SCALED at the
	// call site (Threlte's scaleColliderArgs scales args positionally against
	// [x,y,z] — a roundCuboid's FOURTH arg would stay in model metres), so here the
	// dilation is the full r·UPM and the total half-extent is simply h·UPM.
	const c = spec.geometry.collider;
	const HX_PHYS = c.hx * UPM;
	const HY_PHYS = c.hy * UPM;
	const HZ_PHYS = c.hz * UPM;
	const ROUNDING_PHYS = c.rounding * UPM;
	// Suspension GAUGE range — compression clamps here. No physical travel exists.
	const COMP_MIN = -0.05 * UPM;
	const COMP_MAX = 0.11 * UPM;
	// Visual gain: squat/roll metres per g of MEASURED body acceleration.
	const SQUAT_PER_G = 0.045 * UPM;
	const ACCEL_SMOOTH = 8; // 1/s — one-pole over the finite differences
	// Strut tops ("spring towers") mount just inside the collider's box top and
	// this far inboard of the hubs — real strut towers are body mounts, so the
	// rig's towers hang off the drawn chassis, not from empty air above it.
	const TOWER_INBOARD = 0.72; // × hub |x|
	// CHASSIS-LOCAL, because the towers ride the body now: the chassis mesh sits
	// at (0, mountY, 0) in body space, so subtract nothing here — this y is
	// already relative to it.
	const TOWER_TOP_LOCAL_Y = HY_PHYS - 0.2;
	// The two lever arms the corner compressions are converted to attitude over.
	const HALF_TRACK = Math.abs(patches[0][0]);
	const WHEELBASE = zRear - zFront;

	const UP = new THREE.Vector3(0, 1, 0);

	// ── Geometry & materials — all disposed on destroy ───────────────────────
	const geos: THREE.BufferGeometry[] = [];
	const mats: THREE.Material[] = [];

	// Wheel: cylinder whose axis is X (a quarter-turn of the Y-axis cylinder),
	// plus a contrasting bar across the diameter — a bare cylinder spinning
	// about its own axis is invisible, and roll is half of what this rig shows.
	const wheelGeo = new THREE.CylinderGeometry(R, R, TREAD, 24);
	wheelGeo.rotateZ(Math.PI / 2);
	geos.push(wheelGeo);
	const stripeGeo = new THREE.BoxGeometry(TREAD * 0.55, R * 1.9, R * 0.14);
	geos.push(stripeGeo);

	// Chassis: the UNDERTRAY as a rounded box (wireframe) — the actual
	// roundCuboid shape Rapier holds, dilation included. It rides ~13 cm off the
	// rest line (the WHEELS are the ground contact); the drawn wheels coincide
	// with the contact balls exactly.
	const boxGeo = new RoundedBoxGeometry(
		HX_PHYS * 2,
		HY_PHYS * 2,
		HZ_PHYS * 2,
		4,
		ROUNDING_PHYS
	);
	geos.push(boxGeo);

	const wheelMat = new THREE.MeshBasicNodeMaterial({ color: 0x1c1f24 });
	const stripeMat = new THREE.MeshBasicNodeMaterial({ color: 0xff3355 });
	const axleMat = new THREE.MeshBasicNodeMaterial({ color: 0xff9a1f });
	const shaftMat = new THREE.MeshBasicNodeMaterial({ color: 0xffd23f });
	const boxMat = new THREE.MeshBasicNodeMaterial({
		color: 0x3fd0ff,
		wireframe: true // supported under WebGPU — the renderer converts to a line-list index
	});
	mats.push(wheelMat, stripeMat, axleMat, shaftMat, boxMat);
	// One strut material per corner — compression tints it green → red.
	const strutMats = patches.map(() => new THREE.MeshBasicNodeMaterial({ color: 0x22ff88 }));
	mats.push(...strutMats);

	/** Unit-height cylinder with a baked radius — stretched per frame. */
	const stretchBar = (radius: number, material: THREE.Material): THREE.Mesh => {
		const geometry = new THREE.CylinderGeometry(radius, radius, 1, 8);
		geos.push(geometry);
		return new THREE.Mesh(geometry, material);
	};

	// ── Build (imperative — the scene's own pattern: objects + <T is={...}>) ──
	const rig = new THREE.Group();
	rig.name = 'DebugRig';
	// Start hidden — the $effect below owns visibility from the first flush.

	const chassis = new THREE.Mesh(boxGeo, boxMat);
	chassis.position.y = c.mountY;
	rig.add(chassis);

	// Per corner: a wheel group (steer + roll; 'YXZ' so the roll happens in the
	// steered frame — the same order the CarWheels shader applies) PINNED at the
	// hub — it is the contact ball, it never leaves the road — and a strut from
	// the body-mounted tower down to it. The strut is what visibly shortens as
	// the corner takes load, because the tower comes down to meet the hub.
	const wheelGroups: THREE.Group[] = [];
	const struts: THREE.Mesh[] = [];
	/** Strut tops in CHASSIS-LOCAL space — transformed by the body each frame. */
	const towerLocal: THREE.Vector3[] = [];

	patches.forEach(([x, z], i) => {
		const wheel = new THREE.Group();
		wheel.position.set(x, HUB_REST, z);
		wheel.rotation.order = 'YXZ';
		wheel.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(stripeGeo, stripeMat));
		rig.add(wheel);
		wheelGroups.push(wheel);

		struts.push(stretchBar(0.05 * UPM, strutMats[i]));
		rig.add(struts[i]);
		towerLocal.push(new THREE.Vector3(x * TOWER_INBOARD, TOWER_TOP_LOCAL_Y, z));
	});

	// Axle lines: a diff puck at each axle's centreline plus two half-shafts per
	// end, stretched hub-to-diff per frame. The diff is BOLTED TO THE BODY (it
	// rides the chassis transform); the hubs are pinned to the road — so the
	// half-shafts articulate, which is the whole point of independent suspension.
	const diffs: THREE.Mesh[] = [];
	const diffLocal: THREE.Vector3[] = [];
	const halfShafts: THREE.Mesh[][] = [];
	for (const z of [zFront, zRear]) {
		const diffGeo = new THREE.SphereGeometry(0.09 * UPM, 12, 8);
		geos.push(diffGeo);
		const diff = new THREE.Mesh(diffGeo, axleMat);
		diff.position.set(0, HUB_REST, z);
		rig.add(diff);
		diffs.push(diff);
		diffLocal.push(new THREE.Vector3(0, HUB_REST - c.mountY, z));
		halfShafts.push([stretchBar(0.035 * UPM, axleMat), stretchBar(0.035 * UPM, axleMat)]);
		rig.add(halfShafts[halfShafts.length - 1][0], halfShafts[halfShafts.length - 1][1]);
	}

	// Driveshaft: transfer puck (between the seats) down to the rear diff. The
	// outer group carries the stretch orientation; the inner group spins about
	// the shaft axis (a plain spinning rod is invisible, so it wears a fin).
	const driveshaftPivot = new THREE.Group();
	const driveshaftSpin = new THREE.Group();
	const driveshaft = stretchBar(0.045 * UPM, shaftMat);
	const finGeo = new THREE.BoxGeometry(TREAD * 0.3, 0.02 * UPM, 0.02 * UPM);
	geos.push(finGeo);
	const fin = new THREE.Mesh(finGeo, shaftMat);
	fin.position.y = 0.5; // unit-height shaft: the fin rides the far end
	driveshaftSpin.add(driveshaft, fin);
	driveshaftPivot.add(driveshaftSpin);
	rig.add(driveshaftPivot);
	const puckGeo = new THREE.SphereGeometry(0.07 * UPM, 10, 8);
	geos.push(puckGeo);
	const transferPuck = new THREE.Mesh(puckGeo, shaftMat);
	transferPuck.position.set(0, c.mountY, HZ_PHYS * 0.2);
	rig.add(transferPuck);
	// Body-mounted too — it sits ON the chassis origin's height, so its local y is 0.
	const puckLocal = new THREE.Vector3(0, 0, HZ_PHYS * 0.2);

	// ── Per-frame pose math ──────────────────────────────────────────────────
	//
	// Everything derives from the rig root's own world transform — the
	// INTERPOLATED body pose (Rapier's sync stage wrote it before this task:
	// `{ before: autoRenderTask }` runs after it — the puffPool ordering lesson).
	// `updateWorldMatrix` first: matrixWorld is stale until the render traverses.
	const { invalidate, autoRenderTask } = useThrelte();

	const _p = new THREE.Vector3();
	const _q = new THREE.Quaternion();
	const _v = new THREE.Vector3();
	const _a = new THREE.Vector3();
	const _dir = new THREE.Vector3();
	const _mid = new THREE.Vector3();
	const _t = new THREE.Vector3(); // body-space point of a body-mounted part

	const prevPos = new THREE.Vector3();
	const prevVel = new THREE.Vector3();
	let hasPrev = false; // a previous POSITION exists
	let hasVel = false; // a previous VELOCITY exists (accel needs both)
	let accelFwd = 0; // body-frame, smoothed, m/s² (+ = accelerating forward)
	let accelLat = 0; // + = turning left (body +X)

	let rollFront = 0;
	let rollRear = 0;
	let shaftRoll = 0;

	// Strut tint: lerp green → red across the compression range.
	const cGreen = new THREE.Color(0x22ff88);
	const cRed = new THREE.Color(0xff2244);
	const cTmp = new THREE.Color();

	/** Stretch a unit-height bar between two body-space points. */
	function stretch(
		obj: THREE.Object3D,
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number
	): void {
		_dir.set(bx - ax, by - ay, bz - az);
		const len = _dir.length();
		_mid.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
		obj.position.copy(_mid);
		obj.scale.set(1, len, 1);
		obj.quaternion.setFromUnitVectors(UP, _dir.divideScalar(len));
	}

	const damp = (rate: number, delta: number): number => 1 - Math.exp(-rate * delta);

	useTask(
		(delta) => {
			if (!active) {
				hasPrev = false;
				hasVel = false;
				return;
			}

			// ── Measured body acceleration (the suspension gauge input) ───────
			rig.updateWorldMatrix(true, false);
			_p.setFromMatrixPosition(rig.matrixWorld);
			_q.setFromRotationMatrix(rig.matrixWorld);
			if (hasPrev && delta > 0) {
				_v.copy(_p).sub(prevPos).divideScalar(delta); // world velocity
				if (hasVel) {
					_a.copy(_v).sub(prevVel).divideScalar(delta); // world accel
					_a.applyQuaternion(_q.invert()); // → body frame
					// Nose is −Z; SI like the drivetrain. One-pole both: finite
					// differences of an interpolated pose carry frame noise.
					const fwd = -_a.z / UPM;
					const lat = _a.x / UPM;
					accelFwd += (fwd - accelFwd) * damp(ACCEL_SMOOTH, delta);
					accelLat += (lat - accelLat) * damp(ACCEL_SMOOTH, delta);
				}
				prevVel.copy(_v);
				hasVel = true;
			}
			prevPos.copy(_p);
			hasPrev = true;

			// Per-corner compression: squat/dive from longitudinal accel (accel
			// squats the rear, brake dives the nose), roll from lateral accel
			// (the outside corners compress). zSign: rear +1; xSign: left +1.
			const comp = [0, 0, 0, 0];
			for (let i = 0; i < 4; i++) {
				const cLong = (accelFwd / G) * SQUAT_PER_G * (patches[i][1] > 0 ? 1 : -1);
				const cLat = -(accelLat / G) * SQUAT_PER_G * (patches[i][0] > 0 ? 1 : -1);
				comp[i] = Math.min(COMP_MAX, Math.max(COMP_MIN, cLong + cLat));
			}

			// ── Body attitude: the four compressions ARE the pose ────────────
			// Small-angle, and the sign convention is worth writing down because
			// getting it backwards is exactly what made this rig read inverted:
			//   heave — compression is the body coming DOWN to the hub, so the
			//           mean drops the chassis;
			//   pitch — rotation about +X moves a point at z by −z·θ, so a rear
			//           that compresses more than the front (θ > 0, since zRear
			//           is behind and zFront is ahead) drops the tail and lifts
			//           the NOSE. Accelerate → nose up. Brake → nose down;
			//   roll  — rotation about +Z moves a point at x by +x·φ, and +X is
			//           LEFT, so a compressed right side (φ > 0) drops the right
			//           and lifts the left. Turn left → lean right, i.e. OUT of
			//           the corner, onto the loaded wheels.
			// The lever arms are the real ones, so the gauge range converts to
			// ~1.4° of pitch and ~2.4° of roll — a real car's order of magnitude.
			const heave = (comp[0] + comp[1] + comp[2] + comp[3]) / 4;
			const pitch = (comp[2] + comp[3] - comp[0] - comp[1]) / 2 / WHEELBASE;
			// patches x is +LEFT, and index 0/2 carry the negative x — so 0/2 are
			// the RIGHT pair. Read the side off the sign, never off the name.
			const roll = (comp[0] + comp[2] - comp[1] - comp[3]) / 2 / (2 * HALF_TRACK);
			chassis.position.set(0, c.mountY - heave, 0);
			chassis.rotation.set(pitch, 0, roll);
			// Everything bolted to the body reads its transform below.
			chassis.updateMatrix();

			// ── Wheels: steer (fronts) + roll ────────────────────────────────
			// Same roll source as CarWheels: road speed for the fronts, the
			// drivetrain's wheelspin share for the rears — and the handbrake
			// LOCKS the rears (that is what a handbrake does; the model wheels
			// keep spinning — one of the rig's honest divergences).
			const surface = carSim.speedMs * UPM;
			rollFront -= (surface / R) * delta;
			const rearSurface = carSim.speedMs * (1 + carSim.slip * 0.8) * UPM;
			const rearLocked = carSim.handbrake && Math.abs(carSim.speedMs) > 0.5;
			if (!rearLocked) rollRear -= (rearSurface / R) * delta;
			shaftRoll -= (rearSurface / R) * delta;

			// The hub y never moves — it is the contact ball, and it is on the road.
			for (let i = 0; i < 4; i++) {
				const w = wheelGroups[i];
				w.rotation.y = i < 2 ? carSim.steerAngle : 0;
				w.rotation.x = i < 2 ? rollFront : rollRear;
			}

			// ── Struts: body-borne tower → pinned hub, tinted by compression ──
			for (let i = 0; i < 4; i++) {
				const [x, z] = patches[i];
				_t.copy(towerLocal[i]).applyMatrix4(chassis.matrix);
				stretch(struts[i], _t.x, _t.y, _t.z, x, HUB_REST, z);
				const k = (comp[i] - COMP_MIN) / (COMP_MAX - COMP_MIN);
				strutMats[i].color.copy(cTmp.copy(cGreen).lerp(cRed, k));
			}

			// ── Axles: body-borne diff, half-shafts down to the pinned hubs ──
			for (let end = 0; end < 2; end++) {
				const z = end === 0 ? zFront : zRear;
				diffs[end].position.copy(_t.copy(diffLocal[end]).applyMatrix4(chassis.matrix));
				const d = diffs[end].position;
				stretch(halfShafts[end][0], d.x, d.y, d.z, patches[end * 2][0], HUB_REST, z);
				stretch(halfShafts[end][1], d.x, d.y, d.z, patches[end * 2 + 1][0], HUB_REST, z);
			}

			// ── Driveshaft: transfer puck → rear diff, spinning ───────────────
			// Both ends are on the body, so it barely articulates — which is
			// correct, and the contrast against the half-shafts is the point.
			transferPuck.position.copy(_t.copy(puckLocal).applyMatrix4(chassis.matrix));
			stretch(
				driveshaftPivot,
				transferPuck.position.x,
				transferPuck.position.y,
				transferPuck.position.z,
				diffs[1].position.x,
				diffs[1].position.y,
				diffs[1].position.z
			);
			driveshaftSpin.rotation.y = shaftRoll;

			// The rig moving IS a visual change and this is its one owner.
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		rig.visible = active;
		if (active) invalidate();
	});

	onDestroy(() => {
		for (const g of geos) g.dispose();
		for (const m of mats) m.dispose();
	});
</script>

<!-- Mounted INSIDE the RigidBody at the unscaled level: world-unit body space,
     and the root inherits the interpolated body pose from Rapier's sync stage. -->
<T is={rig} />
