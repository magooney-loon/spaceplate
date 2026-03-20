export const extensionScope = 'skybox';

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

export type ExtensionState = SkyState;

export type ExtensionActions = Record<string, (...args: any[]) => void>;
