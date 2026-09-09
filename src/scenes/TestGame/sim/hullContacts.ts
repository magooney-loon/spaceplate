// What the chassis hull is actually touching — read straight off Rapier's
// narrow phase, once per physics step, and published into `carSim`'s debug
// feed so `debug/DebugRig.svelte` can highlight the hull on a real hit and
// `debug/DebugHud.svelte` can print the numbers. NOT the ground contact (the
// four raycast springs in suspension.ts are); this is the bump stop and
// barrier scrapes — kerbs, fence bases, a belly-out over a lip. The eventual
// impact fx (sparks/dust) will read this exact same signal once it lands.
//
// ── WHY MANIFOLDS, NOT EVENTS ────────────────────────────────────────────
// A `sensor` collider reports overlap and NOTHING else (no position, no
// normal, no force) — and the car's one collider is the load-bearing hull, so
// making it a sensor would delete the car's collisions outright.
// `oncollisionenter` only fires the FIRST step of a touch, which is exactly
// half of what's wanted: a scrape along a fence is every step AFTER the
// first, and that's the one that lasts long enough to look at. `oncontact`
// (contact-force events) fires every step but hands back a force with NO
// POSITION. So instead: `world.contactPairsWith(hull)` → `world.contactPair(
// hull, other)` → the manifold. No `sensor`, no `ActiveEvents`, no
// `contactForceEventThreshold`: the collider's markup is untouched apart from
// `bind:collider` in TestGame.svelte, so nothing here can change how the car
// actually collides. With the car on the road the hull has ZERO pairs (the
// springs are the ground contact), so the sweep costs one wasm call a step
// until something is actually touched.
//
// ── WHY THIS DOESN'T READ SOLVER CONTACTS ─────────────────────────────────
// It used to (`numSolverContacts()` / `solverContactPoint(i)` /
// `contactImpulse(i)`), and that is exactly why it only ever lit up on the
// FLOOR (an analytic `cuboid`) and never on a fence/wall (a `trimesh`):
// verified empirically against the installed rapier3d-compat — a rounded
// convex hull driven straight into a static trimesh at speed DOES get
// stopped by the solver (the body's velocity genuinely zeroes, the contact is
// real), but `numSolverContacts()` reports 0 and `contactImpulse()` reports 0
// for every manifold of that shape PAIR, for the entire duration of the
// touch. Parry only populates the solver-contact/impulse introspection for
// certain shape-pair combinations, and round-hull-vs-trimesh isn't one of
// them in the installed version — this is a Rapier/Parry gap, not a
// misreading of a real API. `numContacts()` / `contactDist(i)` /
// `localContactPoint1/2(i)` / `normal()`, by contrast, ARE populated for
// every pair this scene has (plain `cuboid` and `trimesh` alike), so this
// module reads those instead and derives "how hard" from the car's own
// tracked velocity at the contact point rather than from the solver's
// (here, absent) impulse.

