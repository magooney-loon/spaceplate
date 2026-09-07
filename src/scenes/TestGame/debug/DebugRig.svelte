<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
	import { currentCar } from '../cars';
	import { wheelPatches } from '../cars/spec';
	import type { CarHull } from '../cars/hull';
	import { UNITS_PER_METER } from '../units';
	import { carSim } from '../sim/carTelemetry.svelte';
	import type { Suspension } from '../sim/suspension';

	// The debug rig — the car's SKELETON, drawn instead of (or over) the model.
	//
	// The driving model is one dynamic body for the chassis, standing on FOUR
	// RAYCAST SPRINGS (sim/suspension.ts) with the grip modelled in the
	// drivetrain/task rather than in any contact. The car model is the illusion;
	// this rig draws what is actually being driven:
	//   - four wheels at the spec's wheel patches, front pair steered at
	//     `carSim.steerAngle` (the same radians CarWheels renders — never
	//     re-derived, so rig and model can't disagree), rolling at road speed
	//     (rears plus the drivetrain's `slip`; rears LOCK under handbrake);
	//   - per-wheel half-shafts out of a centre diff at each axle line, plus a
	//     driveshaft back to the rear diff — independent suspension means a solid
	//     axle bar could not follow both hubs anyway;
	//   - four suspension struts riding the SHARED suspension (sim/suspension.ts —
	//     spring-damped corners fed by the driving model's own accelerations).
	//     The rig does not compute its own any more: it and the car model pose
	//     off the same matrix, so the skeleton can never lean differently from
	//     the car drawn over it in 'both' view;
	//   - the CHASSIS as a wireframe CONVEX HULL — the same point cloud the
	//     collider is built from, passed in by the scene (which computes it once
	//     per load), so what you see is what Rapier holds, minus the 4 cm
	//     rounding margin (too small to read at wireframe scale) — while each
	//     wheel rides its own ray, one tyre radius above the ground that ray
	//     found. So the rig shows exactly what the car stands on, which is four
	//     springs rather than four balls, and it is the only place you can watch
	//     them work over a kerb.
	//
	// THE COMPRESSION MOVES THE BODY, NOT THE HUBS. This was inverted at first
	// and read as a car that dived under power and squatted under braking, and
	// leaned INTO its corners. The corner compressions were right the whole
	// time; the wrong END of the strut was being moved. The hubs are the CONTACT
	// BALLS — they sit on the road and cannot move — so a compressed corner has
	// to bring the BODY down to meet its hub, exactly like the real thing. Every
	// body-mounted part (chassis box, strut towers, both diffs, the transfer
	// puck) therefore rides the suspension's attitude matrix, and the
	// half-shafts/struts articulate between that and the fixed hubs — which is
	// what independent suspension looks like. The one honest cost: the wireframe
	// box is no longer pixel-exact to the collider's pose. The collider does NOT
	// pitch or roll (`enabledRotations` leaves only yaw free), so the couple of
	// degrees of lean here is the GAUGE, drawn on the shape rather than beside
	// it. Its rest pose, size and rounding are still the true ones.
	//
	// VISUALIZATION ONLY — nothing here feeds back into physics. The task runs at
	// `{ before: autoRenderTask }` (render time) for the same reason CarWheels
	// does: a physics-task integration pulses against the interpolated body
	// (TestGame/CLAUDE.md, "THE ROLL IS INTEGRATED IN RENDER TIME").
	//
	// The Rapier collider debug (physics extension panel, Studio-gated) draws the
	// world's colliders; this draws the car's kinematics. They complement.

	let {
		active = false,
		suspension,
		hull
	}: { active?: boolean; suspension: Suspension; hull?: CarHull } = $props();

	const spec = currentCar();
	const UPM = UNITS_PER_METER;
	// Wheel patches [x, z] in world-unit body space, FL FR RL RR (nose −Z, +X left).
	const patches = wheelPatches(spec);
	const zFront = patches[0][1];
	const zRear = patches[2][1];

	// ── Constants (world units unless noted) ─────────────────────────────────
	const R = spec.model.wheelRadiusFallback * UPM; // tyre radius
	const TREAD = spec.geometry.tyreHalfWidth * 2 * UPM; // tyre width
	// Hub height AT REST. The live height is `suspension.wheelY[i]` (the ray), and
	// this is only where the groups are parked before the first frame poses them.
	const HUB_REST = spec.geometry.hubY * UPM;
	// The undertray's box extents are gone with the box — the chassis hull is
	// passed in from the scene (same point cloud the collider holds). What the
	// rig still needs is where the BODY-MOUNTED parts park:
	// Strut tops ("spring towers") mount just above the wheel they tower over
	// (hub + tyre radius + 8 cm) and this far inboard of the hubs — real strut
	// towers are body mounts above the arch, so the rig's towers hang off the
	// drawn body, not from empty air above it.
	const TOWER_INBOARD = 0.72; // × hub |x|
	const TOWER_TOP_Y = (spec.geometry.hubY + spec.model.wheelRadiusFallback + 0.08) * UPM;
	// Transfer puck (between the seats, a hair behind mid-wheelbase).
	const PUCK_Y = (spec.geometry.hubY + 0.25) * UPM;
	const PUCK_Z = spec.geometry.rearAxleZ * 0.35 * UPM;

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

	// Chassis: the collider's own HULL as a wireframe — built from the same
	// world-unit point cloud the scene hands the Collider (cars/hull.ts), so the
	// shape Rapier holds and the shape drawn cannot drift apart. The 4 cm
	// rounding margin is not drawn (invisible at this scale); it rides
	// ~12 cm off the rest line (the WHEELS are the ground contact); the drawn
	// wheels coincide with the ray patches exactly.
	// Read-once ON PURPOSE: the rig mounts inside `{#if $carModel}` (the parent
	// computes the hull from that same GLB in the same flush) and the garage
	// writes the car exactly once at boot — there is no second hull to catch.
	const hullGeo = (() => (hull ? new ConvexGeometry(hullVectors(hull.points)) : undefined))();
	if (hullGeo) geos.push(hullGeo);

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

	/** Flat world-unit hull points → the Vector3[] ConvexGeometry wants. */
	function hullVectors(points: Float32Array): THREE.Vector3[] {
		const out: THREE.Vector3[] = [];
		for (let i = 0; i < points.length; i += 3) {
			out.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
		}
		return out;
	}

	/** Unit-height cylinder with a baked radius — stretched per frame. */
	const stretchBar = (radius: number, material: THREE.Material): THREE.Mesh => {
		const geometry = new THREE.CylinderGeometry(radius, radius, 1, 8);
		geos.push(geometry);
		return new THREE.Mesh(geometry, material);
	};

	// ── Build (imperative — the scene's own pattern: objects + <T is={...}>) ───
	const rig = new THREE.Group();
	rig.name = 'DebugRig';
	// Start hidden — the $effect below owns visibility from the first flush.
	const chassis = hullGeo ? new THREE.Mesh(hullGeo, boxMat) : undefined;
	if (chassis) rig.add(chassis);

	// Per corner: a wheel group (steer + roll; 'YXZ' so the roll happens in the
	// steered frame — the same order the CarWheels shader applies) PINNED at the
	// hub — it is the contact ball, it never leaves the road — and a strut from
	// the body-mounted tower down to it. The strut is what visibly shortens as
	// the corner takes load, because the tower comes down to meet the hub.
	const wheelGroups: THREE.Group[] = [];
	const struts: THREE.Mesh[] = [];
	/** Strut tops at REST in body space — posed by the attitude matrix each frame. */
	const towerRest: THREE.Vector3[] = [];

	patches.forEach(([x, z], i) => {
		const wheel = new THREE.Group();
		wheel.position.set(x, HUB_REST, z);
		wheel.rotation.order = 'YXZ';
		wheel.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(stripeGeo, stripeMat));
		rig.add(wheel);
		wheelGroups.push(wheel);

		struts.push(stretchBar(0.05 * UPM, strutMats[i]));
		rig.add(struts[i]);
		towerRest.push(new THREE.Vector3(x * TOWER_INBOARD, TOWER_TOP_Y, z));
	});

	// Axle lines: a diff puck at each axle's centreline plus two half-shafts per
	// end, stretched hub-to-diff per frame. The diff is BOLTED TO THE BODY (it
	// rides the chassis transform); the hubs are pinned to the road — so the
	// half-shafts articulate, which is the whole point of independent suspension.
	const diffs: THREE.Mesh[] = [];
	const diffRest: THREE.Vector3[] = [];
	const halfShafts: THREE.Mesh[][] = [];
	for (const z of [zFront, zRear]) {
		const diffGeo = new THREE.SphereGeometry(0.09 * UPM, 12, 8);
		geos.push(diffGeo);
		const diff = new THREE.Mesh(diffGeo, axleMat);
		diff.position.set(0, HUB_REST, z);
		rig.add(diff);
		diffs.push(diff);
		diffRest.push(new THREE.Vector3(0, HUB_REST, z));
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
	transferPuck.position.set(0, PUCK_Y, PUCK_Z);
	rig.add(transferPuck);
	// Body-mounted too — rest pose in body space, posed by the same matrix.
	const puckRest = new THREE.Vector3(0, PUCK_Y, PUCK_Z);

	// ── Per-frame pose math ──────────────────────────────────────────────────
	//
	// The ATTITUDE is not computed here any more — `sim/suspension.ts` owns it
	// and the scene's task (which mounts first, so it has already run this frame)
	// advances it. The rig just poses its body-mounted parts with that matrix,
	// which is the same one the car MODEL is posed with: in 'both' view the
	// skeleton and the car lean together by construction, not by two files
	// agreeing on a constant.
	const { invalidate, autoRenderTask } = useThrelte();

	const _dir = new THREE.Vector3();
	const _mid = new THREE.Vector3();
	const _t = new THREE.Vector3(); // body-space point of a body-mounted part

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

	useTask(
		(delta) => {
			if (!active) return;

			// ── Body attitude, from the SHARED suspension ────────────────────
			// Already advanced this frame by the scene's task (it registers
			// first — parents mount before children), and it is the same matrix
			// the car model is posed with. The chassis box is drawn AT it, and
			// everything else bolted to the body is transformed BY it below.
			const pose = suspension.matrix;
			chassis?.position.copy(_t.set(0, 0, 0).applyMatrix4(pose));
			chassis?.rotation.set(suspension.pitch, 0, suspension.roll);

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

			// The hub rides its RAY: one tyre radius above whatever ground that
			// corner found. Climbs kerbs, hangs in dips, holds full droop in the
			// air — the rig is the only place you can watch the four raycast
			// springs work, which is most of what it is for now.
			const wheelY = suspension.wheelY;
			for (let i = 0; i < 4; i++) {
				const w = wheelGroups[i];
				w.position.y = wheelY[i];
				w.rotation.y = i < 2 ? carSim.steerAngle : 0;
				w.rotation.x = i < 2 ? rollFront : rollRear;
			}

			// ── Struts: body-borne tower → the wheel, tinted by load ─────────
			for (let i = 0; i < 4; i++) {
				const [x, z] = patches[i];
				_t.copy(towerRest[i]).applyMatrix4(pose);
				stretch(struts[i], _t.x, _t.y, _t.z, x, wheelY[i], z);
				strutMats[i].color.copy(cTmp.copy(cGreen).lerp(cRed, suspension.compressionRatio(i)));
			}

			// ── Axles: body-borne diff, half-shafts down to the wheels ───────
			for (let end = 0; end < 2; end++) {
				const z = end === 0 ? zFront : zRear;
				diffs[end].position.copy(_t.copy(diffRest[end]).applyMatrix4(pose));
				const d = diffs[end].position;
				stretch(halfShafts[end][0], d.x, d.y, d.z, patches[end * 2][0], wheelY[end * 2], z);
				stretch(halfShafts[end][1], d.x, d.y, d.z, patches[end * 2 + 1][0], wheelY[end * 2 + 1], z);
			}

			// ── Driveshaft: transfer puck → rear diff, spinning ───────────────
			// Both ends are on the body, so it barely articulates — which is
			// correct, and the contrast against the half-shafts is the point.
			transferPuck.position.copy(_t.copy(puckRest).applyMatrix4(pose));
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
