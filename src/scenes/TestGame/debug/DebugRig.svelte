<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
	import { currentCar } from '../cars';
	import { centerOfMass, drivenAxles, wheelPatches } from '../cars/spec';
	import type { CarHull } from '../cars/hull';
	import { G, UNITS_PER_METER } from '../units';
	import { carSim } from '../sim/carTelemetry.svelte';
	import { carHandling, type CarViewMode } from '../sim/carSwitches.svelte';
	import { latMu } from '../sim/handling';
	import { clamp } from '../sim/carMath';
	import type { Suspension } from '../sim/suspension';
	import { HULL_HIT_FLASH_TIME } from '../sim/hullContacts';

	// The debug rig — the car's SKELETON, drawn instead of (or over) the model.
	//
	// The driving model is one dynamic body for the chassis, standing on FOUR
	// RAYCAST SPRINGS (sim/suspension.ts) with the grip modelled in the
	// drivetrain/task rather than in any contact. The car model is the illusion;
	// this rig draws what is actually being driven.
	//
	// ── THE ONE RULE: THE RIG NEVER GUESSES ──────────────────────────────────
	// Every number it draws is PUBLISHED by the model — `carSim` (telemetry) and
	// the shared `suspension` instance. Nothing here re-derives a value that the
	// physics also computed, because that is precisely how a skeleton comes to
	// show a car nobody drove. Two of those divergences have already been fixed
	// and are worth remembering:
	//   · the steer angle used to be `steer × maxSteerAngle`, which showed the
	//     Grip lock while Drift steered at 0.62 rad. It reads `carSim.steerAngle`;
	//   · the wheel spin used to be `speedMs × (1 + slip × 0.8)`, a fudge for a
	//     real overspeed the drivetrain integrates. It reads `carSim.spin`.
	//
	// ── WHAT IS DRAWN, AND IN WHICH VIEW ─────────────────────────────────────
	// B cycles model → rig → both. 'both' draws the SKELETON over the car (the
	// structural layer); 'rig' hides the car and adds the ANALYSIS layer on top,
	// because those overlays are large and would bury a car drawn under them.
	//
	// SKELETON (both views):
	//   · the CHASSIS as a wireframe CONVEX HULL — the same point cloud the
	//     collider is built from, passed in by the scene (which computes it once
	//     per load), so what you see is what Rapier holds, minus the 5 cm
	//     rounding margin (too small to read at wireframe scale);
	//   · the hull FLASHES white-hot on a HIT and tints ORANGE while it's
	//     pressed and SLIDING against something — `carSim.hullContact*`
	//     (sim/hullContacts.ts), read off Rapier's own contact manifolds each
	//     physics step, never events (that file's header has the argument). A
	//     small marker (sphere + normal spike) is drawn AT the contact point,
	//     so a scrape reads as "here", not just "hull went orange" — the debug
	//     half of the eventual impact fx, which will spawn off this same signal;
	//   · four wheels at the spec's wheel patches, front pair steered at
	//     `carSim.steerAngle` (the same radians CarWheels renders), each rolling
	//     at ITS OWN surface speed — see the driveline note below;
	//   · a STATUS RING on each wheel's outboard face: what that corner is doing
	//     right now, colour-coded (airborne / locked / spinning / braking /
	//     driving / coasting). This is the fastest read in the rig;
	//   · the DRIVELINE, and only the driveline that exists — see below;
	//   · four suspension struts riding the SHARED suspension, tinted by the
	//     corner's visual compression.
	//
	// ANALYSIS ('rig' view only):
	//   · the four SUSPENSION RAYS, drawn from where they are actually cast down
	//     to what they actually hit, with a CONTACT PATCH disc sized and tinted by
	//     the corner's PHYSICAL spring load. The rays ARE the car's ground
	//     contact; before this they were the one part of the model with no
	//     picture at all, and an airborne wheel looked exactly like a loaded one;
	//   · at the CENTRE OF MASS (the same point cars/hull.ts hands Rapier, from
	//     `centerOfMass(spec)` — one lever rule, two consumers): the heading, the
	//     VELOCITY vector, the combined ACCELERATION vector, and the SLIP-ANGLE
	//     wedge between heading and velocity. A drift is that wedge opening;
	//   · the FRICTION CIRCLE around them: a ring at the LIVE lateral μ·g the
	//     sideways bleed is capped at this step, inside a dim ring at the tyre's
	//     full μ. The accel arrow is drawn in the same g-per-unit scale, so the
	//     arrow reaching the bright ring IS the tyre saturating, and the gap
	//     between the two rings is the grip wheelspin/brake/looseness has cost.
	//     (It is a LATERAL budget: the longitudinal cap is the drivetrain's own
	//     `tireMuLong × drivenAxleLoad` and is a different number, so a braking
	//     arrow may honestly overshoot the ring.)
	//
	// ── THE DRIVELINE IS THE LAYOUT'S, NOT THE GR86'S ────────────────────────
	// This used to be hard-coded RWD: a driveshaft to a rear diff, rear wheels
	// carrying the wheelspin, front wheels rolling at road speed — on any spec,
	// including one declaring `layout: 'fwd'`. It reads `drivenAxles(spec)` now:
	//   · a DRIVEN axle gets a diff, two half-shafts and a driveshaft from the
	//     transfer puck (so AWD grows a second one forward);
	//   · an UNDRIVEN axle gets NOTHING — no diff, no shafts. A dead axle really
	//     is just hubs and struts, and total absence is the least ambiguous way
	//     to answer "which wheels are turning";
	//   · driven wheels roll at `speedMs + carSim.spin`, undriven at `speedMs`, so
	//     wheelspin visibly happens at one end of the car and not the other;
	//   · the whole live driveline is TINTED by torque — dim bronze coasting,
	//     gold on power (`carSim.powerLoad`, the friction circle), red as the
	//     tyres light up (`carSim.slip`);
	//   · the HANDBRAKE locks the REAR wheels whatever the layout, because a
	//     handbrake is a rear brake. On a rear-driven car it stops the driveshaft
	//     with them. (The car MODEL's wheels keep spinning — one of the rig's
	//     honest divergences, and the reason to look at the rig.)
	// Half-shafts, not a solid axle bar: independent suspension means one bar
	// could not follow both hubs, and watching them articulate is the point.
	//
	// ── THE COMPRESSION MOVES THE BODY, NOT THE HUBS ─────────────────────────
	// This was inverted at first and read as a car that dived under power and
	// squatted under braking, and leaned INTO its corners. The corner compressions
	// were right the whole time; the wrong END of the strut was being moved. The
	// hubs sit on the road and cannot move, so a compressed corner has to bring
	// the BODY down to meet its hub, exactly like the real thing. Every
	// body-mounted part (chassis hull, strut towers, diffs, transfer puck, and the
	// centre-of-mass group) therefore rides the suspension's attitude matrix, and
	// the half-shafts/struts articulate between that and the fixed hubs.
	//
	// The one honest cost: the wireframe hull is no longer pixel-exact to the
	// collider's pose. The collider does NOT pitch or roll (`enabledRotations`
	// leaves only yaw free), so the couple of degrees of lean here is the GAUGE,
	// drawn on the shape rather than beside it. Its rest pose, size and rounding
	// are still the true ones. The ANALYSIS group is the exception and
	// deliberately so: its arrows are physical vectors in the body's YAW frame, so
	// it takes the pose's TRANSLATION and not its rotation — leaning the velocity
	// vector by a cosmetic roll would be drawing the fake into the measurement.
	//
	// VISUALIZATION ONLY — nothing here feeds back into physics. The task runs at
	// `{ before: autoRenderTask }` (render time) for the same reason CarWheels
	// does: a physics-task integration pulses against the interpolated body
	// (TestGame/CLAUDE.md, "THE ROLL IS INTEGRATED IN RENDER TIME").
	//
	// COST: ~24 MeshBasicNodeMaterials. Identical node graphs share a compiled
	// program, but each material still builds its own graph the first time it
	// RENDERS (the puffPool lesson, fx/puffPool.ts) — so the first press of B
	// pays them all in one frame. That is a debug tool hitching once on the frame
	// you asked for it, which is the right place for the cost; invisible layers
	// cost nothing until shown, because `_projectObject` skips them.
	//
	// The Rapier collider debug (physics extension panel, Studio-gated) draws the
	// world's colliders; this draws the car's kinematics. They complement.

	let {
		view = 'model',
		suspension,
		hull
	}: { view?: CarViewMode; suspension: Suspension; hull?: CarHull } = $props();

	const spec = currentCar();
	const UPM = UNITS_PER_METER;
	// Wheel patches [x, z] in world-unit body space, FL FR RL RR (nose −Z).
	const patches = wheelPatches(spec);
	const zFront = patches[0][1];
	const zRear = patches[2][1];
	const axleZ = [zFront, zRear];
	/** Which end the engine actually drives — the layout's, never assumed. */
	const [FRONT_DRIVEN, REAR_DRIVEN] = drivenAxles(spec);
	const AXLE_DRIVEN = [FRONT_DRIVEN, REAR_DRIVEN];

	// ── Constants (world units unless noted) ─────────────────────────────────
	const R = spec.model.wheelRadiusFallback * UPM; // tyre radius
	const TREAD = spec.geometry.tyreHalfWidth * 2 * UPM; // tyre width
	// Hub height AT REST. The live height is `suspension.wheelY[i]` (the ray), and
	// this is only where the groups are parked before the first frame poses them.
	const HUB_REST = spec.geometry.hubY * UPM;
	// Strut tops ("spring towers") mount just above the wheel they tower over
	// (hub + tyre radius + 8 cm) and this far inboard of the hubs — real strut
	// towers are body mounts above the arch, so the rig's towers hang off the
	// drawn body, not from empty air above it.
	const TOWER_INBOARD = 0.72; // × hub |x|
	const TOWER_TOP_Y = (spec.geometry.hubY + spec.model.wheelRadiusFallback + 0.08) * UPM;
	// The gearbox output the driveshafts leave from. A rear-driven car's sits
	// between the seats, a hair behind mid-wheelbase; a purely front-driven one's
	// is up at the engine, so it moves forward with the only axle it feeds.
	const PUCK_Y = (spec.geometry.hubY + 0.25) * UPM;
	const PUCK_Z = REAR_DRIVEN ? spec.geometry.rearAxleZ * 0.35 * UPM : zFront * 0.5;

	// ── Analysis-layer scales ────────────────────────────────────────────────
	/** Centre of mass in body space — the SAME point the collider carries
	 *  (cars/hull.ts reads the same helper), so the arrows hang off where the
	 *  physics actually pushes rather than off the model origin. */
	const COM = centerOfMass(spec);
	/** World units per g, for the acceleration arrow AND the friction rings —
	 *  they must share it or the arrow touching the ring means nothing. The car is
	 *  ~10.7 units long, so 3 units/g puts the tyre's ~1.6 g circle just inside
	 *  the wheelbase: readable from the chase cam, not big enough to swallow the
	 *  car. */
	const GG_PER_G = 3;
	/** World units per m/s for the velocity arrow, capped so a 140 mph run does
	 *  not draw a 15 m spear across the track. */
	const VEL_PER_MS = 0.22;
	const VEL_MAX = 14;
	/** The heading arrow is a fixed reference — the wedge is measured against it. */
	const HEAD_LEN = 7;
	/** The slip-angle wedge's radius. FIXED: the ANGLE is the reading, and a wedge
	 *  that also grew with speed would be showing two things with one shape. */
	const WEDGE_R = 6;
	/** m/s — the controller's own drift gate. Under it the slip angle is numerical
	 *  noise and in reverse it reads inverted, so the wedge and velocity arrow go
	 *  away rather than lie. */
	const VEC_MIN_SPEED = 1;
	const WEDGE_SEGS = 18;

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
	// Status ring: a torus in the wheel's own plane (normal +X after the rotate),
	// parked on the outboard face where the chase camera can always see it.
	const ringGeo = new THREE.TorusGeometry(R * 0.74, R * 0.1, 8, 24);
	ringGeo.rotateY(Math.PI / 2);
	geos.push(ringGeo);

	// Chassis: the collider's own HULL as a wireframe — built from the same
	// world-unit point cloud the scene hands the Collider (cars/hull.ts), so the
	// shape Rapier holds and the shape drawn cannot drift apart.
	// Read-once ON PURPOSE: the rig mounts inside `{#if $carModel}` (the parent
	// computes the hull from that same GLB in the same flush) and the garage
	// writes the car exactly once at boot — there is no second hull to catch.
	const hullGeo = (() => (hull ? new ConvexGeometry(hullVectors(hull.points)) : undefined))();
	if (hullGeo) geos.push(hullGeo);

	const wheelMat = new THREE.MeshBasicNodeMaterial({ color: 0x1c1f24 });
	const stripeMat = new THREE.MeshBasicNodeMaterial({ color: 0xff3355 });
	// ONE material for the whole live driveline — diffs, half-shafts, driveshafts
	// and their fins all report the same torque, so they may as well share the
	// tint (and the graph build).
	const torqueMat = new THREE.MeshBasicNodeMaterial({ color: 0xffd23f });
	const boxMat = new THREE.MeshBasicNodeMaterial({
		color: 0x3fd0ff,
		wireframe: true // supported under WebGPU — the renderer converts to a line-list index
	});
	mats.push(wheelMat, stripeMat, torqueMat, boxMat);
	// One strut material per corner — compression tints it green → red.
	const strutMats = patches.map(() => new THREE.MeshBasicNodeMaterial({ color: 0x22ff88 }));
	// One status-ring material per corner — the whole point is that they differ.
	const ringMats = patches.map(() => new THREE.MeshBasicNodeMaterial({ color: 0x39424d }));
	// One CONTACT material per corner, shared by that corner's ray and its patch
	// disc: they report the same thing, so two materials would be two graph builds
	// for one reading.
	const contactMats = patches.map(() => new THREE.MeshBasicNodeMaterial({ color: 0x1fe0c0 }));
	mats.push(...strutMats, ...ringMats, ...contactMats);
	// The hull-contact marker — sphere + normal spike, both this one colour:
	// they report the same reading (see the per-frame tint below), so two
	// materials would be two graph builds for one number.
	const hullContactMat = new THREE.MeshBasicNodeMaterial({ color: 0xff5a1f });
	mats.push(hullContactMat);

	/** Flat world-unit hull points → the Vector3[] ConvexGeometry wants. */
	function hullVectors(points: Float32Array): THREE.Vector3[] {
		const out: THREE.Vector3[] = [];
		for (let i = 0; i < points.length; i += 3) {
			out.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
		}
		return out;
	}

	/** Unit-height cylinder CENTRED on the origin — stretched between two points
	 *  per frame by `stretch()`. (Arrows use the other convention; see `makeArrow`.) */
	const stretchBar = (radius: number, material: THREE.Material): THREE.Mesh => {
		const geometry = new THREE.CylinderGeometry(radius, radius, 1, 8);
		geos.push(geometry);
		return new THREE.Mesh(geometry, material);
	};

	// ── Build: the SKELETON (drawn in both 'rig' and 'both') ─────────────────
	const rig = new THREE.Group();
	rig.name = 'DebugRig';
	// Start hidden — the $effect below owns visibility from the first flush.
	const chassis = hullGeo ? new THREE.Mesh(hullGeo, boxMat) : undefined;
	if (chassis) rig.add(chassis);

	// The hull-contact marker: a small sphere at the contact point plus a
	// short spike along the surface normal, so a barrier scrape reads as
	// "here" rather than just a colour change on the hull. Skeleton layer
	// (added to `rig`, not `fullGroup`) — visible in 'both' too, since a hit
	// is worth seeing over the real car, not only in the analysis view.
	// Hidden by default; the per-frame task below owns its visibility.
	const hullContactGeo = new THREE.SphereGeometry(0.05 * UPM, 10, 8);
	geos.push(hullContactGeo);
	const hullContactMarker = new THREE.Mesh(hullContactGeo, hullContactMat);
	hullContactMarker.visible = false;
	rig.add(hullContactMarker);
	const hullContactSpike = stretchBar(0.018 * UPM, hullContactMat);
	hullContactSpike.visible = false;
	rig.add(hullContactSpike);

	// Per corner: a wheel group (steer + roll; 'YXZ' so the roll happens in the
	// steered frame — the same order the CarWheels shader applies) PINNED at the
	// hub — it is the contact ball, it never leaves the road — plus its status
	// ring, and a strut from the body-mounted tower down to it. The strut is what
	// visibly shortens as the corner takes load, because the tower comes down to
	// meet the hub.
	const wheelGroups: THREE.Group[] = [];
	const struts: THREE.Mesh[] = [];
	/** Strut tops at REST in body space — posed by the attitude matrix each frame. */
	const towerRest: THREE.Vector3[] = [];

	patches.forEach(([x, z], i) => {
		const wheel = new THREE.Group();
		wheel.position.set(x, HUB_REST, z);
		wheel.rotation.order = 'YXZ';
		const ring = new THREE.Mesh(ringGeo, ringMats[i]);
		// Outboard is whichever way this patch's x points away from the centreline.
		ring.position.x = Math.sign(x) * (TREAD * 0.5 + 0.03 * UPM);
		wheel.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(stripeGeo, stripeMat), ring);
		rig.add(wheel);
		wheelGroups.push(wheel);

		struts.push(stretchBar(0.05 * UPM, strutMats[i]));
		rig.add(struts[i]);
		towerRest.push(new THREE.Vector3(x * TOWER_INBOARD, TOWER_TOP_Y, z));
	});

	// The DRIVELINE — one per DRIVEN axle and nothing at all at a dead one. A diff
	// puck on the axle centreline, two half-shafts out to the hubs, and a
	// driveshaft in from the transfer puck. The diffs and the puck are BOLTED TO
	// THE BODY (they ride the attitude matrix); the hubs are pinned to the road —
	// so the half-shafts articulate, which is what independent suspension looks
	// like, while the driveshaft (body at both ends) barely moves. That contrast
	// is deliberate.
	type Driveline = {
		/** 0 = front axle, 1 = rear. */
		end: number;
		diff: THREE.Mesh;
		diffRest: THREE.Vector3;
		shafts: [THREE.Mesh, THREE.Mesh];
		/** Carries the stretch orientation between puck and diff. */
		pivot: THREE.Group;
		/** Spins about the shaft axis inside it — a plain rod spinning is invisible,
		 *  so it wears a fin. */
		spin: THREE.Group;
	};
	const drivelines: Driveline[] = [];

	for (let end = 0; end < 2; end++) {
		if (!AXLE_DRIVEN[end]) continue;
		const z = axleZ[end];
		const diffGeo = new THREE.SphereGeometry(0.09 * UPM, 12, 8);
		geos.push(diffGeo);
		const diff = new THREE.Mesh(diffGeo, torqueMat);
		diff.position.set(0, HUB_REST, z);
		rig.add(diff);

		const shafts: [THREE.Mesh, THREE.Mesh] = [
			stretchBar(0.035 * UPM, torqueMat),
			stretchBar(0.035 * UPM, torqueMat)
		];
		rig.add(shafts[0], shafts[1]);

		const pivot = new THREE.Group();
		const spin = new THREE.Group();
		const finGeo = new THREE.BoxGeometry(TREAD * 0.3, 0.02 * UPM, 0.02 * UPM);
		geos.push(finGeo);
		const fin = new THREE.Mesh(finGeo, torqueMat);
		fin.position.y = 0.5; // unit-height shaft: the fin rides the far end
		spin.add(stretchBar(0.045 * UPM, torqueMat), fin);
		pivot.add(spin);
		rig.add(pivot);

		drivelines.push({
			end,
			diff,
			diffRest: new THREE.Vector3(0, HUB_REST, z),
			shafts,
			pivot,
			spin
		});
	}

	const puckGeo = new THREE.SphereGeometry(0.07 * UPM, 10, 8);
	geos.push(puckGeo);
	const transferPuck = new THREE.Mesh(puckGeo, torqueMat);
	transferPuck.position.set(0, PUCK_Y, PUCK_Z);
	rig.add(transferPuck);
	// Body-mounted too — rest pose in body space, posed by the same matrix.
	const puckRest = new THREE.Vector3(0, PUCK_Y, PUCK_Z);

	// ── Build: the ANALYSIS layer ('rig' view only) ──────────────────────────
	const fullGroup = new THREE.Group();
	fullGroup.name = 'DebugRigAnalysis';
	rig.add(fullGroup);

	// The four suspension rays, drawn where they are cast, plus a contact-patch
	// disc where each one landed. Both live at the FIXED patch x/z: the ray is
	// straight down in world space and the body only yaws, so body-down and
	// world-down can never diverge (sim/suspension.ts's own argument).
	const rays: THREE.Mesh[] = [];
	const patchDiscs: THREE.Mesh[] = [];
	const patchGeo = new THREE.CircleGeometry(1, 20);
	patchGeo.rotateX(-Math.PI / 2);
	geos.push(patchGeo);

	patches.forEach((_, i) => {
		const ray = stretchBar(0.012 * UPM, contactMats[i]);
		const disc = new THREE.Mesh(patchGeo, contactMats[i]);
		fullGroup.add(ray, disc);
		rays.push(ray);
		patchDiscs.push(disc);
	});

	// The centre-of-mass group: TRANSLATED by the body pose, never rotated by it.
	// Its contents are physical vectors in the body's yaw frame, and the rig root
	// already carries the body's real (yaw-only) rotation — applying the cosmetic
	// lean on top would be drawing the fake into the measurement.
	const cgGroup = new THREE.Group();
	cgGroup.position.set(COM[0], COM[1], COM[2]);
	fullGroup.add(cgGroup);
	const comRest = new THREE.Vector3(COM[0], COM[1], COM[2]);

	const headMat = new THREE.MeshBasicNodeMaterial({ color: 0xdfe7ef });
	const velMat = new THREE.MeshBasicNodeMaterial({ color: 0x22d3ee });
	const accelMat = new THREE.MeshBasicNodeMaterial({ color: 0x22ff88 });
	const wedgeMat = new THREE.MeshBasicNodeMaterial({
		color: 0xffb020,
		transparent: true,
		opacity: 0.3,
		side: THREE.DoubleSide,
		// The wedge is a readout, not an occluder: it must not hide the arrows it
		// is drawn between.
		depthWrite: false
	});
	const gripMat = new THREE.MeshBasicNodeMaterial({ color: 0x22ff88, side: THREE.DoubleSide });
	const fullGripMat = new THREE.MeshBasicNodeMaterial({
		color: 0x5a6572,
		side: THREE.DoubleSide
	});
	const comMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
	mats.push(headMat, velMat, accelMat, wedgeMat, gripMat, fullGripMat, comMat);

	/** A unit arrow along +Y — shaft ROOTED at the origin (tip at y = 1) plus a
	 *  cone head. `aim()` points and length-scales it; the head keeps its own
	 *  size, so a short arrow is still an arrow rather than a dot. */
	function makeArrow(radius: number, material: THREE.Material) {
		const group = new THREE.Group();
		const shaftGeo = new THREE.CylinderGeometry(radius, radius, 1, 8);
		shaftGeo.translate(0, 0.5, 0);
		geos.push(shaftGeo);
		const shaft = new THREE.Mesh(shaftGeo, material);
		const headHeight = radius * 7;
		const headGeo = new THREE.ConeGeometry(radius * 2.8, headHeight, 10);
		headGeo.translate(0, headHeight / 2, 0); // base at the origin, tip forward
		geos.push(headGeo);
		const head = new THREE.Mesh(headGeo, material);
		group.add(shaft, head);
		return { group, shaft, head };
	}
	type Arrow = ReturnType<typeof makeArrow>;

	const headArrow = makeArrow(0.045 * UPM, headMat);
	const velArrow = makeArrow(0.055 * UPM, velMat);
	const accelArrow = makeArrow(0.07 * UPM, accelMat);
	cgGroup.add(headArrow.group, velArrow.group, accelArrow.group);

	const comDotGeo = new THREE.SphereGeometry(0.06 * UPM, 10, 8);
	geos.push(comDotGeo);
	cgGroup.add(new THREE.Mesh(comDotGeo, comMat));

	// Slip-angle wedge: a flat triangle fan between the nose and the velocity
	// vector, its rim REWRITTEN each frame — the angle IS the reading, and no
	// static geometry can express an angle that changes. 20 verts, 60 floats.
	const wedgeGeo = new THREE.BufferGeometry();
	const wedgePos = new Float32Array((WEDGE_SEGS + 2) * 3); // centre + rim
	const wedgeAttr = new THREE.BufferAttribute(wedgePos, 3);
	wedgeGeo.setAttribute('position', wedgeAttr);
	const wedgeIndex: number[] = [];
	for (let i = 0; i < WEDGE_SEGS; i++) wedgeIndex.push(0, i + 1, i + 2);
	wedgeGeo.setIndex(wedgeIndex);
	// Set once rather than recomputed per frame: the rim can never leave WEDGE_R,
	// and a moving-vertex geometry with a stale bounding sphere is culled wrong.
	wedgeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), WEDGE_R);
	geos.push(wedgeGeo);
	const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
	cgGroup.add(wedge);

	// The friction circle: a flat band scaled to μ·g per frame. Two of them — the
	// LIVE lateral μ the bleed is capped at, and the tyre's full μ behind it. The
	// gap between them is the grip that wheelspin, braking and looseness cost.
	const gripRingGeo = new THREE.RingGeometry(0.965, 1, 64);
	gripRingGeo.rotateX(-Math.PI / 2);
	geos.push(gripRingGeo);
	const gripRing = new THREE.Mesh(gripRingGeo, gripMat);
	const fullGripRing = new THREE.Mesh(gripRingGeo, fullGripMat);
	cgGroup.add(gripRing, fullGripRing);

	// ── Per-frame pose math ──────────────────────────────────────────────────
	//
	// The ATTITUDE is not computed here — `sim/suspension.ts` owns it and the
	// scene's task (which mounts first, so it has already run this frame) advances
	// it. The rig just poses its body-mounted parts with that matrix, which is the
	// same one the car MODEL is posed with: in 'both' view the skeleton and the
	// car lean together by construction, not by two files agreeing on a constant.
	const { invalidate, autoRenderTask } = useThrelte();

	const _dir = new THREE.Vector3();
	const _mid = new THREE.Vector3();
	const _t = new THREE.Vector3(); // body-space point of a body-mounted part

	/** World units — how far the hull-contact spike reaches off the surface.
	 *  Fixed, like the slip-angle wedge's radius: it's a POINTER at "here", not
	 *  a magnitude readout — the tint and the HUD numbers carry "how hard". */
	const HULL_SPIKE_LEN = 0.4 * UPM;

	/** Per-wheel roll angle. Per WHEEL, not per axle: a locked rear has to HOLD
	 *  its angle while the fronts keep turning, and a shared accumulator would
	 *  snap it back the moment the handbrake released. */
	const wheelRoll = [0, 0, 0, 0];
	/** Driveshaft spin, one per driveline. */
	const shaftRoll = [0, 0];

	// Strut tint: lerp green → red across the compression range.
	const cGreen = new THREE.Color(0x22ff88);
	const cRed = new THREE.Color(0xff2244);
	// Driveline torque: dim bronze coasting → gold on power → red as it lights up.
	const cTorqueIdle = new THREE.Color(0x5a4412);
	const cTorqueLive = new THREE.Color(0xffd23f);
	const cTorqueSpin = new THREE.Color(0xff3b30);
	// Wheel status.
	const cAirborne = new THREE.Color(0xb14aff);
	const cLocked = new THREE.Color(0x2f6bff);
	const cBraking = new THREE.Color(0xff8c1a);
	const cAmber = new THREE.Color(0xffd23f);
	const cCoast = new THREE.Color(0x39424d);
	// Contact patches: teal unloaded → orange on the bump stop, red in the air.
	const cTeal = new THREE.Color(0x1fe0c0);
	const cOrange = new THREE.Color(0xff5a1f);
	// Hull contact: idle cyan (the hull's own resting colour) → orange while
	// pressed and sliding → white-hot on a HIT's brief flash.
	const cHullIdle = new THREE.Color(0x3fd0ff);
	const cHullScrape = new THREE.Color(0xff8c1a);
	const cHullHit = new THREE.Color(0xffffff);
	const cTmp = new THREE.Color();
	const cHullTmp = new THREE.Color();

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

	/** Point an arrow along (dx, dy, dz) and stretch it to `len`. A vector too
	 *  short to read is HIDDEN rather than drawn as a stub pointing at numerical
	 *  noise. */
	function aim(arrow: Arrow, dx: number, dy: number, dz: number, len: number): void {
		_dir.set(dx, dy, dz);
		const dirLen = _dir.length();
		if (len < 0.15 || dirLen < 1e-6) {
			arrow.group.visible = false;
			return;
		}
		arrow.group.visible = true;
		arrow.group.quaternion.setFromUnitVectors(UP, _dir.divideScalar(dirLen));
		arrow.shaft.scale.y = len;
		arrow.head.position.y = len;
	}

	// The heading is a FIXED reference — aimed once at the nose (−Z) and never
	// touched again; everything else in the CG group is measured against it. Done
	// here rather than at build time because `aim` reads the `_dir` scratch above.
	aim(headArrow, 0, 0, -1, HEAD_LEN);

	/**
	 * What corner `i` is doing, as a colour. Priority order matters: it is a
	 * hierarchy of "the most important thing wrong with this wheel", so a wheel in
	 * the air reads as airborne even while it also happens to be spinning.
	 *
	 *   violet  airborne — the ray found no ground
	 *   blue    locked   — the handbrake, which is always a REAR brake
	 *   red     spinning — the driven tyres beat their traction limit
	 *   orange  braking
	 *   green→amber→red  driving, ramped by the friction-circle share
	 *   grey    coasting, or an undriven wheel with nothing to say
	 */
	function wheelStatus(i: number, out: THREE.Color): void {
		const rear = i >= 2;
		const driven = rear ? REAR_DRIVEN : FRONT_DRIVEN;
		if (!suspension.grounded[i]) {
			out.copy(cAirborne);
			return;
		}
		if (rear && carSim.handbrake) {
			out.copy(cLocked);
			return;
		}
		if (driven && carSim.slip > 0.05) {
			out.copy(cAmber).lerp(cRed, clamp(carSim.slip, 0, 1));
			return;
		}
		if (carSim.brake > 0) {
			out.copy(cBraking);
			return;
		}
		if (driven && carSim.powerLoad > 0.02) {
			// Green at a light load, amber as the friction circle fills.
			out.copy(cGreen).lerp(cAmber, clamp(carSim.powerLoad, 0, 1));
			return;
		}
		out.copy(cCoast);
	}

	useTask(
		(delta) => {
			if (view === 'model') return;
			const full = view === 'rig';

			// ── Body attitude, from the SHARED suspension ────────────────────
			// Already advanced this frame by the scene's task (it registers first —
			// parents mount before children), and it is the same matrix the car
			// model is posed with. The chassis hull is drawn AT it, and everything
			// else bolted to the body is transformed BY it below.
			const pose = suspension.matrix;
			chassis?.position.copy(_t.set(0, 0, 0).applyMatrix4(pose));
			chassis?.rotation.set(suspension.pitch, 0, suspension.roll);

			// ── Wheels: steer (fronts) + roll, PER WHEEL ─────────────────────
			// Two surface speeds, because that is the whole "which wheels are
			// turning" reading: an undriven tyre runs at road speed, a driven one at
			// road speed plus the drivetrain's real overspeed. The handbrake stops
			// the rears whatever the layout — a handbrake is a rear brake.
			const roadSurface = carSim.speedMs * UPM;
			const drivenSurface = (carSim.speedMs + carSim.spin) * UPM;
			const rearLocked = carSim.handbrake && Math.abs(carSim.speedMs) > 0.5;

			// The hub rides its RAY: one tyre radius above whatever ground that
			// corner found. Climbs kerbs, hangs in dips, holds full droop in the air.
			const wheelY = suspension.wheelY;
			for (let i = 0; i < 4; i++) {
				const rear = i >= 2;
				const driven = rear ? REAR_DRIVEN : FRONT_DRIVEN;
				if (!(rear && rearLocked)) {
					wheelRoll[i] -= ((driven ? drivenSurface : roadSurface) / R) * delta;
				}
				const w = wheelGroups[i];
				w.position.y = wheelY[i];
				w.rotation.y = i < 2 ? carSim.steerAngle : 0;
				w.rotation.x = wheelRoll[i];
				wheelStatus(i, cTmp);
				ringMats[i].color.copy(cTmp);
			}

			// ── Struts: body-borne tower → the wheel, tinted by load ─────────
			for (let i = 0; i < 4; i++) {
				const [x, z] = patches[i];
				_t.copy(towerRest[i]).applyMatrix4(pose);
				stretch(struts[i], _t.x, _t.y, _t.z, x, wheelY[i], z);
				strutMats[i].color.copy(cTmp.copy(cGreen).lerp(cRed, suspension.compressionRatio(i)));
			}

			// ── Driveline: torque tint, then the driven axles only ───────────
			torqueMat.color.copy(
				cTmp
					.copy(cTorqueIdle)
					.lerp(cTorqueLive, clamp(carSim.powerLoad, 0, 1))
					.lerp(cTorqueSpin, clamp(carSim.slip, 0, 1))
			);
			transferPuck.position.copy(_t.copy(puckRest).applyMatrix4(pose));
			const puck = transferPuck.position;

			for (let d = 0; d < drivelines.length; d++) {
				const line = drivelines[d];
				const z = axleZ[line.end];
				const i0 = line.end * 2;
				line.diff.position.copy(_t.copy(line.diffRest).applyMatrix4(pose));
				const diff = line.diff.position;
				stretch(line.shafts[0], diff.x, diff.y, diff.z, patches[i0][0], wheelY[i0], z);
				stretch(line.shafts[1], diff.x, diff.y, diff.z, patches[i0 + 1][0], wheelY[i0 + 1], z);
				// Both ends of the driveshaft are on the body, so it barely
				// articulates — the contrast against the half-shafts is the point.
				stretch(line.pivot, puck.x, puck.y, puck.z, diff.x, diff.y, diff.z);
				// It turns with the wheels it feeds, and stops with them: a locked
				// rear axle stops a rear driveshaft.
				if (!(line.end === 1 && rearLocked)) {
					shaftRoll[d] -= (drivenSurface / R) * delta;
				}
				line.spin.rotation.y = shaftRoll[d];
			}

			// ── Hull contact: tint + marker (skeleton layer — both views) ────
			// `carSim.hullContact*` is sim/hullContacts.ts's publish, read off
			// Rapier's own contact manifolds each physics step — never events (see
			// that file's header for why). A HIT flashes the hull white-hot and
			// decays over HULL_HIT_FLASH_TIME; a pressed-and-sliding contact tints
			// it orange by how fast it's sliding, for as long as that lasts. The
			// marker (sphere + normal spike) is drawn AT the contact point so a
			// scrape reads as "here", not just a colour change on the hull.
			if (carSim.hullContact) {
				const flash = clamp(carSim.hullHitFlash / HULL_HIT_FLASH_TIME, 0, 1);
				const scrape = clamp(carSim.hullSlideMs / 8, 0, 1);
				cHullTmp.copy(cHullIdle).lerp(cHullScrape, scrape).lerp(cHullHit, flash);
				boxMat.color.copy(cHullTmp);
				hullContactMat.color.copy(cHullTmp);
				hullContactMarker.visible = true;
				hullContactSpike.visible = true;
				const cx = carSim.hullLocalX;
				const cy = carSim.hullLocalY;
				const cz = carSim.hullLocalZ;
				hullContactMarker.position.set(cx, cy, cz);
				stretch(
					hullContactSpike,
					cx,
					cy,
					cz,
					cx + carSim.hullNormalLocalX * HULL_SPIKE_LEN,
					cy + carSim.hullNormalLocalY * HULL_SPIKE_LEN,
					cz + carSim.hullNormalLocalZ * HULL_SPIKE_LEN
				);
			} else {
				boxMat.color.copy(cHullIdle);
				hullContactMarker.visible = false;
				hullContactSpike.visible = false;
			}

			// ── The ANALYSIS layer: 'rig' view only ──────────────────────────
			// Skipped entirely (not just hidden) in 'both' — a rewritten wedge and
			// six re-aimed arrows a frame are not free, and nothing can see them.
			if (!full) {
				invalidate();
				return;
			}

			// Suspension rays + contact patches. The ray runs from where it is
			// actually cast to what it actually hit; the disc sits where the tyre
			// touches, sized and tinted by the corner's PHYSICAL spring load (not
			// the visual compression the struts show — the difference between the
			// two is worth being able to see).
			const rayTop = suspension.rayOriginY;
			for (let i = 0; i < 4; i++) {
				const [x, z] = patches[i];
				const grounded = suspension.grounded[i];
				const dist = Math.min(suspension.hitDist[i], suspension.maxToi);
				// `solid: true` on the cast means a ray that starts INSIDE geometry
				// reports a time of impact of 0 rather than punching through. That is
				// the right physics and a degenerate line: `stretch` would normalise a
				// zero-length vector and NaN the quaternion, so the ray goes away and
				// the patch disc below carries the reading on its own.
				rays[i].visible = dist > 1e-4;
				if (rays[i].visible) stretch(rays[i], x, rayTop, z, x, rayTop - dist, z);
				const load = suspension.loadRatio(i);
				contactMats[i].color.copy(
					grounded ? cTmp.copy(cTeal).lerp(cOrange, load) : cTmp.copy(cRed)
				);
				const disc = patchDiscs[i];
				disc.visible = grounded;
				if (grounded) {
					disc.position.set(x, wheelY[i] - R, z);
					disc.scale.setScalar(R * (0.3 + 0.6 * load));
				}
			}

			// The CG group: the pose's TRANSLATION only (see the header).
			cgGroup.position.copy(_t.copy(comRest).applyMatrix4(pose));

			// Velocity, in the body frame the rig already draws in: forward is −Z,
			// and `velLat` is the component along body +X exactly as the controller
			// measured it — no sign convention is re-guessed here.
			const speed = carSim.speedMs;
			const velLat = carSim.velLat;
			const speedAbs = Math.hypot(speed, velLat);
			const rolling = speed > VEC_MIN_SPEED;
			aim(velArrow, velLat, 0, -speed, rolling ? Math.min(speedAbs * VEL_PER_MS, VEL_MAX) : 0);

			// The combined g-g vector, in the SAME units per g as the rings below —
			// that shared scale is what makes "the arrow reached the ring" mean "the
			// tyre saturated".
			const aFwd = carSim.accelFwd;
			const aLat = carSim.accelLat;
			const aMag = Math.hypot(aFwd, aLat) / G;
			aim(accelArrow, aLat, 0, -aFwd, aMag * GG_PER_G);
			const fullMu = latMu(spec.tunes[carHandling.mode]);
			// Green until the lateral budget fills, red at the limit. `latLoad` is
			// the model's own answer to "how much of the cap is this corner using".
			accelMat.color.copy(cTmp.copy(cGreen).lerp(cRed, clamp(carSim.latLoad, 0, 1)));

			gripRing.scale.set(carSim.muLat * GG_PER_G, 1, carSim.muLat * GG_PER_G);
			gripMat.color.copy(cTmp.copy(cGreen).lerp(cRed, clamp(carSim.latLoad, 0, 1)));
			fullGripRing.scale.set(fullMu * GG_PER_G, 1, fullMu * GG_PER_G);

			// The slip-angle wedge, from the nose round to the velocity heading. Off
			// below walking pace and in reverse, where the angle is noise or reads
			// inverted — the controller's own gate, for the same reason.
			wedge.visible = rolling;
			if (rolling) {
				const beta = Math.atan2(velLat, Math.max(speed, 1e-3));
				for (let s = 0; s <= WEDGE_SEGS; s++) {
					const a = (beta * s) / WEDGE_SEGS;
					const o = (s + 1) * 3;
					wedgePos[o] = Math.sin(a) * WEDGE_R;
					wedgePos[o + 1] = 0;
					wedgePos[o + 2] = -Math.cos(a) * WEDGE_R;
				}
				wedgeAttr.needsUpdate = true;
				// Amber opening up to red at the tune's own settling angle — the
				// wedge reads "how far into a drift", not just "how sideways".
				wedgeMat.color.copy(
					cTmp
						.copy(cAmber)
						.lerp(cRed, clamp(Math.abs(beta) / spec.tunes[carHandling.mode].maxDriftAngle, 0, 1))
				);
			}

			// The rig moving IS a visual change and this is its one owner.
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		rig.visible = view !== 'model';
		// The analysis overlays are large. In 'both' they would bury the car they
		// are drawn over, so 'rig' — the view that hides the car — is where they live.
		fullGroup.visible = view === 'rig';
		invalidate();
	});

	onDestroy(() => {
		for (const g of geos) g.dispose();
		for (const m of mats) m.dispose();
	});
</script>

<!-- Mounted INSIDE the RigidBody at the unscaled level: world-unit body space,
     and the root inherits the interpolated body pose from Rapier's sync stage. -->
<T is={rig} />
