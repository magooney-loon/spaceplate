import { logSkybox } from '$extensions/logger/logger.svelte';
import type { SkyState, SkyPreset, StarPreset, StarsState, TransitionState } from './types';

export type {
	SkyPreset,
	StarPreset,
	StarsState,
	SkyState,
	TransitionState,
	ExtensionState,
	ExtensionActions
} from './types';

export const STAR_PRESETS: Record<string, StarPreset> = {
	dense: {
		id: 'dense',
		name: 'Dense Stars',
		count: 8000,
		radius: 4.5,
		depth: 50,
		factor: 4,
		fade: true,
		lightness: 0.5,
		opacity: 1,
		saturation: 0.8,
		speed: 0.5
	},
	sparse: {
		id: 'sparse',
		name: 'Sparse Stars',
		count: 2000,
		radius: 4.5,
		depth: 30,
		factor: 6,
		fade: true,
		lightness: 0.4,
		opacity: 0.8,
		saturation: 0.5,
		speed: 0.2
	},
	twinkle: {
		id: 'twinkle',
		name: 'Twinkling',
		count: 5000,
		radius: 4.5,
		depth: 40,
		factor: 3,
		fade: true,
		lightness: 0.6,
		opacity: 1,
		saturation: 0.7,
		speed: 1.5
	},
	nebula: {
		id: 'nebula',
		name: 'Nebula',
		count: 3000,
		radius: 4.5,
		depth: 60,
		factor: 8,
		fade: true,
		lightness: 0.3,
		opacity: 0.6,
		saturation: 1.0,
		speed: 0.1
	},
	milkyway: {
		id: 'milkyway',
		name: 'Milky Way',
		count: 6000,
		radius: 4.5,
		depth: 80,
		factor: 2,
		fade: true,
		lightness: 0.4,
		opacity: 1,
		saturation: 0.9,
		speed: 0.3
	}
};

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
		exposure: 0.4,
		stars: {
			id: 'sparse',
			name: 'Sparse Stars',
			count: 1500,
			radius: 4.5,
			depth: 30,
			factor: 5,
			fade: true,
			lightness: 0.3,
			opacity: 0.5,
			saturation: 0.4,
			speed: 0.3
		}
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
		exposure: 1.0,
		stars: {
			id: 'none',
			name: 'No Stars',
			count: 0,
			radius: 4.5,
			depth: 50,
			factor: 4,
			fade: false,
			lightness: 0.5,
			opacity: 0,
			saturation: 0.5,
			speed: 0
		}
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
		exposure: 0.5,
		stars: {
			id: 'sparse',
			name: 'Sparse Stars',
			count: 2000,
			radius: 4.5,
			depth: 35,
			factor: 5,
			fade: true,
			lightness: 0.35,
			opacity: 0.6,
			saturation: 0.45,
			speed: 0.25
		}
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
		exposure: 0.15,
		stars: {
			id: 'dense',
			name: 'Dense Stars',
			count: 8000,
			radius: 4.5,
			depth: 50,
			factor: 4,
			fade: true,
			lightness: 0.5,
			opacity: 1,
			saturation: 0.8,
			speed: 0.5
		}
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
		exposure: 0.6,
		stars: {
			id: 'twinkle',
			name: 'Twinkling',
			count: 4000,
			radius: 4.5,
			depth: 40,
			factor: 3,
			fade: true,
			lightness: 0.5,
			opacity: 0.8,
			saturation: 0.6,
			speed: 1.2
		}
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
		exposure: 0.5,
		stars: {
			id: 'sparse',
			name: 'Sparse Stars',
			count: 1800,
			radius: 4.5,
			depth: 32,
			factor: 5,
			fade: true,
			lightness: 0.32,
			opacity: 0.55,
			saturation: 0.42,
			speed: 0.28
		}
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
		exposure: 0.7,
		stars: {
			id: 'none',
			name: 'No Stars',
			count: 0,
			radius: 4.5,
			depth: 50,
			factor: 4,
			fade: false,
			lightness: 0.5,
			opacity: 0,
			saturation: 0.5,
			speed: 0
		}
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
		exposure: 0.5,
		stars: {
			id: 'none',
			name: 'No Stars',
			count: 0,
			radius: 4.5,
			depth: 50,
			factor: 4,
			fade: false,
			lightness: 0.5,
			opacity: 0,
			saturation: 0.5,
			speed: 0
		}
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
		exposure: 0.2,
		stars: {
			id: 'milkyway',
			name: 'Milky Way',
			count: 6000,
			radius: 4.5,
			depth: 80,
			factor: 2,
			fade: true,
			lightness: 0.4,
			opacity: 1,
			saturation: 0.9,
			speed: 0.3
		}
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
		exposure: 1.5,
		stars: {
			id: 'dense',
			name: 'Dense Stars',
			count: 10000,
			radius: 4.5,
			depth: 100,
			factor: 2,
			fade: true,
			lightness: 0.6,
			opacity: 1,
			saturation: 0.9,
			speed: 0.2
		}
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

