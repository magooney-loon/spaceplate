// Boot coordination between the Loader UI (a sibling OUTSIDE <Canvas> — no Threlte
// context there) and the engine parts inside it. A .svelte.ts module so both sides
// share the same reactive state, the pattern used across core/ and extensions/.
//
// - warmVersion: bump to ask Renderer.svelte for one warm frame through the real
//   render pipeline (bumped by the scene warmup sweep in extensions/scene; each
//   bump = one render while the loading screen still covers the canvas).
// - scenesWarmed: latched by the warmup sweep when every scene has been visited,
//   mounted and warm-rendered. Loader.svelte gates the sound prompt on it.

export const bootState = $state({
	/** Monotonic — every change triggers one warm render in Renderer.svelte. */
	warmVersion: 0,
	/** True once the boot warmup sweep has finished; latches, never resets. */
	scenesWarmed: false
});
