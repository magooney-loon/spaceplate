import { logEngine } from '$extensions/logger/logger.svelte';
import { sceneActions } from '$extensions/scene/scene.svelte';
import type { GravityType, PhysicsFramerate, PhysicsState, PhysicsActions, PhysicsBody } from './types';

export type { GravityType, PhysicsFramerate, PhysicsState, PhysicsActions, PhysicsBody } from './types';

const COLORS = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export const physicsState = $state<PhysicsState>({
	gravityX: 0,
	gravityY: -9.81,
	gravityZ: 0,
	framerate: 'varying',
	debug: false,
	spawnRestitution: 0.5,
	spawnFriction: 0.5,
	spawnLinearDamping: 0.5,
	spawnAngularDamping: 0.5,
	spawnGravityScale: 1,
	spawnCcd: true,
	spawnCanSleep: true,
	attractorEnabled: false,
	attractorStrength: 10,
	attractorRange: 15,
	attractorGravityType: 'static',
	attractorX: 0,
	attractorY: 3,
	attractorZ: 0,
	bodies: []
});

export const physicsActions: PhysicsActions = {
	setGravityX(v) { physicsState.gravityX = v; logEngine.info('Physics gravityX:', v); },
	setGravityY(v) { physicsState.gravityY = v; logEngine.info('Physics gravityY:', v); },
	setGravityZ(v) { physicsState.gravityZ = v; logEngine.info('Physics gravityZ:', v); },
	setFramerate(v) { physicsState.framerate = v; logEngine.info('Physics framerate:', v); },
	toggleDebug() { physicsState.debug = !physicsState.debug; },
	setSpawnRestitution(v) { physicsState.spawnRestitution = v; },
	setSpawnFriction(v) { physicsState.spawnFriction = v; },
	setSpawnLinearDamping(v) { physicsState.spawnLinearDamping = v; },
	setSpawnAngularDamping(v) { physicsState.spawnAngularDamping = v; },
	setSpawnGravityScale(v) { physicsState.spawnGravityScale = v; },
	setSpawnCcd(v) { physicsState.spawnCcd = v; },
	setSpawnCanSleep(v) { physicsState.spawnCanSleep = v; },
	toggleAttractor() { physicsState.attractorEnabled = !physicsState.attractorEnabled; },
	setAttractorStrength(v) { physicsState.attractorStrength = v; },
	setAttractorRange(v) { physicsState.attractorRange = v; },
	setAttractorGravityType(v) { physicsState.attractorGravityType = v; },
	setAttractorPosition(x, y, z) { physicsState.attractorX = x; physicsState.attractorY = y; physicsState.attractorZ = z; },
	spawnBall() {
		sceneActions.setScene('demoScene');
		const body: PhysicsBody = {
			id: crypto.randomUUID(),
			type: 'ball',
			position: [(Math.random() - 0.5) * 8, 8 + Math.random() * 4, (Math.random() - 0.5) * 8],
			color: randomColor(),
			restitution: physicsState.spawnRestitution,
			friction: physicsState.spawnFriction,
			linearDamping: physicsState.spawnLinearDamping,
			angularDamping: physicsState.spawnAngularDamping,
			gravityScale: physicsState.spawnGravityScale,
			ccd: physicsState.spawnCcd,
			canSleep: physicsState.spawnCanSleep,
		};
		physicsState.bodies.push(body);
		logEngine.info('Spawned ball:', body.id);
	},
	spawnBox() {
		sceneActions.setScene('demoScene');
		const body: PhysicsBody = {
			id: crypto.randomUUID(),
			type: 'box',
			position: [(Math.random() - 0.5) * 8, 8 + Math.random() * 4, (Math.random() - 0.5) * 8],
			color: randomColor(),
			restitution: physicsState.spawnRestitution,
			friction: physicsState.spawnFriction,
			linearDamping: physicsState.spawnLinearDamping,
			angularDamping: physicsState.spawnAngularDamping,
			gravityScale: physicsState.spawnGravityScale,
			ccd: physicsState.spawnCcd,
			canSleep: physicsState.spawnCanSleep,
		};
		physicsState.bodies.push(body);
		logEngine.info('Spawned box:', body.id);
	},
	clearBodies() {
		physicsState.bodies = [];
		logEngine.info('Cleared all physics bodies');
	}
};
