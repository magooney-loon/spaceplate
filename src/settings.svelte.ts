// import { setLocale, getLocale } from "$lib/paraglide/runtime";
import click from "$lib/assets/sound/click.mp3";
import scan from "$lib/assets/sound/scan.mp3";
import qBuilding from "$lib/assets/sound/q_building.ogg";
import qResearch from "$lib/assets/sound/q_research.ogg";
import qDefense from "$lib/assets/sound/q_defense.ogg";
import qShipyard from "$lib/assets/sound/q_shipyard.ogg";
import inbox from "$lib/assets/sound/inbox.ogg";
import spyBell from "$lib/assets/sound/spy_bell.ogg";
import attackBell from "$lib/assets/sound/attack_bell.ogg";
import clockSound from "$lib/assets/sound/clock.ogg";
import bellSound from "$lib/assets/sound/bell.ogg";

export type QualityLevel = "low" | "mid" | "high";
export type LocaleCode = "en" | "es" | "de" | "hr" | "zh";
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

// Welcome modal localStorage utilities
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
    return stored !== "false"; // Default to visible
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

// export const getCurrentLocale = () => getLocale();

// Click sound service
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

      // Load click.mp3
      const response = await fetch(click);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize click sound service:", error);
    }
  }

  async playClick(buttonType: ButtonType = "default") {
    if (!settingsState.audio.effectsEnabled) {
      return;
    }

    // Lazy initialize if not loaded yet
    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.audioContext || !this.audioBuffer) {
      return;
    }

    try {
      // Resume audio context if needed
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Configure playback based on button type
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
    if (!settingsState.audio.effectsEnabled) {
      return;
    }

    // Lazy initialize if not loaded yet
    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.audioContext || !this.audioBuffer) {
      return;
    }

    try {
      // Resume audio context if needed
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Hover sound config - very subtle
      source.playbackRate.value = 1.2;
      gainNode.gain.value = 0.072;

      source.start();
    } catch (error) {
      console.warn("Failed to play hover sound:", error);
    }
  }
}

// Swoosh sound trigger - reactive state for PositionalAudio component
export const swooshTrigger = $state({ value: 0 });

export const clickSoundService = new ClickSoundService();

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

      const response = await fetch(scan);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize scan sound service:", error);
    }
  }

  async play() {
    if (!settingsState.audio.effectsEnabled) {
      return;
    }

    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.audioContext || !this.audioBuffer) {
      return;
    }

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // Stop any existing scan sound
      this.sourceNode?.stop();

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.playbackRate.value = 2.7;
      gainNode.gain.value = 1.0; // Boost volume

      source.start();
      this.sourceNode = source;
    } catch (error) {
      console.warn("Failed to play scan sound:", error);
    }
  }

  stop() {
    try {
      this.sourceNode?.stop();
    } catch (error) {
      // Ignore errors if source already stopped
    }
  }
}

export const scanSoundService = new ScanSoundService();

// Inbox notification sound service
class InboxSoundService {
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

      const response = await fetch(inbox);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize inbox sound service:", error);
    }
  }

  async play() {
    if (!settingsState.audio.effectsEnabled) {
      return;
    }

    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.audioContext || !this.audioBuffer) {
      return;
    }

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = this.audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.start();
    } catch (error) {
      console.warn("Failed to play inbox sound:", error);
    }
  }
}

export const inboxSoundService = new InboxSoundService();

// Fleet notification sound service
export type FleetSoundType = "espionage" | "attack" | "transport" | "destroy";

class FleetSoundService {
  private audioContext: AudioContext | null = null;
  private spyBellBuffer: AudioBuffer | null = null;
  private attackBellBuffer: AudioBuffer | null = null;
  private clockBuffer: AudioBuffer | null = null;
  private bellBuffer: AudioBuffer | null = null;
  private isLoaded = false;

  async initialize() {
    if (this.isLoaded) return;

    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      )();

      const [spyResponse, attackResponse, clockResponse, bellResponse] =
        await Promise.all([
          fetch(spyBell),
          fetch(attackBell),
          fetch(clockSound),
          fetch(bellSound),
        ]);

      const [
        spyArrayBuffer,
        attackArrayBuffer,
        clockArrayBuffer,
        bellArrayBuffer,
      ] = await Promise.all([
        spyResponse.arrayBuffer(),
        attackResponse.arrayBuffer(),
        clockResponse.arrayBuffer(),
        bellResponse.arrayBuffer(),
      ]);

