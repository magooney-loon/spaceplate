export type QualityLevel = 'low' | 'high';

export interface AudioSettings {
	musicEnabled: boolean;
	effectsEnabled: boolean;
	ambienceEnabled: boolean;
	musicVolume: number;
	musicMuted: boolean;
	ambienceVolume: number;
	effectsVolume: number;
	sfxVolume: number;
	sfxMuted: boolean;
	ambienceMuted: boolean;
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

const createLogger = (prefix: string, enabled: boolean) => ({
	info: (...args: unknown[]) => {
		if (enabled) console.log(`[${prefix}]`, ...args);
	},
	warn: (...args: unknown[]) => {
		if (enabled) console.warn(`[${prefix}]`, ...args);
	},
	error: (...args: unknown[]) => {
		if (enabled) console.error(`[${prefix}]`, ...args);
	}
});

export const log = createLogger('spaceplate', import.meta.env.VITE_GAME_ENGINE_LOGS === 'true');

const GRAPHICS_KEY = 'graphics-quality';
const UI_VISIBLE_KEY = 'ui-visible';
const MUSIC_VOLUME_KEY = 'music-volume';
const MUSIC_MUTED_KEY = 'music-muted';
const AMBIENCE_VOLUME_KEY = 'ambience-volume';
const EFFECTS_VOLUME_KEY = 'effects-volume';
const SFX_VOLUME_KEY = 'sfx-volume';
const SFX_MUTED_KEY = 'sfx-muted';
const AMBIENCE_MUTED_KEY = 'ambience-muted';

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

export const settingsState = $state<SettingsState>({
	audio: {
		musicEnabled: false,
		effectsEnabled: false,
		ambienceEnabled: false,
		musicVolume: loadVolume(MUSIC_VOLUME_KEY, 0),
		musicMuted: fromStorage(MUSIC_MUTED_KEY, 'true') === 'true',
		ambienceVolume: loadVolume(AMBIENCE_VOLUME_KEY, 0),
		effectsVolume: loadVolume(EFFECTS_VOLUME_KEY, 0),
		sfxVolume: loadVolume(SFX_VOLUME_KEY, 0),
		sfxMuted: true,
		ambienceMuted: fromStorage(AMBIENCE_MUTED_KEY, 'true') === 'true'
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
		log.info('Music:', settingsState.audio.musicEnabled ? 'on' : 'off');
	},
	toggleEffects() {
		settingsState.audio.effectsEnabled = !settingsState.audio.effectsEnabled;
		log.info('Effects:', settingsState.audio.effectsEnabled ? 'on' : 'off');
	},
	toggleAmbience() {
		settingsState.audio.ambienceEnabled = !settingsState.audio.ambienceEnabled;
		log.info('Ambience:', settingsState.audio.ambienceEnabled ? 'on' : 'off');
	},
	setMusicVolume(v: number) {
		settingsState.audio.musicVolume = v;
		toStorage(MUSIC_VOLUME_KEY, String(v));
		log.info('Music volume:', v);
	},
	setAmbienceVolume(v: number) {
		settingsState.audio.ambienceVolume = v;
		toStorage(AMBIENCE_VOLUME_KEY, String(v));
		log.info('Ambience volume:', v);
	},
	setEffectsVolume(v: number) {
		settingsState.audio.effectsVolume = v;
		toStorage(EFFECTS_VOLUME_KEY, String(v));
		log.info('Effects volume:', v);
	},
	toggleMusicMute() {
		settingsState.audio.musicMuted = !settingsState.audio.musicMuted;
		toStorage(MUSIC_MUTED_KEY, String(settingsState.audio.musicMuted));
		log.info('Music mute:', settingsState.audio.musicMuted);
	},
	toggleSfxMute() {
		settingsState.audio.sfxMuted = !settingsState.audio.sfxMuted;
		toStorage(SFX_MUTED_KEY, String(settingsState.audio.sfxMuted));
		log.info('SFX mute:', settingsState.audio.sfxMuted);
	},
	setSfxVolume(v: number) {
		settingsState.audio.sfxVolume = v;
		toStorage(SFX_VOLUME_KEY, String(v));
		log.info('SFX volume:', v);
	},
	toggleAmbientMute() {
		settingsState.audio.ambienceMuted = !settingsState.audio.ambienceMuted;
		toStorage(AMBIENCE_MUTED_KEY, String(settingsState.audio.ambienceMuted));
		log.info('Ambience mute:', settingsState.audio.ambienceMuted);
	},
	setAmbientVolume(v: number) {
		settingsState.audio.ambienceVolume = v;
		toStorage(AMBIENCE_VOLUME_KEY, String(v));
		log.info('Ambience volume:', v);
	}
};

export const graphicsActions = {
	setQuality(quality: QualityLevel) {
		settingsState.graphics.quality = quality;
		toStorage(GRAPHICS_KEY, quality);
		log.info('Graphics quality:', quality);
	}
};

export const generalActions = {
	toggleUiVisible() {
		settingsState.general.uiVisible = !settingsState.general.uiVisible;
		toStorage(UI_VISIBLE_KEY, String(settingsState.general.uiVisible));
		log.info('HUD visible:', settingsState.general.uiVisible);
	}
};
