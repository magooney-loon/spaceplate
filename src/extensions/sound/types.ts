export const extensionScope = 'sound';

export type ExtensionState = {
	masterVolume: number;
	masterMuted: boolean;

	sfxVolume: number;
	sfxMuted: boolean;

	musicVolume: number;
	musicMuted: boolean;

	ambienceVolume: number;
	ambienceMuted: boolean;

	refDistance: number;
	maxDistance: number;
	rolloffFactor: number;
	panningModel: 'HRTF' | 'equalpower';

	listenerEnabled: boolean;
};

export type ExtensionActions = {
	setMasterVolume: (v: number) => void;
	toggleMasterMute: () => void;
	setSfxVolume: (v: number) => void;
	toggleSfxMute: () => void;
	setMusicVolume: (v: number) => void;
	toggleMusicMute: () => void;
	setAmbientVolume: (v: number) => void;
	toggleAmbientMute: () => void;
	setRefDistance: (v: number) => void;
	setMaxDistance: (v: number) => void;
	setRolloffFactor: (v: number) => void;
	setPanningModel: (v: 'HRTF' | 'equalpower') => void;
	resetAll: () => void;
};