      [
        this.spyBellBuffer,
        this.attackBellBuffer,
        this.clockBuffer,
        this.bellBuffer,
      ] = await Promise.all([
        this.audioContext.decodeAudioData(spyArrayBuffer),
        this.audioContext.decodeAudioData(attackArrayBuffer),
        this.audioContext.decodeAudioData(clockArrayBuffer),
        this.audioContext.decodeAudioData(bellArrayBuffer),
      ]);

      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize fleet sound service:", error);
    }
  }

  async play(type: FleetSoundType) {
    if (!settingsState.audio.effectsEnabled) {
      return;
    }

    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.audioContext) {
      return;
    }

    let buffer: AudioBuffer | null = null;
    switch (type) {
      case "espionage":
        buffer = this.spyBellBuffer;
        break;
      case "attack":
        buffer = this.attackBellBuffer;
        break;
      case "transport":
        buffer = this.clockBuffer;
        break;
      case "destroy":
        buffer = this.bellBuffer;
        break;
    }

    if (!buffer) return;

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      gainNode.gain.value = 0.4;

      source.start();
    } catch (error) {
      console.warn(`Failed to play fleet ${type} sound:`, error);
    }
  }
}

export const fleetSoundService = new FleetSoundService();

// Queue sound service for buildings, research, and shipyard
class QueueSoundService {
  private audioContext: AudioContext | null = null;
  private qBuildingBuffer: AudioBuffer | null = null;
  private qResearchBuffer: AudioBuffer | null = null;
  private qDefenseBuffer: AudioBuffer | null = null;
  private qShipyardBuffer: AudioBuffer | null = null;
  private isLoaded = false;

  async initialize() {
    if (this.isLoaded) return;

    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      )();

      // Load queue sounds
      const [
        qBuildingResponse,
        qResearchResponse,
        qDefenseResponse,
        qShipyardResponse,
      ] = await Promise.all([
        fetch(qBuilding),
        fetch(qResearch),
        fetch(qDefense),
        fetch(qShipyard),
      ]);

      const [
        qBuildingArrayBuffer,
        qResearchArrayBuffer,
        qDefenseArrayBuffer,
        qShipyardArrayBuffer,
      ] = await Promise.all([
        qBuildingResponse.arrayBuffer(),
        qResearchResponse.arrayBuffer(),
        qDefenseResponse.arrayBuffer(),
        qShipyardResponse.arrayBuffer(),
      ]);

      [
        this.qBuildingBuffer,
        this.qResearchBuffer,
        this.qDefenseBuffer,
        this.qShipyardBuffer,
      ] = await Promise.all([
        this.audioContext.decodeAudioData(qBuildingArrayBuffer),
        this.audioContext.decodeAudioData(qResearchArrayBuffer),
        this.audioContext.decodeAudioData(qDefenseArrayBuffer),
        this.audioContext.decodeAudioData(qShipyardArrayBuffer),
      ]);

      this.isLoaded = true;
    } catch (error) {
      console.warn("Failed to initialize queue sound service:", error);
    }
  }

  async playQueueSound(type: "building" | "research" | "defense" | "shipyard") {
    if (!settingsState.audio.effectsEnabled) {
      return;
    }

    // Lazy initialize if not loaded yet
    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.audioContext) {
      return;
    }

    let buffer: AudioBuffer | null = null;
    switch (type) {
      case "building":
        buffer = this.qBuildingBuffer;
        break;
      case "research":
        buffer = this.qResearchBuffer;
        break;
      case "defense":
        buffer = this.qDefenseBuffer;
        break;
      case "shipyard":
        buffer = this.qShipyardBuffer;
        break;
    }

    if (!buffer) return;

    try {
      // Resume audio context if needed
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Volume settings
      gainNode.gain.value = 0.3;

      source.start();
    } catch (error) {
      console.warn(`Failed to play ${type} queue sound:`, error);
    }
  }
}

// Global queue sound service instance
export const queueSoundService = new QueueSoundService();

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
    // Increment trigger to signal swoosh sound should play
    swooshTrigger.value++;
  },

  playScanSound() {
    scanSoundService.play();
  },

  stopScanSound() {
    scanSoundService.stop();
  },

  playQueueSound(type: "building" | "research" | "defense" | "shipyard") {
    queueSoundService.playQueueSound(type);
  },

  playInboxSound() {
    inboxSoundService.play();
  },

  playFleetSound(type: FleetSoundType) {
    fleetSoundService.play(type);
  },
};

// Graphics actions
export const graphicsActions = {
  setQuality(quality: QualityLevel) {
    settingsState.graphics.quality = quality;

    saveGraphicsQuality(quality);
  },
};

// Locale actions
// export const localeActions = {
//   setLocale(localeCode: LocaleCode) {
//     setLocale(localeCode);
//   },
// };

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

// Export all actions as a single object for convenience
export const settingsActions = {
  audio: audioActions,
  graphics: graphicsActions,
  // locale: localeActions,
  tab: tabActions,
  general: generalActions,
};
