import { logSettings, logSound } from '$extensions/logger';
// Deep path, not the '$core' barrel: the barrel re-exports Loader.svelte, which imports
// this module — going through it would close a cycle.
import { capabilityState } from '$core/utils/capabilities.svelte';
import type {
	QualityLevel,
	ExtensionState,
	AudioActions,
	GraphicsActions,
	GeneralActions
} from './types';

export type { ExtensionState, ExtensionActions, QualityLevel } from './types';

export const BASE_URL = import.meta.env.BASE_URL;

const GRAPHICS_KEY = 'graphics-quality';
const RENDER_SCALE_KEY = 'render-scale';
const UI_VISIBLE_KEY = 'ui-visible';
const MOUSE_SENSITIVITY_KEY = 'mouse-sensitivity';
const AIM_SENSITIVITY_KEY = 'aim-sensitivity';
const MUSIC_VOLUME_KEY = 'music-volume';
const MUSIC_ENABLED_KEY = 'music-enabled';
const AMBIENCE_VOLUME_KEY = 'ambience-volume';
const AMBIENCE_ENABLED_KEY = 'ambience-enabled';
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

const hasStoredQuality = (): boolean => {
	try {
		return localStorage.getItem(GRAPHICS_KEY) !== null;
	} catch {
		return false;
	}
};

const loadVolume = (key: string, fallback: number): number => {
	const v = parseFloat(fromStorage(key, String(fallback)));
	return isNaN(v) ? fallback : Math.min(1, Math.max(0, v));
};

/** Render scale floor. Below this the frame is mush, and the fill saving has run out. */
export const MIN_RENDER_SCALE = 0.5;

const clampRenderScale = (v: number): number =>
	isNaN(v) ? 1 : Math.min(1, Math.max(MIN_RENDER_SCALE, v));

const loadRenderScale = (): number => parseFloat(fromStorage(RENDER_SCALE_KEY, '1'));

export const settingsState = $state<ExtensionState>({
	audio: {
		musicVolume: loadVolume(MUSIC_VOLUME_KEY, 0.7),
		musicEnabled: false,
		ambienceVolume: loadVolume(AMBIENCE_VOLUME_KEY, 0.5),
		ambienceEnabled: false,
		sfxVolume: loadVolume(SFX_VOLUME_KEY, 0.9),
		sfxEnabled: false
	},
	graphics: {
		quality: loadQuality(),
		renderScale: clampRenderScale(loadRenderScale())
	},
	general: {
		uiVisible: fromStorage(UI_VISIBLE_KEY, 'true') !== 'false',
		mouseSensitivity: loadVolume(MOUSE_SENSITIVITY_KEY, 0.5),
		aimSensitivity: loadVolume(AIM_SENSITIVITY_KEY, 0.3)
	}
});

/**
 * Transient settings overlay state — UI-only, never persisted.
 */
export const overlayState = $state({ settingsOpen: false });

export const audioActions: AudioActions = {
	toggleMusic() {
		settingsState.audio.musicEnabled = !settingsState.audio.musicEnabled;
		toStorage(MUSIC_ENABLED_KEY, String(settingsState.audio.musicEnabled));
		logSettings.info('Music:', settingsState.audio.musicEnabled ? 'enabled' : 'disabled');
	},
	toggleAmbience() {
		settingsState.audio.ambienceEnabled = !settingsState.audio.ambienceEnabled;
		toStorage(AMBIENCE_ENABLED_KEY, String(settingsState.audio.ambienceEnabled));
		logSettings.info('Ambience:', settingsState.audio.ambienceEnabled ? 'enabled' : 'disabled');
	},
	toggleSfx() {
		settingsState.audio.sfxEnabled = !settingsState.audio.sfxEnabled;
		toStorage(SFX_ENABLED_KEY, String(settingsState.audio.sfxEnabled));
		logSettings.info('SFX:', settingsState.audio.sfxEnabled ? 'enabled' : 'disabled');
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
	}
};

/**
 * Pick the starting preset from the boot capability probe. Called once from main.ts,
 * after probeCapabilities() and before mount — module init happens too early to read
 * the probe (static imports are evaluated before main.ts runs its first line).
 *
 * Only 'low' when the device genuinely can't do better: the WebGL2 fallback path, or a
 * software adapter. Integrated GPUs are NOT downgraded — Apple Silicon reports as
 * integrated and runs 'high' comfortably. What this really spares those two paths is
 * App.svelte's dpr, which is full device pixel ratio on 'high'.
 *
 * Never persisted and never applied over a stored choice: an explicit pick still wins,
 * and on a machine that has never chosen, the recommendation follows the hardware
 * rather than a value frozen at first boot.
 */
export function seedGraphicsQuality(): void {
	if (hasStoredQuality()) return;
	const capable = capabilityState.tier === 'webgpu' && !capabilityState.fallbackAdapter;
	const seeded: QualityLevel = capable ? 'high' : 'low';
	settingsState.graphics.quality = seeded;
	logSettings.info(`Graphics quality seeded from device probe (${capabilityState.tier}):`, seeded);
}

export const graphicsActions: GraphicsActions = {
	setQuality(quality: QualityLevel) {
		settingsState.graphics.quality = quality;
		toStorage(GRAPHICS_KEY, quality);
		logSettings.info('Graphics quality:', quality);
	},
	setRenderScale(v: number) {
		const scale = clampRenderScale(v);
		settingsState.graphics.renderScale = scale;
		toStorage(RENDER_SCALE_KEY, String(scale));
		logSettings.info('Render scale:', scale);
	}
};

export const generalActions: GeneralActions = {
	toggleUiVisible() {
		settingsState.general.uiVisible = !settingsState.general.uiVisible;
		toStorage(UI_VISIBLE_KEY, String(settingsState.general.uiVisible));
		logSettings.info('HUD visible:', settingsState.general.uiVisible);
	},
	setMouseSensitivity(v: number) {
		settingsState.general.mouseSensitivity = v;
		toStorage(MOUSE_SENSITIVITY_KEY, String(v));
		logSettings.info('Mouse sensitivity:', v);
	},
	setAimSensitivity(v: number) {
		settingsState.general.aimSensitivity = v;
		toStorage(AIM_SENSITIVITY_KEY, String(v));
		logSettings.info('Aim sensitivity:', v);
	}
};
