import type { CameraControlsRef } from "@threlte/extras";
import { soundActions } from "./sound.svelte.js";
import { settingsState } from "./settings.svelte.js";

export type StageType = "settings" | "home" | "galaxy";

export interface StageState {
  currentStage: StageType;
  previousStage: StageType | null;
  isTransitioning: boolean;
}

// Camera control state
let cameraControls = $state<CameraControlsRef | undefined>(undefined);

export const stageState = $state<StageState>({
  currentStage: "home",
  previousStage: null,
  isTransitioning: false,
});

export const isSettingsStage = () => stageState.currentStage === "settings";
export const isHomeStage = () => stageState.currentStage === "home";
export const isGalaxyStage = () => stageState.currentStage === "galaxy";
export const canGoBack = () => stageState.previousStage !== null;

export const stageActions = {
  setStage(stage: StageType) {
    if (stageState.currentStage === stage) return;

    soundActions.playSwoosh();

    stageState.previousStage = stageState.currentStage;
    stageState.currentStage = stage;
  },

  goToSettings() {
    this.setStage("settings");
  },

  goToHome() {
    this.setStage("home");
  },

  goToGalaxy() {
    this.setStage("galaxy");
  },

  goBack() {
    if (stageState.previousStage) {
      soundActions.playSwoosh();

      const previous = stageState.previousStage;
      stageState.previousStage = stageState.currentStage;
      stageState.currentStage = previous;

      cameraActions.applyCameraForStage(previous);
    }
  },

  setTransitioning(isTransitioning: boolean) {
    stageState.isTransitioning = isTransitioning;
  },

  async transitionTo(stage: StageType, transitionDuration = 300) {
    if (stageState.currentStage === stage) return;

    const isAnimated = settingsState.graphics.quality !== "low";
    stageState.isTransitioning = true;

    if (isAnimated) {
      await new Promise((resolve) =>
        setTimeout(resolve, transitionDuration / 2),
      );
    }

    this.setStage(stage);

    if (isAnimated) {
      await new Promise((resolve) =>
        setTimeout(resolve, transitionDuration / 2),
      );
    }

    stageState.isTransitioning = false;
  },
};

export const cameraActions = {
  setCameraControls(controls: CameraControlsRef | undefined) {
    cameraControls = controls;
    if (controls) {
      this.applyCameraForStage(stageState.currentStage);
    }
  },

  applyCameraForStage(stage: StageType) {
    if (!cameraControls) return;

    const isAnimated = settingsState.graphics.quality !== "low";

    switch (stage) {
      case "settings":
        // Default reset position — camera looks at the scene straight on
        cameraControls.reset(isAnimated);
        break;

      case "home":
        // Slightly elevated view for the home/main stage
        cameraControls.reset(isAnimated);
        cameraControls.moveTo(0, 1.8, 0, isAnimated);
        break;

      case "galaxy":
        // Wide top-down-ish view for the galaxy/map stage
        cameraControls.reset(isAnimated);
        cameraControls.moveTo(0, 7.2, -12, isAnimated);
        cameraControls.lookInDirectionOf(0, 10, -20, isAnimated);
        cameraControls.zoomTo(0.27, isAnimated);
        break;
    }
  },
};

export const getCurrentStage = () => stageState.currentStage;
export const getPreviousStage = () => stageState.previousStage;
export const getIsTransitioning = () => stageState.isTransitioning;
