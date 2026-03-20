export const extensionScope = 'sound' as const;

export type ExtensionState = {
	refDistance: number;
	maxDistance: number;
	rolloffFactor: number;
	panningModel: 'HRTF' | 'equalpower';
	listenerEnabled: boolean;
};

export type ExtensionActions = {
	setSfxVolume: (v: number) => void;
	toggleSfx: () => void;
	setMusicVolume: (v: number) => void;
	toggleMusic: () => void;
	setAmbienceVolume: (v: number) => void;
	toggleAmbience: () => void;
	setRefDistance: (v: number) => void;
	setMaxDistance: (v: number) => void;
	setRolloffFactor: (v: number) => void;
	setPanningModel: (v: 'HRTF' | 'equalpower') => void;
	resetPositional: () => void;
};
