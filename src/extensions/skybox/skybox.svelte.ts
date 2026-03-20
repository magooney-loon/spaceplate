import { logSkybox } from '$extensions/logger/logger.svelte';
import type { SkyState, SkyPreset } from './types';

export type { SkyPreset, SkyState, ExtensionState, ExtensionActions } from './types';

export const SKY_PRESETS: Record<string, SkyPreset> = {
	dawn: {
		id: 'dawn',
		name: 'Dawn',
		turbidity: 3,
		rayleigh: 1.5,
		azimuth: 90,
		elevation: 5,
		mieCoefficient: 0.004,
		mieDirectionalG: 0.85,
		exposure: 0.4
	},
	day: {
		id: 'day',
		name: 'Day',
		turbidity: 2,
		rayleigh: 1,
		azimuth: 180,
		elevation: 75,
		mieCoefficient: 0.003,
		mieDirectionalG: 0.8,
		exposure: 1.0
	},
	dusk: {
		id: 'dusk',
		name: 'Dusk',
		turbidity: 5,
		rayleigh: 2,
		azimuth: 270,
		elevation: 3,
		mieCoefficient: 0.005,
		mieDirectionalG: 0.9,
		exposure: 0.5
	},
	night: {
		id: 'night',
		name: 'Night',
		turbidity: 0.1,
		rayleigh: 0.1,
		azimuth: 180,
		elevation: -10,
		mieCoefficient: 0.0001,
		mieDirectionalG: 0.5,
		exposure: 0.15
	},
	sunset: {
		id: 'sunset',
		name: 'Sunset',
		turbidity: 10,
		rayleigh: 3,
		azimuth: 225,
		elevation: 2,
		mieCoefficient: 0.005,
		mieDirectionalG: 0.7,
		exposure: 0.6
	},
	sunrise: {
		id: 'sunrise',
		name: 'Sunrise',
		turbidity: 8,
		rayleigh: 2.5,
		azimuth: 45,
		elevation: 3,
		mieCoefficient: 0.004,
		mieDirectionalG: 0.75,
		exposure: 0.5
	},
	cloudy: {
		id: 'cloudy',
		name: 'Cloudy',
		turbidity: 15,
		rayleigh: 0.5,
		azimuth: 180,
		elevation: 45,
		mieCoefficient: 0.02,
		mieDirectionalG: 0.9,
		exposure: 0.7
	},
	overcast: {
		id: 'overcast',
		name: 'Overcast',
		turbidity: 20,
		rayleigh: 0.3,
		azimuth: 180,
		elevation: 60,
		mieCoefficient: 0.03,
		mieDirectionalG: 0.95,
		exposure: 0.5
	},
	aurora: {
		id: 'aurora',
		name: 'Aurora',
		turbidity: 0.05,
		rayleigh: 0.2,
		azimuth: 180,
		elevation: 30,
		mieCoefficient: 0.00005,
		mieDirectionalG: 0.3,
		exposure: 0.2
	},
	vacuum: {
		id: 'vacuum',
		name: 'Vacuum',
		turbidity: 0,
		rayleigh: 0,
		azimuth: 180,
		elevation: 90,
		mieCoefficient: 0,
		mieDirectionalG: 0,
		exposure: 1.5
	}
};

const defaultState = (): SkyState => ({
	turbidity: 10,
	rayleigh: 3,
	azimuth: 180,
	elevation: 2,
	mieCoefficient: 0.005,
	mieDirectionalG: 0.7,
	exposure: 0.5,
	setEnvironment: true,
	cubeMapSize: 128,
	scale: 1000
});

export const skyboxState = $state<SkyState>(defaultState());

export const skyboxActions = {
	reset() {
		const defaults = defaultState();
		Object.assign(skyboxState, defaults);
		logSkybox.info('Skybox reset to defaults');
	},

	applyPreset(presetId: string) {
		const preset = SKY_PRESETS[presetId];
		if (!preset) {
			logSkybox.warn(`Unknown skybox preset: ${presetId}`);
			return;
		}
		skyboxState.turbidity = preset.turbidity;
		skyboxState.rayleigh = preset.rayleigh;
		skyboxState.azimuth = preset.azimuth;
		skyboxState.elevation = preset.elevation;
		skyboxState.mieCoefficient = preset.mieCoefficient;
		skyboxState.mieDirectionalG = preset.mieDirectionalG;
		skyboxState.exposure = preset.exposure;
		logSkybox.info(`Skybox preset applied: ${preset.name}`);
	},

	setTurbidity(value: number) {
		skyboxState.turbidity = value;
	},

	setRayleigh(value: number) {
		skyboxState.rayleigh = value;
	},

	setAzimuth(value: number) {
		skyboxState.azimuth = value;
	},

	setElevation(value: number) {
		skyboxState.elevation = value;
	},

	setMieCoefficient(value: number) {
		skyboxState.mieCoefficient = value;
	},

	setMieDirectionalG(value: number) {
		skyboxState.mieDirectionalG = value;
	},

	setExposure(value: number) {
		skyboxState.exposure = value;
	},

	toggleEnvironment() {
		skyboxState.setEnvironment = !skyboxState.setEnvironment;
		logSkybox.info(`Sky environment: ${skyboxState.setEnvironment ? 'enabled' : 'disabled'}`);
	}
};
