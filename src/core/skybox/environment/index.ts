// Barrel for the skybox environment mode — import from '$core/skybox/environment'.
// Modules inside this folder import each other relatively, never via this barrel.
// environment.svelte.ts re-exports the texture lists and the types alongside its own
// state, so one `export *` covers the public surface.

export * from './environment.svelte';
