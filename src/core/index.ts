// Barrel for src/core — import engine parts from '$core'.
// Note: modules inside core/ import each other directly (not via this barrel)
// to avoid circular module graphs.
//
// Layout: audio/ input/ skybox/ utils/ hold the grouped engine parts;
// Camera stays at the root as a plain scene primitive.

export { default as Camera } from './Camera.svelte';

// audio/
export { default as GlobalAudio } from './audio/GlobalAudio.svelte';
export { soundTriggers, soundActions } from './audio/globalAudio.svelte';

// input/
export { default as Keymapper } from './input/Keymapper.svelte';
export { default as MouseLook } from './input/MouseLook.svelte';
export { BASE_SENS, mouseLookState, mouseLookActions } from './input/mouseLook.svelte';
export type { MouseLookState } from './input/mouseLook.svelte';

// skybox/ — everything sky/skybox/weather
export { default as Skybox } from './skybox/Skybox.svelte';
export { default as SkyLight } from './skybox/SkyLight.svelte';
export {
	descriptor,
	skyMeta,
	skyActions,
	skyQueries,
	on as onSky,
	off as offSky
} from './skybox/model';
export type { SkyDescriptor, PhaseName, DayKeyframe, ClockKind } from './skybox/model';

// utils/
export { default as Loader } from './utils/Loader.svelte';
export { default as Renderer } from './utils/Renderer.svelte';
