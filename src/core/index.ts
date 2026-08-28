// Barrel for src/core — import engine parts from '$core'.
// Note: modules inside core/ import each other directly (not via this barrel)
// to avoid circular module graphs.

export { default as Camera } from './Camera.svelte';
export { default as GlobalAudio } from './GlobalAudio.svelte';
export { default as Keymapper } from './Keymapper.svelte';
export { default as Loader } from './Loader.svelte';
export { default as MouseLook } from './MouseLook.svelte';
export { default as Renderer } from './Renderer.svelte';
export { default as Skybox } from './skybox/Skybox.svelte';
export { default as SkyLight } from './skybox/SkyLight.svelte';

// The sky model façade — everything sky/skybox/weather lives in core/skybox/.
export {
	descriptor,
	skyMeta,
	skyActions,
	skyQueries,
	on as onSky,
	off as offSky
} from './skybox/model';
export type { SkyDescriptor, PhaseName, DayKeyframe, ClockKind } from './skybox/model';

export { soundTriggers, soundActions } from './globalAudio.svelte';
export { BASE_SENS, mouseLookState, mouseLookActions } from './mouseLook.svelte';
export type { MouseLookState } from './mouseLook.svelte';
export { useGameTasks } from './tasks';
export type { GameStages, GameTasks, TaskOptions, TaskReturn } from './tasks';
