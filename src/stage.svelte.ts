import type { CameraControlsRef } from '@threlte/extras';
import { soundActions } from './Sound.svelte';
import { settingsState, log } from './settings.svelte.js';

export type StageType = 'settings' | 'home' | 'galaxy';

export type StageConfig = {
	id: StageType;
	label: string;
	icon: string;
	camera: (controls: CameraControlsRef, animated: boolean) => void;
};

export const STAGES: StageConfig[] = [
	{
		id: 'home',
		label: 'Home',
		icon: 'mdiHome',
		camera(controls, animated) {
			controls.reset(animated);
			controls.moveTo(0, 1.8, 0, animated);
		}
	},
	{
		id: 'galaxy',
		label: 'Galaxy',
		icon: 'mdiEarth',
		camera(controls, animated) {
			controls.reset(animated);
			controls.moveTo(0, 7.2, 0, animated);
			controls.lookInDirectionOf(0, 10, -20, animated);
			controls.zoomTo(0.27, animated);
		}
	},
	{
		id: 'settings',
		label: 'Settings',
		icon: 'mdiCog',
		camera(controls, animated) {
			controls.reset(animated);
		}
	}
];

export interface StageState {
	currentStage: StageType;
	previousStage: StageType | null;
	isTransitioning: boolean;
}

let cameraControls = $state<CameraControlsRef | undefined>(undefined);

export const stageState = $state<StageState>({
	currentStage: 'home',
	previousStage: null,
	isTransitioning: false
});

function applyCamera(stage: StageType) {
	if (!cameraControls) return;
	const animated = settingsState.graphics.quality !== 'low';
	STAGES.find((s) => s.id === stage)?.camera(cameraControls, animated);
}

export const stageActions = {
	setStage(stage: StageType) {
		if (stageState.currentStage === stage) return;

		log.info(`Stage: ${stageState.currentStage} → ${stage}`);
		soundActions.playSwoosh();

		stageState.previousStage = stageState.currentStage;
		stageState.currentStage = stage;
		applyCamera(stage);
	},

	goToSettings() {
		this.setStage('settings');
	},

	goToHome() {
		this.setStage('home');
	},

	goToGalaxy() {
		this.setStage('galaxy');
	},

	goBack() {
		if (stageState.previousStage) {
			this.setStage(stageState.previousStage);
		}
	},

	async transitionTo(stage: StageType, transitionDuration = 300) {
		if (stageState.currentStage === stage) return;

		const animated = settingsState.graphics.quality !== 'low';
		stageState.isTransitioning = true;

		if (animated) await new Promise((r) => setTimeout(r, transitionDuration / 2));
		this.setStage(stage);
		if (animated) await new Promise((r) => setTimeout(r, transitionDuration / 2));

		stageState.isTransitioning = false;
	}
};

export const cameraActions = {
	setCameraControls(controls: CameraControlsRef | undefined) {
		cameraControls = controls;
		if (controls) applyCamera(stageState.currentStage);
	}
};
