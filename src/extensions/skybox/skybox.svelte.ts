// Environment-mode state for the skybox: procedural sky vs HDR/EXR vs cubemap.
//
// This module used to be the 888-line preset machine (sky scalars, star presets,
// transition lerps, localStorage user presets). That layer dissolved into the
// time-driven sky model in $core/skybox/model (DOCS/weather-system.md §10): the scalars are
// derived outputs of the day curve, presets became keyframes, and the Studio panel
// drives time through skyActions instead of writing sky parameters by hand.
//
// What survives here is orthogonal to time and weather: WHICH environment lights the
// scene. The mode choice and last-picked textures persist to localStorage as a dev
// convenience -- authored sky data is a different story entirely (§16).

import { logSkybox } from '$extensions/logger';
import { ENV_TEXTURES, CUBE_TEXTURES } from './envTextures';
import type { EnvironmentState } from './types';

export { ENV_TEXTURES, CUBE_TEXTURES } from './envTextures';

export type { EnvironmentState, SkyboxMode, EnvTextureEntry, CubeTextureEntry } from './types';

const ENV_MODE_KEY = 'spaceplate-skybox-env-mode';
const ENV_TEXTURE_KEY = 'spaceplate-skybox-env-texture';
const ENV_CUBE_KEY = 'spaceplate-skybox-env-cube';

const loadEnvState = (): EnvironmentState => {
	try {
		return {
			mode: (localStorage.getItem(ENV_MODE_KEY) as EnvironmentState['mode']) ?? 'sky',
			envTextureId: localStorage.getItem(ENV_TEXTURE_KEY),
			envIsBackground: true,
			envGround: false,
			cubeTextureId: localStorage.getItem(ENV_CUBE_KEY),
			cubeIsBackground: true
		};
	} catch {
		return {
			mode: 'sky',
			envTextureId: null,
			envIsBackground: true,
			envGround: false,
			cubeTextureId: null,
			cubeIsBackground: true
		};
	}
};

export const environmentState = $state<EnvironmentState>(loadEnvState());

export const skyboxActions = {
	setMode(mode: EnvironmentState['mode']) {
		environmentState.mode = mode;
		try {
			localStorage.setItem(ENV_MODE_KEY, mode);
		} catch {
			/* ignore */
		}
		logSkybox.info(`Skybox mode: ${mode}`);
	},

	setEnvTexture(id: string | null) {
		environmentState.envTextureId = id;
		try {
			if (id) localStorage.setItem(ENV_TEXTURE_KEY, id);
			else localStorage.removeItem(ENV_TEXTURE_KEY);
		} catch {
			/* ignore */
		}
		const entry = id ? ENV_TEXTURES.find((t) => t.id === id) : null;
		logSkybox.info(`Environment texture: ${entry?.name ?? 'none'}`);
	},

	setCubeTexture(id: string | null) {
		environmentState.cubeTextureId = id;
		try {
			if (id) localStorage.setItem(ENV_CUBE_KEY, id);
			else localStorage.removeItem(ENV_CUBE_KEY);
		} catch {
			/* ignore */
		}
		const entry = id ? CUBE_TEXTURES.find((t) => t.id === id) : null;
		logSkybox.info(`Cube texture: ${entry?.name ?? 'none'}`);
	},

	toggleEnvBackground() {
		environmentState.envIsBackground = !environmentState.envIsBackground;
	},

	toggleCubeBackground() {
		environmentState.cubeIsBackground = !environmentState.cubeIsBackground;
	},

	toggleEnvGround() {
		environmentState.envGround = !environmentState.envGround;
	}
};
