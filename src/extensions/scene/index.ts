// Barrel for the scene extension — import from '$extensions/scene'.
// Components (SceneExtension.svelte) stay path imports; intra-extension
// modules import each other relatively, not via this barrel.

export * from './scene.svelte';
export { BUNDLED_SCENE_PRESETS, BUNDLED_GLOBAL_PRESETS } from './bundledPresets';
export type * from './types';
