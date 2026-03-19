import { logSettings, logSound } from '$extensions/logger/logger.svelte';
import type {
	QualityLevel,
	AudioSettings,
	GraphicsSettings,
	GeneralSettings,
	SettingsState,
	ExtensionState,
	AudioActions,
	GraphicsActions,
	GeneralActions,
	ExtensionActions
} from './types';

export type { ExtensionState, ExtensionActions, QualityLevel } from './types';

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

export const settingsState = $state<ExtensionState>({
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

export const audioActions: AudioActions = {
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

export const graphicsActions: GraphicsActions = {
	setQuality(quality: QualityLevel) {
		settingsState.graphics.quality = quality;
		toStorage(GRAPHICS_KEY, quality);
		logSettings.info('Graphics quality:', quality);
	}
};

export const generalActions: GeneralActions = {
	toggleUiVisible() {
		settingsState.general.uiVisible = !settingsState.general.uiVisible;
		toStorage(UI_VISIBLE_KEY, String(settingsState.general.uiVisible));
		logSettings.info('HUD visible:', settingsState.general.uiVisible);
	}
};
