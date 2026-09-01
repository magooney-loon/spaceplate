export type SkyboxMode = 'sky' | 'environment' | 'cube';

export type EnvTextureEntry = {
	id: string;
	name: string;
	url: string;
};

export type CubeTextureEntry = {
	id: string;
	name: string;
	urls: [string, string, string, string, string, string];
};

export type EnvironmentState = {
	mode: SkyboxMode;
	envTextureId: string | null;
	envIsBackground: boolean;
	envGround: boolean;
	cubeTextureId: string | null;
	cubeIsBackground: boolean;
};
