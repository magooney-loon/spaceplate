import { logPhysics } from '$extensions/logger/logger.svelte';
import { sceneActions } from '$extensions/scene/scene.svelte';
import type {
	GravityType,
	PhysicsFramerate,
	PhysicsState,
	PhysicsActions,
	PhysicsBody
} from './types';

export type {
	GravityType,
	PhysicsFramerate,
	PhysicsState,
	PhysicsActions,
	PhysicsBody
} from './types';

const COLORS = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

const WORLD_DEFAULTS = {
	gravityX: 0,
	gravityY: -9.8,
	gravityZ: 0,
	framerate: 60 as PhysicsFramerate,
	debug: true
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
		sceneActions.setScene('demoScene');
		const body: PhysicsBody = {
			id: crypto.randomUUID(),
			type: 'ball',
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
		physicsState.bodies.push(body);
		logPhysics.info('Spawned ball:', body.id);
	},
	spawnBox() {
		sceneActions.setScene('demoScene');
		const body: PhysicsBody = {
			id: crypto.randomUUID(),
			type: 'box',
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
		physicsState.bodies.push(body);
		logPhysics.info('Spawned box:', body.id);
	},
	clearBodies() {
		physicsState.bodies = [];
		logPhysics.info('Cleared all physics bodies');
	}
};
