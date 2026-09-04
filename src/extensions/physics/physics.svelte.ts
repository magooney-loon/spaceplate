import { logPhysics } from '$extensions/logger';
import { sceneActions } from '$extensions/scene';
import type {
	GravityType,
	PhysicsFramerate,
	PhysicsState,
	PhysicsActions,
	PhysicsBody,
	PhysicsBodyType
} from './types';

export type {
	GravityType,
	PhysicsFramerate,
	PhysicsState,
	PhysicsActions,
	PhysicsBody,
	PhysicsBodyType
} from './types';

const COLORS = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

/**
 * Hard cap on spawned bodies. At the cap a spawn evicts the OLDEST body instead of
 * growing the array, so the scene's cost is bounded no matter how long the button is
 * held.
 *
 * The number is a Rapier budget, not a render one: the renderer draws all of these in
 * two instanced draw calls (`scenes/DemoScene/SpawnedBodies.svelte`), so what actually
 * scales here is the simulation, the collider pairs and the 500 `<RigidBody>`
 * components' effects. Eviction unmounts one component and creates one body per click,
 * which is nothing at click frequency — recycling the Rapier body in place would buy
 * nothing and needs a teleport path.
 */
export const MAX_BODIES = 500;

const WORLD_DEFAULTS = {
	gravityX: 0,
	gravityY: -9.8,
	gravityZ: 0,
	// 200 Hz fixed, not 'varying': fixed steps are the deterministic ones (same input,
	// same result, whatever the monitor refresh), and Threlte interpolates the visual
	// transform back to render time so the extra substeps cost simulation, not smoothness.
	// Anything integrating PER STEP rather than per second changes feel when this moves —
	// see the rate constants in scenes/TestGame/TestGame.svelte.
	framerate: 200 as PhysicsFramerate,
	debug: false
};

const SPAWN_DEFAULTS = {
	spawnRestitution: 0.5,
	spawnFriction: 0.5,
	spawnLinearDamping: 0.5,
	spawnAngularDamping: 0.5,
	spawnGravityScale: 1,
	spawnCcd: true,
	spawnCanSleep: true,
	spawnRandom: true
};

const ATTRACTOR_DEFAULTS = {
	attractorEnabled: false,
	attractorStrength: 0.5,
	attractorRange: 2.5,
	attractorGravityType: 'static' as GravityType,
	attractorX: 0,
	attractorY: 3,
	attractorZ: 0
};

export const physicsState = $state<PhysicsState>({
	...WORLD_DEFAULTS,
	...SPAWN_DEFAULTS,
	...ATTRACTOR_DEFAULTS,
	bodies: []
});

const spawnPosition = (): [number, number, number] =>
	physicsState.spawnRandom
		? [(Math.random() - 0.5) * 8, 8 + Math.random() * 4, (Math.random() - 0.5) * 8]
		: [0, 8, 0];

/** Ball and box differ only by `type` and their collider shape — one spawn path. */
const spawn = (type: PhysicsBodyType) => {
	sceneActions.setScene('demoScene');
	const body: PhysicsBody = {
		id: crypto.randomUUID(),
		type,
		position: spawnPosition(),
		color: randomColor(),
		restitution: physicsState.spawnRestitution,
		friction: physicsState.spawnFriction,
		linearDamping: physicsState.spawnLinearDamping,
		angularDamping: physicsState.spawnAngularDamping,
		gravityScale: physicsState.spawnGravityScale,
		ccd: physicsState.spawnCcd,
		canSleep: physicsState.spawnCanSleep
	};
	// Oldest out, newest in — see MAX_BODIES.
	if (physicsState.bodies.length >= MAX_BODIES) physicsState.bodies.shift();
	physicsState.bodies.push(body);
	logPhysics.info(`Spawned ${type}:`, body.id, `(${physicsState.bodies.length}/${MAX_BODIES})`);
};

export const physicsActions: PhysicsActions = {
	setGravityX(v) {
		physicsState.gravityX = v;
		logPhysics.info('Physics gravityX:', v);
	},
	setGravityY(v) {
		physicsState.gravityY = v;
		logPhysics.info('Physics gravityY:', v);
	},
	setGravityZ(v) {
		physicsState.gravityZ = v;
		logPhysics.info('Physics gravityZ:', v);
	},
	setFramerate(v) {
		physicsState.framerate = v;
		logPhysics.info('Physics framerate:', v);
	},
	toggleDebug() {
		physicsState.debug = !physicsState.debug;
	},
	resetWorld() {
		Object.assign(physicsState, WORLD_DEFAULTS);
		logPhysics.info('Physics world reset to defaults');
	},
	setSpawnRestitution(v) {
		physicsState.spawnRestitution = v;
	},
	setSpawnFriction(v) {
		physicsState.spawnFriction = v;
	},
	setSpawnLinearDamping(v) {
		physicsState.spawnLinearDamping = v;
	},
	setSpawnAngularDamping(v) {
		physicsState.spawnAngularDamping = v;
	},
	setSpawnGravityScale(v) {
		physicsState.spawnGravityScale = v;
	},
	setSpawnCcd(v) {
		physicsState.spawnCcd = v;
	},
	setSpawnCanSleep(v) {
		physicsState.spawnCanSleep = v;
	},
	setSpawnRandom(v) {
		physicsState.spawnRandom = v;
	},
	resetSpawnDefaults() {
		Object.assign(physicsState, SPAWN_DEFAULTS);
	},
	toggleAttractor() {
		physicsState.attractorEnabled = !physicsState.attractorEnabled;
	},
	setAttractorStrength(v) {
		physicsState.attractorStrength = v;
	},
	setAttractorRange(v) {
		physicsState.attractorRange = v;
	},
	setAttractorGravityType(v) {
		physicsState.attractorGravityType = v;
	},
	setAttractorPosition(x, y, z) {
		physicsState.attractorX = x;
		physicsState.attractorY = y;
		physicsState.attractorZ = z;
	},
	resetAttractor() {
		Object.assign(physicsState, ATTRACTOR_DEFAULTS);
	},
	spawnBall() {
		spawn('ball');
	},
	spawnBox() {
		spawn('box');
	},
	clearBodies() {
		physicsState.bodies = [];
		logPhysics.info('Cleared all physics bodies');
	}
};
