import { logEngine } from '$extensions/logger/logger.svelte';
import { sceneActions } from '$extensions/scene/scene.svelte';
import type { PhysicsState, PhysicsActions, PhysicsBody } from './types';

export type { PhysicsState, PhysicsActions, PhysicsBody } from './types';

const COLORS = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export const physicsState = $state<PhysicsState>({
	gravity: -9.81,
	debug: false,
	bodies: []
});

export const physicsActions: PhysicsActions = {
	setGravity(v) {
		physicsState.gravity = v;
		logEngine.info('Physics gravity:', v);
	},
	toggleDebug() {
		physicsState.debug = !physicsState.debug;
	},
	spawnBall() {
		sceneActions.setScene('demoScene');
		const body: PhysicsBody = {
			id: crypto.randomUUID(),
			type: 'ball',
			position: [(Math.random() - 0.5) * 8, 8 + Math.random() * 4, (Math.random() - 0.5) * 8],
			color: randomColor()
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
			color: randomColor()
		};
		physicsState.bodies.push(body);
		logEngine.info('Spawned box:', body.id);
	},
	clearBodies() {
		physicsState.bodies = [];
		logEngine.info('Cleared all physics bodies');
	}
};
