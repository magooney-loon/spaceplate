// Environment-mode state for the skybox: procedural sky vs HDR/EXR vs cubemap.
//
// WHY THIS LIVES IN CORE, NOT THE EXTENSION: `Skybox.svelte` switches on this state in
// every build, which makes it engine state -- extensions are dev-mode add-ons. It used
// to sit in extensions/skybox as `skybox.svelte.ts` (the 888-line preset machine's last
// surviving piece); the Studio panel now drives it through `environmentActions`, the
// same "panel is just another caller" doctrine as skyActions (DOCS/weather-system.md
// §8, §10).
//
// What this owns is orthogonal to time and weather: WHICH environment lights the
// scene. The mode choice and last-picked textures persist to localStorage as a dev
// convenience -- authored sky data is a different story entirely (§16).

import { logSkybox } from '$extensions/logger';
import { ENV_TEXTURES, CUBE_TEXTURES } from './environmentTextures';
import type { EnvironmentState } from './types';

export { ENV_TEXTURES, CUBE_TEXTURES } from './environmentTextures';

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

export const environmentActions = {
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
