export const extensionScope = 'skybox';

export type StarPreset = {
	id: string;
	name: string;
	count: number;
	radius: number;
	depth: number;
	factor: number;
	fade: boolean;
	lightness: number;
	opacity: number;
	saturation: number;
	speed: number;
};

export type StarsState = {
	enabled: boolean;
	count: number;
	radius: number;
	depth: number;
	factor: number;
	fade: boolean;
	lightness: number;
	opacity: number;
	saturation: number;
	speed: number;
	layer1Count: number;
	layer2Count: number;
	layer1Speed: number;
	layer2Speed: number;
	layer1Factor: number;
	layer2Factor: number;
};

export type SkyPreset = {
	id: string;
	name: string;
	turbidity: number;
	rayleigh: number;
	azimuth: number;
	elevation: number;
	mieCoefficient: number;
	mieDirectionalG: number;
	exposure: number;
	stars?: Partial<StarPreset>;
};

export type SkyState = {
	turbidity: number;
	rayleigh: number;
	azimuth: number;
	elevation: number;
	mieCoefficient: number;
	mieDirectionalG: number;
	exposure: number;
	setEnvironment: boolean;
	cubeMapSize: number;
	scale: number;
};

export type TransitionState = {
	isTransitioning: boolean;
	fromPreset: string | null;
	toPreset: string | null;
	progress: number;
	startTime: number;
	duration: number;
	transitionDuration: number;
};

export type ExtensionState = SkyState;

export type ExtensionActions = Record<string, (...args: any[]) => void>;
