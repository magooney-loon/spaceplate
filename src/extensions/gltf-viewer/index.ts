// Barrel for the gltf-viewer extension (dev-only) — import from '$extensions/gltf-viewer'.
// Components (GltfViewerExtension.svelte, GltfViewerScene.svelte, GltfViewerInstance.svelte)
// stay path imports behind the VITE_GAME_ENGINE dynamic-import boundary.

export * from './gltfViewer.svelte';
export type * from './types';
