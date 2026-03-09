export type QualityLevel = "low" | "mid" | "high";
export type ButtonType = "default" | "fast" | "soft" | "quick" | "disabled";

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

// Graphics quality localStorage utilities
const GRAPHICS_STORAGE_KEY = "graphics-quality";

const loadGraphicsQuality = (): QualityLevel => {
  if (typeof window === "undefined" || !window.localStorage) {
    return "mid";
  }

  try {
    const stored = localStorage.getItem(GRAPHICS_STORAGE_KEY);
    if (stored && ["low", "mid", "high"].includes(stored)) {
      return stored as QualityLevel;
    }
    return "mid";
  } catch (error) {
    console.warn("Failed to load graphics quality from localStorage:", error);
    return "mid";
  }
};

const saveGraphicsQuality = (quality: QualityLevel) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(GRAPHICS_STORAGE_KEY, quality);
  } catch (error) {
    console.warn("Failed to save graphics quality to localStorage:", error);
  }
};

const WELCOME_MODAL_STORAGE_KEY = "hide-welcome-modal";
const UI_VISIBLE_STORAGE_KEY = "ui-visible";

const loadHideWelcomeModal = (): boolean => {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  try {
    const stored = localStorage.getItem(WELCOME_MODAL_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
};

const saveHideWelcomeModal = (value: boolean): void => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(WELCOME_MODAL_STORAGE_KEY, value.toString());
  } catch {
    // Ignore storage errors
  }
};

const loadUiVisible = (): boolean => {
  if (typeof window === "undefined" || !window.localStorage) {
    return true;
  }

  try {
    const stored = localStorage.getItem(UI_VISIBLE_STORAGE_KEY);
    return stored !== "false";
  } catch {
    return true;
  }
};

const saveUiVisible = (value: boolean): void => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(UI_VISIBLE_STORAGE_KEY, value.toString());
  } catch {
    // Ignore storage errors
  }
};

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
    hideWelcomeModal: loadHideWelcomeModal(),
    uiVisible: loadUiVisible(),
  },
});

// ─── Sound Service 1: Click ──────────────────────────────────────────────────
// Place your click sound file at /public/sounds/click.mp3
const CLICK_SOUND_URL = "/sounds/click.mp3";

class ClickSoundService {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private isLoaded = false;

  async initialize() {
    if (this.isLoaded) return;

    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      )();

      const response = await fetch(CLICK_SOUND_URL);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize click sound service:", error);
    }
  }

  async playClick(buttonType: ButtonType = "default") {
    if (!settingsState.audio.effectsEnabled) return;
    if (!this.isLoaded) await this.initialize();
    if (!this.audioContext || !this.audioBuffer) return;

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      const configs = {
        default: { playbackRate: 1.0, volume: 0.45 },
        fast: { playbackRate: 1.4, volume: 0.35 },
        soft: { playbackRate: 0.8, volume: 0.25 },
        quick: { playbackRate: 1.8, volume: 0.35 },
        disabled: { playbackRate: 0.6, volume: 0.25 },
      };

      const config = configs[buttonType];
      source.playbackRate.value = config.playbackRate;
      gainNode.gain.value = config.volume;

      source.start();
    } catch (error) {
      console.warn("Failed to play click sound:", error);
    }
  }

  async playHover() {
    if (!settingsState.audio.effectsEnabled) return;
    if (!this.isLoaded) await this.initialize();
    if (!this.audioContext || !this.audioBuffer) return;

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.playbackRate.value = 1.2;
      gainNode.gain.value = 0.072;

      source.start();
    } catch (error) {
      console.warn("Failed to play hover sound:", error);
    }
  }
}

// ─── Sound Service 2: Scan ───────────────────────────────────────────────────
// Place your scan sound file at /public/sounds/scan.mp3
const SCAN_SOUND_URL = "/sounds/scan.mp3";

class ScanSoundService {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private isLoaded = false;
  private sourceNode: AudioBufferSourceNode | null = null;

  async initialize() {
    if (this.isLoaded) return;

    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      )();

      const response = await fetch(SCAN_SOUND_URL);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize scan sound service:", error);
    }
  }

  async play() {
    if (!settingsState.audio.effectsEnabled) return;
    if (!this.isLoaded) await this.initialize();
    if (!this.audioContext || !this.audioBuffer) return;

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.sourceNode?.stop();

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.playbackRate.value = 2.7;
      gainNode.gain.value = 1.0;

      source.start();
      this.sourceNode = source;
    } catch (error) {
      console.warn("Failed to play scan sound:", error);
    }
  }

  stop() {
    try {
      this.sourceNode?.stop();
    } catch {
      // Ignore errors if source already stopped
    }
  }
}

// Swoosh sound trigger — consumed by a PositionalAudio/Audio component in your scene
export const swooshTrigger = $state({ value: 0 });

export const clickSoundService = new ClickSoundService();
export const scanSoundService = new ScanSoundService();

// Audio actions
export const audioActions = {
  toggleMusic() {
    settingsState.audio.musicEnabled = !settingsState.audio.musicEnabled;
  },

  toggleEffects() {
    settingsState.audio.effectsEnabled = !settingsState.audio.effectsEnabled;
  },

  toggleAmbience() {
    settingsState.audio.ambienceEnabled = !settingsState.audio.ambienceEnabled;
  },

  playClickSound(buttonType: ButtonType = "default") {
    clickSoundService.playClick(buttonType);
  },

  playHoverSound() {
    clickSoundService.playHover();
  },

  playSwooshSound() {
    swooshTrigger.value++;
  },

  playScanSound() {
    scanSoundService.play();
  },

  stopScanSound() {
    scanSoundService.stop();
  },
};

// Graphics actions
export const graphicsActions = {
  setQuality(quality: QualityLevel) {
    settingsState.graphics.quality = quality;
    saveGraphicsQuality(quality);
  },
};

// Tab actions
export const tabActions = {
  setActiveTab(tab: "account" | "settings" | "extras") {
    settingsState.activeTab = tab;
  },
};

// General settings actions
export const generalActions = {
  setHideWelcomeModal(hide: boolean) {
    settingsState.general.hideWelcomeModal = hide;
    saveHideWelcomeModal(hide);
  },
  toggleUiVisible() {
    settingsState.general.uiVisible = !settingsState.general.uiVisible;
    saveUiVisible(settingsState.general.uiVisible);
  },
};

export const settingsActions = {
  audio: audioActions,
  graphics: graphicsActions,
  tab: tabActions,
  general: generalActions,
};
