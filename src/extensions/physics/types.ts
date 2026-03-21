export const extensionScope = 'physics';

export type PhysicsBodyType = 'ball' | 'box';

export type PhysicsBody = {
	id: string;
	type: PhysicsBodyType;
	position: [number, number, number];
	color: string;
};

export type PhysicsState = {
	gravity: number;
	debug: boolean;
	bodies: PhysicsBody[];
};

export type PhysicsActions = {
	setGravity(v: number): void;
	toggleDebug(): void;
	spawnBall(): void;
	spawnBox(): void;
	clearBodies(): void;
};
