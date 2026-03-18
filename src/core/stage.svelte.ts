import { soundActions } from '$core/Sound.svelte';
import { log } from '$core/settings.svelte.js';

export type StageType = 'settings' | 'home' | 'galaxy';

export type StageConfig = {
	id: StageType;
	label: string;
	icon: string;
};

export const STAGES: StageConfig[] = [
	{
		id: 'home',
		label: 'Home',
		icon: 'mdiHome'
	},
	{
		id: 'galaxy',
		label: 'Galaxy',
		icon: 'mdiEarth'
	},
	{
		id: 'settings',
		label: 'Settings',
		icon: 'mdiCog'
	}
];

export interface StageState {
	currentStage: StageType;
	previousStage: StageType | null;
	isTransitioning: boolean;
}

export const stageState = $state<StageState>({
	currentStage: 'home',
	previousStage: null,
	isTransitioning: false
});

export const stageActions = {
	setStage(stage: StageType) {
		if (stageState.currentStage === stage) return;

		log.info(`Stage: ${stageState.currentStage} → ${stage}`);
		soundActions.playSwoosh();

		stageState.previousStage = stageState.currentStage;
		stageState.currentStage = stage;
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

		stageState.isTransitioning = true;

		await new Promise((r) => setTimeout(r, transitionDuration / 2));
		this.setStage(stage);
		await new Promise((r) => setTimeout(r, transitionDuration / 2));

		stageState.isTransitioning = false;
	}
};
