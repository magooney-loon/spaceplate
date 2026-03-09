import type { CameraControlsRef } from "@threlte/extras";
import { audioActions, settingsState } from "./settings.svelte.js";
import { profileGetters } from "$lib/game/profile.svelte.js";

export type StageType = "settings" | "home" | "galaxy";

export interface StageState {
  currentStage: StageType;
  previousStage: StageType | null;
  isTransitioning: boolean;
}

// Camera control state
let cameraControls = $state<CameraControlsRef | undefined>(undefined);

export const stageState = $state<StageState>({
  currentStage: "settings",
  previousStage: null,
  isTransitioning: false,
});

export const isSettingsStage = () => stageState.currentStage === "settings";
export const isHomeStage = () => stageState.currentStage === "home";
export const isGalaxyStage = () => stageState.currentStage === "galaxy";
export const canGoBack = () => stageState.previousStage !== null;

export const stageActions = {
  setStage(stage: StageType) {
    if (stageState.currentStage === stage) {
      return; // No change needed
    }

    // Play swoosh sound when changing stages
    audioActions.playSwooshSound();

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

  startGame() {
    // Convenience method for PLAY NOW button - goes from settings to home
    this.setStage("home");
  },

  goBack() {
    if (stageState.previousStage) {
      // Play swoosh sound when going back
      audioActions.playSwooshSound();

      const previous = stageState.previousStage;
      stageState.previousStage = stageState.currentStage;
      stageState.currentStage = previous;

      // If going back to home, check if we're viewing a moon
      if (previous === "home") {
        const selectedPlanet = profileGetters.selectedPlanet;
        if (selectedPlanet?.celestialBodyType === "Moon") {
          cameraActions.applyCameraForMoon();
        } else {
          cameraActions.applyCameraForStage("home");
        }
      }
    }
  },

  setTransitioning(isTransitioning: boolean) {
    stageState.isTransitioning = isTransitioning;
  },

  async transitionTo(stage: StageType, transitionDuration = 300) {
    if (stageState.currentStage === stage) {
      return;
    }

    const isAnimated = settingsState.graphics.quality !== "low";
    stageState.isTransitioning = true;

    if (isAnimated) {
      // Allow for transition effects
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
  // Inject camera controls from Camera.svelte
  setCameraControls(controls: CameraControlsRef | undefined) {
    cameraControls = controls;
    // Apply current stage camera position when controls are set
    if (controls) {
      this.applyCameraForStage(stageState.currentStage);
    }
  },

  // Apply camera position based on stage
  applyCameraForStage(stage: StageType) {
    if (!cameraControls) return;

    const isAnimated = settingsState.graphics.quality !== "low";

    switch (stage) {
      case "settings":
        // Default position - reset to origin
        cameraControls.reset(isAnimated);

        break;
      case "home":
        // Truck the camera at an angle for home stage
        cameraControls.reset(isAnimated);
        cameraControls.moveTo(0, 1.8, 0, isAnimated);

        break;
      case "galaxy":
        // Default position for now - can be customized later
        cameraControls.reset(isAnimated);
        cameraControls.moveTo(0, 7.2, -12, isAnimated);
        cameraControls.lookInDirectionOf(0, 10, -20, isAnimated);
        cameraControls.zoomTo(0.27, isAnimated);

        break;
    }
  },

  // Apply camera position for moon view (when selecting a moon)
  // Moon is at position [1.2, 3.6, -3]
  applyCameraForMoon() {
    if (!cameraControls) return;

    const isAnimated = settingsState.graphics.quality !== "low";

    // Move camera to focus on the moon position (upper right, behind planet)
    cameraControls.reset(isAnimated);
    cameraControls.moveTo(1.2, 3.6, -10, isAnimated);
  },
};

export const getCurrentStage = () => stageState.currentStage;
export const getPreviousStage = () => stageState.previousStage;
export const getIsTransitioning = () => stageState.isTransitioning;
