// Barrel for the skybox extension — import from '$extensions/skybox'.
// SkyboxExtension.svelte stays a path import.

export * from './skybox.svelte'; // also re-exports ENV_TEXTURES / CUBE_TEXTURES
export { BUNDLED_SKYBOX_PRESETS } from './bundledPresets';
export type * from './types';
