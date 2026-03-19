import { logSettings, logSound } from '$extensions/logger/logger.svelte';

export type QualityLevel = 'low' | 'high';

export interface AudioSettings {
	musicVolume: number;
	musicEnabled: boolean;
	ambienceVolume: number;
	ambienceEnabled: boolean;
	effectsVolume: number;
	sfxVolume: number;
	sfxEnabled: boolean;
}

export interface GraphicsSettings {
	quality: QualityLevel;
}

export interface GeneralSettings {
	uiVisible: boolean;
}

export interface SettingsState {
	audio: AudioSettings;
	graphics: GraphicsSettings;
	general: GeneralSettings;
}

export const BASE_URL = import.meta.env.BASE_URL;

const GRAPHICS_KEY = 'graphics-quality';
const UI_VISIBLE_KEY = 'ui-visible';
const MUSIC_VOLUME_KEY = 'music-volume';
const MUSIC_ENABLED_KEY = 'music-enabled';
const AMBIENCE_VOLUME_KEY = 'ambience-volume';
const AMBIENCE_ENABLED_KEY = 'ambience-enabled';
const EFFECTS_VOLUME_KEY = 'effects-volume';
const SFX_VOLUME_KEY = 'sfx-volume';
const SFX_ENABLED_KEY = 'sfx-enabled';

const fromStorage = (key: string, fallback: string): string => {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
};

const toStorage = (key: string, value: string): void => {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* ignore */
	}
};

const loadQuality = (): QualityLevel => {
	const v = fromStorage(GRAPHICS_KEY, 'high');
	return (['low', 'high'] as QualityLevel[]).includes(v as QualityLevel)
		? (v as QualityLevel)
		: 'high';
};

const loadVolume = (key: string, fallback: number): number => {
	const v = parseFloat(fromStorage(key, String(fallback)));
	return isNaN(v) ? fallback : Math.min(1, Math.max(0, v));
};

const loadEnabled = (key: string, fallback: boolean): boolean => {
	return fromStorage(key, String(fallback)) === 'true';
};

export const settingsState = $state<SettingsState>({
	audio: {
		musicVolume: loadVolume(MUSIC_VOLUME_KEY, 0),
		musicEnabled: loadEnabled(MUSIC_ENABLED_KEY, false),
		ambienceVolume: loadVolume(AMBIENCE_VOLUME_KEY, 0),
		ambienceEnabled: loadEnabled(AMBIENCE_ENABLED_KEY, false),
		effectsVolume: loadVolume(EFFECTS_VOLUME_KEY, 0),
		sfxVolume: loadVolume(SFX_VOLUME_KEY, 0),
		sfxEnabled: loadEnabled(SFX_ENABLED_KEY, false)
	},
	graphics: {
		quality: loadQuality()
	},
	general: {
		uiVisible: fromStorage(UI_VISIBLE_KEY, 'true') !== 'false'
	}
});

export const audioActions = {
	toggleMusic() {
		settingsState.audio.musicEnabled = !settingsState.audio.musicEnabled;
		toStorage(MUSIC_ENABLED_KEY, String(settingsState.audio.musicEnabled));
		logSound.info('Music:', settingsState.audio.musicEnabled ? 'enabled' : 'disabled');
	},
	toggleAmbience() {
		settingsState.audio.ambienceEnabled = !settingsState.audio.ambienceEnabled;
		toStorage(AMBIENCE_ENABLED_KEY, String(settingsState.audio.ambienceEnabled));
		logSound.info('Ambience:', settingsState.audio.ambienceEnabled ? 'enabled' : 'disabled');
	},
	toggleSfx() {
		settingsState.audio.sfxEnabled = !settingsState.audio.sfxEnabled;
		toStorage(SFX_ENABLED_KEY, String(settingsState.audio.sfxEnabled));
		logSound.info('SFX:', settingsState.audio.sfxEnabled ? 'enabled' : 'disabled');
	},
	setMusicVolume(v: number) {
		settingsState.audio.musicVolume = v;
		toStorage(MUSIC_VOLUME_KEY, String(v));
		logSound.info('Music volume:', v);
	},
	setAmbienceVolume(v: number) {
		settingsState.audio.ambienceVolume = v;
		toStorage(AMBIENCE_VOLUME_KEY, String(v));
		logSound.info('Ambience volume:', v);
	},
	setSfxVolume(v: number) {
		settingsState.audio.sfxVolume = v;
		toStorage(SFX_VOLUME_KEY, String(v));
		logSound.info('SFX volume:', v);
	},
	setEffectsVolume(v: number) {
		settingsState.audio.effectsVolume = v;
		toStorage(EFFECTS_VOLUME_KEY, String(v));
		logSound.info('Effects volume:', v);
	}
};

export const graphicsActions = {
	setQuality(quality: QualityLevel) {
		settingsState.graphics.quality = quality;
		toStorage(GRAPHICS_KEY, quality);
		logSettings.info('Graphics quality:', quality);
	}
};

export const generalActions = {
	toggleUiVisible() {
		settingsState.general.uiVisible = !settingsState.general.uiVisible;
		toStorage(UI_VISIBLE_KEY, String(settingsState.general.uiVisible));
		logSettings.info('HUD visible:', settingsState.general.uiVisible);
	}
};
