// Barrel for the flypath extension — import from '$extensions/flypath'.
// FlyPath.svelte (the in-Canvas driver) and FlyPathExtension.svelte (the Studio panel)
// stay path imports, both behind the VITE_GAME_ENGINE dynamic-import boundary.

export * from './flypath.svelte';
export type * from './types';
