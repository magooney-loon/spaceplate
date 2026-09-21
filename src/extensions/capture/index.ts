// Barrel for the capture extension — import from '$extensions/capture'.
// Capture.svelte (the in-Canvas driver) and CaptureExtension.svelte (the Studio panel)
// stay path imports: the driver's mount position in App.svelte is load-bearing for render
// task ordering, and the panel sits behind the VITE_GAME_ENGINE dynamic-import boundary.

export * from './capture.svelte';
export type * from './types';