const defaultStarsState = (): StarsState => ({
	enabled: true,
	count: 5000,
	radius: 4.5,
	depth: 50,
	factor: 4,
	fade: true,
	lightness: 0.5,
	opacity: 1,
	saturation: 0.5,
	speed: 0.5,
	layer1Count: 720,
	layer2Count: 540,
	layer1Speed: 0.72,
	layer2Speed: 0.2,
	layer1Factor: 1.45,
	layer2Factor: 1.9
});

const defaultTransitionState = (): TransitionState => ({
	isTransitioning: false,
	fromPreset: null,
	toPreset: null,
	progress: 0,
	startTime: 0,
	duration: 2000,
	transitionDuration: 2000
});

export const skyboxState = $state<SkyState>(defaultState());
export const starsState = $state<StarsState>(defaultStarsState());
export const transitionState = $state<TransitionState>(defaultTransitionState());

export const TRANSITION_DURATIONS = [
	{ value: 0, text: 'Instant' },
	{ value: 500, text: '0.5s' },
	{ value: 1000, text: '1s' },
	{ value: 2000, text: '2s' },
	{ value: 3000, text: '3s' },
	{ value: 5000, text: '5s' }
];

let animationFrameId: number | null = null;

const lerp = (start: number, end: number, t: number): number => {
	return start + (end - start) * t;
};

