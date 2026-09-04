export const extensionScope = 'settings';

export type QualityLevel = 'low' | 'high';

export type AudioSettings = {
	musicVolume: number;
	musicEnabled: boolean;
	ambienceVolume: number;
	ambienceEnabled: boolean;
	sfxVolume: number;
	sfxEnabled: boolean;
};

export type GraphicsSettings = {
	quality: QualityLevel;
	/**
	 * Render resolution as a fraction of what the preset would otherwise use, 0.5–1.
	 *
	 * Multiplies the preset's base device pixel ratio rather than replacing it, so 1 is
	 * exactly the old behaviour on both presets and the knob composes instead of fighting
	 * them. `App.svelte` owns the arithmetic. This is the cheapest lever there is on a
	 * fill-rate-bound frame — 0.5 is a quarter of the fragments.
	 */
	renderScale: number;
};

export type GeneralSettings = {
	uiVisible: boolean;
	mouseSensitivity: number;
	aimSensitivity: number;
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
};

export type GraphicsActions = {
	setQuality: (quality: QualityLevel) => void;
	setRenderScale: (v: number) => void;
};

export type GeneralActions = {
	toggleUiVisible: () => void;
	setMouseSensitivity: (v: number) => void;
	setAimSensitivity: (v: number) => void;
};

export type ExtensionActions = AudioActions & GraphicsActions & GeneralActions;
