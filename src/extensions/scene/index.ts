// Barrel for the scene extension — import from '$extensions/scene'.
// Components (SceneExtension.svelte) stay path imports; intra-extension
// modules import each other relatively, not via this barrel.

export * from './scene.svelte';
export type * from './types';
