export const extensionScope = 'physics';

export type GravityType = 'static' | 'linear' | 'newtonian';
export type PhysicsFramerate = 'varying' | number;
export type PhysicsBodyType = 'ball' | 'box';

export type PhysicsBody = {
	id: string;
	type: PhysicsBodyType;
	position: [number, number, number];
	color: string;
	restitution: number;
	friction: number;
	linearDamping: number;
	angularDamping: number;
	gravityScale: number;
	ccd: boolean;
	canSleep: boolean;
};

export type PhysicsState = {
	// World
	gravityX: number;
	gravityY: number;
	gravityZ: number;
	framerate: PhysicsFramerate;
	debug: boolean;
	// Spawn defaults
	spawnRestitution: number;
	spawnFriction: number;
	spawnLinearDamping: number;
	spawnAngularDamping: number;
	spawnGravityScale: number;
	spawnCcd: boolean;
	spawnCanSleep: boolean;
	spawnRandom: boolean;
	// Attractor
	attractorEnabled: boolean;
	attractorStrength: number;
	attractorRange: number;
	attractorGravityType: GravityType;
	attractorX: number;
	attractorY: number;
	attractorZ: number;
	bodies: PhysicsBody[];
};

export type PhysicsActions = {
	setGravityX(v: number): void;
	setGravityY(v: number): void;
	setGravityZ(v: number): void;
	setFramerate(v: PhysicsFramerate): void;
	toggleDebug(): void;
	resetWorld(): void;
	setSpawnRestitution(v: number): void;
	setSpawnFriction(v: number): void;
	setSpawnLinearDamping(v: number): void;
	setSpawnAngularDamping(v: number): void;
	setSpawnGravityScale(v: number): void;
	setSpawnCcd(v: boolean): void;
	setSpawnCanSleep(v: boolean): void;
	setSpawnRandom(v: boolean): void;
	resetSpawnDefaults(): void;
	toggleAttractor(): void;
	setAttractorStrength(v: number): void;
	setAttractorRange(v: number): void;
	setAttractorGravityType(v: GravityType): void;
	setAttractorPosition(x: number, y: number, z: number): void;
	resetAttractor(): void;
	spawnBall(): void;
	spawnBox(): void;
	clearBodies(): void;
};
