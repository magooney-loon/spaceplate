export const extensionScope = 'logger';

export type LoggerChannel = 'engine' | 'settings' | 'sound' | 'postprocessing' | 'skybox' | 'cache' | 'gltf' | 'physics';

export type LoggerState = {
	engine: boolean;
	settings: boolean;
	sound: boolean;
	postprocessing: boolean;
	skybox: boolean;
	cache: boolean;
	gltf: boolean;
	physics: boolean;
};

export type ExtensionState = LoggerState;

export type LoggerActions = {
	toggleChannel: (channel: LoggerChannel) => void;
};

export type ExtensionActions = LoggerActions;

export type LoggerStyle = {
	color: string;
	bg: string;
	text: string;
	label: string;
};

export type Logger = {
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
};
