export type QualityLevel = 'low' | 'mid' | 'high';

export interface AudioSettings {
	musicEnabled: boolean;
	effectsEnabled: boolean;
	ambienceEnabled: boolean;
	musicVolume: number;
	ambienceVolume: number;
	effectsVolume: number;
}

export interface GraphicsSettings {
	quality: QualityLevel;
}

export interface GeneralSettings {
	hideWelcomeModal: boolean;
	uiVisible: boolean;
}

export interface SettingsState {
	audio: AudioSettings;
	graphics: GraphicsSettings;
	general: GeneralSettings;
}

// ─── Debug logger ────────────────────────────────────────────────────────────
// Extend by adding new channels with their own env var:
//   export const logGame = createLogger('game', import.meta.env.VITE_GAME_LOGS === 'true');
//   export const logApi  = createLogger('api',  import.meta.env.VITE_API_LOGS  === 'true');

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

// ─── localStorage helpers ────────────────────────────────────────────────────

const GRAPHICS_KEY = 'graphics-quality';
const WELCOME_MODAL_KEY = 'hide-welcome-modal';
const UI_VISIBLE_KEY = 'ui-visible';
const MUSIC_VOLUME_KEY = 'music-volume';
const AMBIENCE_VOLUME_KEY = 'ambience-volume';
const EFFECTS_VOLUME_KEY = 'effects-volume';

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
	const v = fromStorage(GRAPHICS_KEY, 'mid');
	return (['low', 'mid', 'high'] as QualityLevel[]).includes(v as QualityLevel)
		? (v as QualityLevel)
		: 'mid';
};

const loadVolume = (key: string, fallback: number): number => {
	const v = parseFloat(fromStorage(key, String(fallback)));
	return isNaN(v) ? fallback : Math.min(1, Math.max(0, v));
};

// ─── Reactive state ──────────────────────────────────────────────────────────

export const settingsState = $state<SettingsState>({
	audio: {
		musicEnabled: false,
		effectsEnabled: true,
		ambienceEnabled: false,
		musicVolume: loadVolume(MUSIC_VOLUME_KEY, 0.69),
		ambienceVolume: loadVolume(AMBIENCE_VOLUME_KEY, 0.5),
		effectsVolume: loadVolume(EFFECTS_VOLUME_KEY, 0.5)
	},
	graphics: {
		quality: loadQuality()
	},
	general: {
		hideWelcomeModal: fromStorage(WELCOME_MODAL_KEY, 'false') === 'true',
		uiVisible: fromStorage(UI_VISIBLE_KEY, 'true') !== 'false'
	}
});

// ─── Actions ─────────────────────────────────────────────────────────────────

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
	setHideWelcomeModal(hide: boolean) {
		settingsState.general.hideWelcomeModal = hide;
		toStorage(WELCOME_MODAL_KEY, String(hide));
	},
	toggleUiVisible() {
		settingsState.general.uiVisible = !settingsState.general.uiVisible;
		toStorage(UI_VISIBLE_KEY, String(settingsState.general.uiVisible));
		log.info('HUD visible:', settingsState.general.uiVisible);
	}
};