import type { Collider, RigidBody, TempContactManifold, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { carSim } from './carTelemetry.svelte';
import { UNITS_PER_METER } from '../units';
import { clamp } from './carMath';

/** m/s of closing speed at the contact before it counts as a HIT — a car
 *  merely leaning on something under gravity/steering never reaches this. */
const HIT_MIN_DV = 0.6;
/** m/s of closing speed at which a hit reads as maximally severe — normalises
 *  the flash intensity `DebugRig` tints the hull with. */
const HIT_FULL_DV = 3;
/** s — a debounce floor between flashes, in case `touching` flickers for one
 *  step at the threshold (float noise in `contactDist`) rather than a real
 *  separate arrival. */
const HIT_COOLDOWN = 0.09;
/** s — how long the HIT flash holds before `DebugRig` fades it back to idle. */
export const HULL_HIT_FLASH_TIME = 0.35;
/** model/world-unit contactDist at/under which a manifold counts as ACTUALLY
 *  touching rather than merely near — Rapier keeps "predictive" contacts
 *  alive for shapes a few cm apart, and those carry a real normal/point but
 *  nothing worth drawing at. */
const TOUCH_DIST = 0;

// ── Hoisted scratch — zero allocation inside the physics step ─────────────
const _n = { x: 0, y: 0, z: 0 };
const _lin = { x: 0, y: 0, z: 0 };
const _ang = { x: 0, y: 0, z: 0 };
const _com = { x: 0, y: 0, z: 0 };
const _colliderPos = { x: 0, y: 0, z: 0 };
const _colliderQuat = new THREE.Quaternion();
const _worldVec = new THREE.Vector3();

let hull: Collider | undefined;
let curWorld: World | undefined;
/** The DEEPEST manifold's numbers this step — where the readout is drawn
 *  from. Two corners touching two different bits of track therefore report
 *  from the more overlapped one; one signal is the deliberate trade against a
 *  trimesh handing back several manifolds for what is visibly one scrape. */
let bestDist = Infinity;
/** Contact point in the HULL COLLIDER'S OWN local frame — this is already
 *  BODY-LOCAL (the collider sits directly under the RigidBody with no local
 *  offset, cars/hull.ts), which is what `DebugRig` draws with directly. */
let bestLocalX = 0;
let bestLocalY = 0;
let bestLocalZ = 0;
let bestLocalNx = 0;
let bestLocalNy = 1;
let bestLocalNz = 0;
/** World-space equivalents — what a world-anchored consumer (the eventual
 *  impact fx) would spawn its particles at. */
let bestWorldX = 0;
let bestWorldY = 0;
let bestWorldZ = 0;
let bestNx = 0;
let bestNy = 1;
let bestNz = 0;
/** m/s (world units) the contact patch is sliding along the surface. */
let bestSlide = 0;
/** m/s (world units) of closing speed into the surface, this step's best
 *  manifold — the HIT signal. */
let bestClosing = 0;

/** Hoisted, including this callback: `contactPair` takes a closure, and one
 *  declared inside the task body would be an allocation every physics step
 *  forever. */
function onManifold(manifold: TempContactManifold, flipped: boolean): void {
	const contacts = manifold.numContacts();
	if (contacts === 0) return;

	// The deepest of this manifold's contacts — a stand-in for "how hard" now
	// that solver impulses aren't available for this shape pair (see header).
	let i = 0;
	let dist = manifold.contactDist(0);
	for (let k = 1; k < contacts; k++) {
		const d = manifold.contactDist(k);
		if (d < dist) {
			dist = d;
			i = k;
		}
	}
	if (dist > TOUCH_DIST) return; // near, not touching
	if (dist >= bestDist) return; // a shallower touch than what's already best

	// The hull's OWN local point/normal — `flipped` says which side of the
	// manifold is ours (we always call `contactPair(hull, other, …)`, so when
	// NOT flipped the hull is "shape 1"). Local to the COLLIDER, which per
	// cars/hull.ts has no offset from the RigidBody, so this doubles as the
	// body-local point `DebugRig` needs with no further transform.
	const lp = flipped ? manifold.localContactPoint2(i) : manifold.localContactPoint1(i);
	if (!lp) return;
	const ln = flipped ? manifold.localNormal2() : manifold.localNormal1();

	// World point/normal — `normal()` is always world-space regardless of
	// `flipped`, and the collider's own world transform (no body offset,
	// same reasoning as above) turns the local point into a world one without
	// needing the body separately.
	manifold.normal(_n);
	const collider = hull as Collider;
	collider.translation(_colliderPos);
	const q = collider.rotation();
	_colliderQuat.set(q.x, q.y, q.z, q.w);
	// Rotate `lp` by the collider's quaternion, then add its world position —
	// the forward transform, no inversion needed (that's the whole reason the
	// local point is read AS body-local above rather than derived by
	// inverting this).
	_worldVec.set(lp.x, lp.y, lp.z).applyQuaternion(_colliderQuat).add(_colliderPos);
	const px = _worldVec.x;
	const py = _worldVec.y;
	const pz = _worldVec.z;

	// The normal, ORIENTED BY GEOMETRY rather than by `flipped`: point it from
	// the contact toward the car's own centre of mass — whichever collider
	// Rapier happened to call the first one — and flip the LOCAL normal by the
	// same decision so the two stay consistent.
	let nx = _n.x;
	let ny = _n.y;
	let nz = _n.z;
	let lnx = ln?.x ?? 0;
	let lny = ln?.y ?? 0;
	let lnz = ln?.z ?? 1;
	if ((_com.x - px) * nx + (_com.y - py) * ny + (_com.z - pz) * nz < 0) {
		nx = -nx;
		ny = -ny;
		nz = -nz;
		lnx = -lnx;
		lny = -lny;
		lnz = -lnz;
	}

	// Velocity of the car's surface AT the contact — v + ω × r. The track is
	// static, so this is the relative velocity; its component ALONG the
	// surface is the grind (SCRATCH), and its component AGAINST the normal
	// (the car closing on the surface) is the HIT severity — the solver's own
	// impulse isn't available for this shape pair (see header), but the
	// car's tracked velocity at the moment contact starts is the same
	// information: how fast it arrived.
	const rx = px - _com.x;
	const ry = py - _com.y;
	const rz = pz - _com.z;
	const vx = _lin.x + (_ang.y * rz - _ang.z * ry);
	const vy = _lin.y + (_ang.z * rx - _ang.x * rz);
	const vz = _lin.z + (_ang.x * ry - _ang.y * rx);
	const vn = vx * nx + vy * ny + vz * nz;
	const tx = vx - vn * nx;
	const ty = vy - vn * ny;
	const tz = vz - vn * nz;

	bestDist = dist;
	bestLocalX = lp.x;
	bestLocalY = lp.y;
	bestLocalZ = lp.z;
	bestLocalNx = lnx;
	bestLocalNy = lny;
	bestLocalNz = lnz;
	bestWorldX = px;
	bestWorldY = py;
	bestWorldZ = pz;
	bestNx = nx;
	bestNy = ny;
	bestNz = nz;
	bestSlide = Math.hypot(tx, ty, tz);
	bestClosing = Math.max(0, -vn);
}

const onPair = (other: Collider): void => {
	if (hull && curWorld) curWorld.contactPair(hull, other, onManifold);
};

/** Whether the hull was touching anything LAST step — a HIT is the rising
 *  edge of this, not a big-number test: a car steering hard into a wall and
 *  holding position there must flash once on arrival, never again while it
 *  simply stays pressed. */
let wasTouching = false;
let hitCooldown = 0;

/**
 * Called once per physics step, from TestGame.svelte's own `usePhysicsTask`
 * right after `controller.step` — needs the hull COLLIDER (`bind:collider`,
 * not just the body) because a manifold lives between two colliders, and the
 * BODY for the centre-of-mass/velocity the contact-point maths above needs.
 */
export function pollHullContacts(
	world: World,
	collider: Collider | undefined,
	body: RigidBody | undefined,
	delta: number
): void {
	if (hitCooldown > 0) hitCooldown -= delta;
	carSim.hullHitFlash = Math.max(0, carSim.hullHitFlash - delta);

	if (!collider || !body) {
		carSim.hullContact = false;
		carSim.hullSlideMs = 0;
		carSim.hullHitDv = 0;
		wasTouching = false;
		return;
	}

	hull = collider;
	curWorld = world;
	bestDist = Infinity;
	body.worldCom(_com);
	body.linvel(_lin);
	body.angvel(_ang);
	world.contactPairsWith(collider, onPair);

	const touching = bestDist !== Infinity;
	if (!touching) {
		carSim.hullContact = false;
		carSim.hullSlideMs = 0;
		carSim.hullHitDv = 0;
		wasTouching = false;
		return;
	}

	carSim.hullContact = true;
	carSim.hullContactX = bestWorldX;
	carSim.hullContactY = bestWorldY;
	carSim.hullContactZ = bestWorldZ;
	carSim.hullNormalX = bestNx;
	carSim.hullNormalY = bestNy;
	carSim.hullNormalZ = bestNz;
	carSim.hullLocalX = bestLocalX;
	carSim.hullLocalY = bestLocalY;
	carSim.hullLocalZ = bestLocalZ;
	carSim.hullNormalLocalX = bestLocalNx;
	carSim.hullNormalLocalY = bestLocalNy;
	carSim.hullNormalLocalZ = bestLocalNz;
	carSim.hullSlideMs = bestSlide / UNITS_PER_METER;

	const closingMs = bestClosing / UNITS_PER_METER;
	carSim.hullHitDv = closingMs;

	// The rising edge: contact just STARTED this step (wasn't touching last
	// step) and arrived fast enough to count as an arrival rather than a
	// crawl up a kerb.
	if (!wasTouching && closingMs > HIT_MIN_DV && hitCooldown <= 0) {
		carSim.hullHitFlash = HULL_HIT_FLASH_TIME * (0.5 + 0.5 * clamp(closingMs / HIT_FULL_DV, 0, 1));
		hitCooldown = HIT_COOLDOWN;
	}
	wasTouching = true;
}

/** Scene-exit / restart park — mirrors `resetCarTelemetry`'s job for this
 *  module's own step-to-step state (the edge detector must not carry a
 *  pre-restart touch into the next spawn). */
export function resetHullContacts(): void {
	hull = undefined;
	curWorld = undefined;
	wasTouching = false;
	hitCooldown = 0;
}