const easeInOutCubic = (t: number): number => {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const normalizeAngle = (angle: number): number => {
	while (angle > 180) angle -= 360;
	while (angle < -180) angle += 360;
	return angle;
};

const lerpAngle = (start: number, end: number, t: number): number => {
	const diff = normalizeAngle(end - start);
	return start + diff * t;
};

const interpolateStarPreset = (from: StarPreset, to: StarPreset, t: number) => {
	const eased = easeInOutCubic(t);
	starsState.count = Math.round(lerp(from.count, to.count, eased));
	starsState.radius = lerp(from.radius, to.radius, eased);
	starsState.depth = lerp(from.depth, to.depth, eased);
	starsState.factor = lerp(from.factor, to.factor, eased);
	starsState.fade = t < 0.5 ? from.fade : to.fade;
	starsState.lightness = lerp(from.lightness, to.lightness, eased);
	starsState.opacity = lerp(from.opacity, to.opacity, eased);
	starsState.saturation = lerp(from.saturation, to.saturation, eased);
	starsState.speed = lerp(from.speed, to.speed, eased);

	starsState.layer1Count = Math.round(lerp(from.count * 0.6, to.count * 0.6, eased));
	starsState.layer2Count = Math.round(lerp(from.count * 0.45, to.count * 0.45, eased));
	starsState.layer1Speed = lerp(from.speed * 1.5, to.speed * 1.5, eased);
	starsState.layer2Speed = lerp(from.speed * 0.4, to.speed * 0.4, eased);
	starsState.layer1Factor = lerp(from.factor * 0.7, to.factor * 0.7, eased);
	starsState.layer2Factor = lerp(from.factor * 0.95, to.factor * 0.95, eased);
};

const transitionToPreset = (fromPreset: SkyPreset, toPreset: SkyPreset, duration: number) => {
	if (animationFrameId !== null) {
		cancelAnimationFrame(animationFrameId);
	}

	const fromSky = {
		turbidity: fromPreset.turbidity,
		rayleigh: fromPreset.rayleigh,
		azimuth: fromPreset.azimuth,
		elevation: fromPreset.elevation,
		mieCoefficient: fromPreset.mieCoefficient,
		mieDirectionalG: fromPreset.mieDirectionalG,
		exposure: fromPreset.exposure
	};

	const toSky = {
		turbidity: toPreset.turbidity,
		rayleigh: toPreset.rayleigh,
		azimuth: toPreset.azimuth,
		elevation: toPreset.elevation,
		mieCoefficient: toPreset.mieCoefficient,
		mieDirectionalG: toPreset.mieDirectionalG,
		exposure: toPreset.exposure
	};

	const fromStars: StarPreset = {
		id: 'current',
		name: 'Current',
		count: fromPreset.stars?.count ?? 5000,
		radius: fromPreset.stars?.radius ?? 4.5,
		depth: fromPreset.stars?.depth ?? 50,
		factor: fromPreset.stars?.factor ?? 4,
		fade: fromPreset.stars?.fade ?? true,
		lightness: fromPreset.stars?.lightness ?? 0.5,
		opacity: fromPreset.stars?.opacity ?? 1,
		saturation: fromPreset.stars?.saturation ?? 0.5,
		speed: fromPreset.stars?.speed ?? 0.5
	};

	const toStars: StarPreset = {
		id: 'target',
		name: 'Target',
		count: toPreset.stars?.count ?? 5000,
		radius: toPreset.stars?.radius ?? 4.5,
		depth: toPreset.stars?.depth ?? 50,
		factor: toPreset.stars?.factor ?? 4,
		fade: toPreset.stars?.fade ?? true,
		lightness: toPreset.stars?.lightness ?? 0.5,
		opacity: toPreset.stars?.opacity ?? 1,
		saturation: toPreset.stars?.saturation ?? 0.5,
		speed: toPreset.stars?.speed ?? 0.5
	};

	transitionState.isTransitioning = true;
	transitionState.fromPreset = fromPreset.id;
	transitionState.toPreset = toPreset.id;
	transitionState.progress = 0;
	transitionState.startTime = performance.now();
	transitionState.duration = duration;

	const animate = (currentTime: number) => {
		const elapsed = currentTime - transitionState.startTime;
		const rawProgress = Math.min(elapsed / transitionState.duration, 1);
		transitionState.progress = rawProgress;

		const eased = easeInOutCubic(rawProgress);

		skyboxState.turbidity = lerp(fromSky.turbidity, toSky.turbidity, eased);
		skyboxState.rayleigh = lerp(fromSky.rayleigh, toSky.rayleigh, eased);
		skyboxState.azimuth = lerpAngle(fromSky.azimuth, toSky.azimuth, eased);
		skyboxState.elevation = lerp(fromSky.elevation, toSky.elevation, eased);
		skyboxState.mieCoefficient = lerp(fromSky.mieCoefficient, toSky.mieCoefficient, eased);
		skyboxState.mieDirectionalG = lerp(fromSky.mieDirectionalG, toSky.mieDirectionalG, eased);
		skyboxState.exposure = lerp(fromSky.exposure, toSky.exposure, eased);

		interpolateStarPreset(fromStars, toStars, eased);

		if (rawProgress < 1) {
			animationFrameId = requestAnimationFrame(animate);
		} else {
			transitionState.isTransitioning = false;
			transitionState.fromPreset = null;
			transitionState.toPreset = null;
			transitionState.progress = 0;
			animationFrameId = null;
		}
	};

	animationFrameId = requestAnimationFrame(animate);
};

export const skyboxActions = {
	reset() {
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		transitionState.isTransitioning = false;
		transitionState.fromPreset = null;
		transitionState.toPreset = null;
		transitionState.progress = 0;

		const defaults = defaultState();
		Object.assign(skyboxState, defaults);

		const starDefaults = defaultStarsState();
		Object.assign(starsState, starDefaults);

		logSkybox.info('Skybox reset to defaults');
	},

	applyPreset(presetId: string) {
		const preset = SKY_PRESETS[presetId];
		if (!preset) {
			logSkybox.warn(`Unknown skybox preset: ${presetId}`);
			return;
		}

		const duration = transitionState.transitionDuration;

		if (duration <= 0) {
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId);
				animationFrameId = null;
			}
			transitionState.isTransitioning = false;

			skyboxState.turbidity = preset.turbidity;
			skyboxState.rayleigh = preset.rayleigh;
			skyboxState.azimuth = preset.azimuth;
			skyboxState.elevation = preset.elevation;
			skyboxState.mieCoefficient = preset.mieCoefficient;
			skyboxState.mieDirectionalG = preset.mieDirectionalG;
			skyboxState.exposure = preset.exposure;

			if (preset.stars) {
				const s = preset.stars;
				starsState.count = s.count ?? 5000;
				starsState.radius = s.radius ?? 4.5;
				starsState.depth = s.depth ?? 50;
				starsState.factor = s.factor ?? 4;
				starsState.fade = s.fade ?? true;
				starsState.lightness = s.lightness ?? 0.5;
				starsState.opacity = s.opacity ?? 1;
				starsState.saturation = s.saturation ?? 0.5;
				starsState.speed = s.speed ?? 0.5;
				starsState.layer1Count = Math.round((s.count ?? 5000) * 0.6);
				starsState.layer2Count = Math.round((s.count ?? 5000) * 0.45);
				starsState.layer1Speed = (s.speed ?? 0.5) * 1.5;
				starsState.layer2Speed = (s.speed ?? 0.5) * 0.4;
				starsState.layer1Factor = (s.factor ?? 4) * 0.7;
				starsState.layer2Factor = (s.factor ?? 4) * 0.95;
			}

			logSkybox.info(`Skybox preset applied (instant): ${preset.name}`);
		} else {
			const currentPreset: SkyPreset = {
				id: 'current',
				name: 'Current',
				turbidity: skyboxState.turbidity,
				rayleigh: skyboxState.rayleigh,
				azimuth: skyboxState.azimuth,
				elevation: skyboxState.elevation,
				mieCoefficient: skyboxState.mieCoefficient,
				mieDirectionalG: skyboxState.mieDirectionalG,
				exposure: skyboxState.exposure,
				stars: {
					id: 'current',
					name: 'Current',
					count: starsState.count,
					radius: starsState.radius,
					depth: starsState.depth,
					factor: starsState.factor,
					fade: starsState.fade,
					lightness: starsState.lightness,
					opacity: starsState.opacity,
					saturation: starsState.saturation,
					speed: starsState.speed
				}
			};

			transitionToPreset(currentPreset, preset, duration);
			logSkybox.info(`Skybox transition started: → ${preset.name} (${duration}ms)`);
		}
	},

	setTransitionDuration(duration: number) {
		transitionState.transitionDuration = duration;
	},

	applyStarPreset(presetId: string) {
		const preset = STAR_PRESETS[presetId];
		if (!preset) {
			logSkybox.warn(`Unknown star preset: ${presetId}`);
			return;
		}

		starsState.count = preset.count;
		starsState.radius = preset.radius;
		starsState.depth = preset.depth;
		starsState.factor = preset.factor;
		starsState.fade = preset.fade;
		starsState.lightness = preset.lightness;
		starsState.opacity = preset.opacity;
		starsState.saturation = preset.saturation;
		starsState.speed = preset.speed;

		starsState.layer1Count = Math.round(preset.count * 0.6);
		starsState.layer2Count = Math.round(preset.count * 0.45);
		starsState.layer1Speed = preset.speed * 1.5;
		starsState.layer2Speed = preset.speed * 0.4;
		starsState.layer1Factor = preset.factor * 0.7;
		starsState.layer2Factor = preset.factor * 0.95;

		starsState.enabled = preset.count > 0;

		logSkybox.info(`Star preset applied: ${preset.name}`);
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
	},

	toggleStars() {
		starsState.enabled = !starsState.enabled;
		logSkybox.info(`Stars: ${starsState.enabled ? 'enabled' : 'disabled'}`);
	},

	setStarsCount(value: number) {
		starsState.count = value;
		starsState.layer1Count = Math.round(value * 0.6);
		starsState.layer2Count = Math.round(value * 0.45);
	},

	setStarsSpeed(value: number) {
		starsState.speed = value;
		starsState.layer1Speed = value * 1.5;
		starsState.layer2Speed = value * 0.4;
	},

	setStarsFade(value: boolean) {
		starsState.fade = value;
	}
};
