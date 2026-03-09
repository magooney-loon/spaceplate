export type QualityLevel = "low" | "mid" | "high";

export interface AudioSettings {
  musicEnabled: boolean;
  effectsEnabled: boolean;
  ambienceEnabled: boolean;
}

export interface GraphicsSettings {
  quality: QualityLevel;
}

export interface GeneralSettings {
  hideWelcomeModal: boolean;
  uiVisible: boolean;
}

export interface SettingsState {
  activeTab: "account" | "settings" | "extras";
  audio: AudioSettings;
  graphics: GraphicsSettings;
  general: GeneralSettings;
}

// ─── localStorage helpers ────────────────────────────────────────────────────

const GRAPHICS_KEY      = "graphics-quality";
const WELCOME_MODAL_KEY = "hide-welcome-modal";
const UI_VISIBLE_KEY    = "ui-visible";

const fromStorage = (key: string, fallback: string): string => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};

const toStorage = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
};

const loadGraphicsQuality = (): QualityLevel => {
  const stored = fromStorage(GRAPHICS_KEY, "mid");
  return (["low", "mid", "high"] as QualityLevel[]).includes(stored as QualityLevel)
    ? (stored as QualityLevel)
    : "mid";
};

// ─── Reactive state ──────────────────────────────────────────────────────────

export const settingsState = $state<SettingsState>({
  activeTab: "account",
  audio: {
    musicEnabled: false,
    effectsEnabled: false,
    ambienceEnabled: false,
  },
  graphics: {
    quality: loadGraphicsQuality(),
  },
  general: {
    hideWelcomeModal: fromStorage(WELCOME_MODAL_KEY, "false") === "true",
    uiVisible: fromStorage(UI_VISIBLE_KEY, "true") !== "false",
  },
});

// ─── Actions ─────────────────────────────────────────────────────────────────

export const audioActions = {
  toggleMusic()    { settingsState.audio.musicEnabled    = !settingsState.audio.musicEnabled; },
  toggleEffects()  { settingsState.audio.effectsEnabled  = !settingsState.audio.effectsEnabled; },
  toggleAmbience() { settingsState.audio.ambienceEnabled = !settingsState.audio.ambienceEnabled; },
};

export const graphicsActions = {
  setQuality(quality: QualityLevel) {
    settingsState.graphics.quality = quality;
    toStorage(GRAPHICS_KEY, quality);
  },
};

export const generalActions = {
  setHideWelcomeModal(hide: boolean) {
    settingsState.general.hideWelcomeModal = hide;
    toStorage(WELCOME_MODAL_KEY, String(hide));
  },
  toggleUiVisible() {
    settingsState.general.uiVisible = !settingsState.general.uiVisible;
    toStorage(UI_VISIBLE_KEY, String(settingsState.general.uiVisible));
  },
};

export const tabActions = {
  setActiveTab(tab: SettingsState["activeTab"]) {
    settingsState.activeTab = tab;
  },
};

export const settingsActions = {
  audio:    audioActions,
  graphics: graphicsActions,
  general:  generalActions,
  tab:      tabActions,
};
