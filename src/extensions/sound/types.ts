export const extensionScope = 'sound';

export type ExtensionState = {
	// master buses
	masterVolume: number;
	masterMuted: boolean;

	sfxVolume: number; // weapons, impacts, pickups
	sfxMuted: boolean;

	musicVolume: number; // background music tracks
	musicMuted: boolean;

	ambienceVolume: number; // wind, hum, atmosphere loops
	ambienceMuted: boolean;

	// positional audio tuning
	// these go on <PositionalAudio> instances
	refDistance: number; // distance where vol starts dropping
	maxDistance: number; // distance where vol reaches 0
	rolloffFactor: number; // how fast it drops off
	panningModel: 'HRTF' | 'equalpower'; // HRTF = 3D head model, expensive but realistic

	// listener
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
