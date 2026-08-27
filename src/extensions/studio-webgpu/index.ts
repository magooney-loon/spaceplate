// Barrel for the studio-webgpu compat extension (dev-only) —
// import from '$extensions/studio-webgpu'.
//
// Unlike the other extensions this one registers no Studio scope and has no toolbar
// UI: it exists purely to keep @threlte/studio working against WebGPURenderer.
// StudioWebgpuCompat.svelte stays a path import (it mounts inside <Canvas>, not in
// the toolbar), and patchRendererForStudio must be callable from createRenderer.

export * from './studioWebgpu';
