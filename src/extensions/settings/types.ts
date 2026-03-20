export const extensionScope = 'settings';

export type QualityLevel = 'low' | 'high';

export type AudioSettings = {
	musicVolume: number;
	musicEnabled: boolean;
	ambienceVolume: number;
	ambienceEnabled: boolean;
	effectsVolume: number;
	sfxVolume: number;
	sfxEnabled: boolean;
};

export type GraphicsSettings = {
	quality: QualityLevel;
};

export type GeneralSettings = {
	uiVisible: boolean;
};

export type SettingsState = {
	audio: AudioSettings;
	graphics: GraphicsSettings;
	general: GeneralSettings;
};

export type ExtensionState = SettingsState;

export type AudioActions = {
	toggleMusic: () => void;
	toggleAmbience: () => void;
	toggleSfx: () => void;
	setMusicVolume: (v: number) => void;
	setAmbienceVolume: (v: number) => void;
	setSfxVolume: (v: number) => void;
	setEffectsVolume: (v: number) => void;
};

export type GraphicsActions = {
	setQuality: (quality: QualityLevel) => void;
};

export type GeneralActions = {
	toggleUiVisible: () => void;
};

export type ExtensionActions = AudioActions & GraphicsActions & GeneralActions;
