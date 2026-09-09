// WHO RENDERS THE KEY LIGHT'S SHADOW MAP, AND FROM WHICH CAMERA.
//
// One shadow render per frame, shared by every render pass in it. Node shadows are
// deduped only per camera per `render()` call (`ShadowNode.updateBefore`: it renders
// whenever `shadow.needsUpdate || shadow.autoUpdate`), so with `autoUpdate` left on,
// every extra camera in the frame re-renders the map: DemoScene's two cube captures are
// six scene renders each, plus the mirror-floor reflector, plus TestGame's rear-view
// mirror, plus Studio's PiP. `SkyLight.svelte` therefore turns `autoUpdate` OFF and
// something arms `needsUpdate` exactly once a frame; the first pass to render pays for
// the map and every later pass reuses it.
//
// WHAT CHANGED WITH CASCADES, and why this is a module rather than a line in SkyLight's
// task: `SunLightShadow` fits its two cascades to the frustum of **whichever camera is
// rendering** (`SunShadowNode.renderShadow` calls `shadow.updateMatrices(light,
// frame.camera)`). "The first pass to render pays" therefore stopped being a free
// choice — it decides what the shadow map covers. Armed from SkyLight's own task
// (`before: autoRenderTask`), the first payer would be whatever pass runs next, and in
// TestGame that is the rear-view mirror: the cascades would be fitted to a camera
// looking BACKWARD from the car and the main view would light itself from an atlas that
// does not contain the car at all.
//
// So the arming moved to `core/utils/Renderer.svelte`, immediately before the main
// draw. The main camera fits the cascades; every other pass in the frame reuses that
// atlas, one frame stale for the passes that run ahead of it. Stale-but-correct beats
// fresh-but-fitted-to-a-mirror, and a shadow map lagging a frame behind a mirror image
// is not a thing anyone can see.
//
// One writer (SkyLight, on mount/unmount), one caller (Renderer, per frame). Same
// shape as `layers/lightning/flashState.ts`, one effect smaller.

/** The live key light's shadow, or null while no `SkyLight` is mounted. */
let keyShadow: { needsUpdate: boolean } | null = null;

/**
 * Registers (or clears, with `null`) the shadow the frame should render. Called by
 * `SkyLight.svelte` alone — a second caller would mean a second key light, which the
 * engine does not have.
 */
export const setKeyShadow = (shadow: { needsUpdate: boolean } | null): void => {
	keyShadow = shadow;
};

/**
 * Marks the key light's shadow for one render this frame. Call it from the pass that
 * should own the fit — the main draw — and nowhere else.
 */
export const armKeyShadow = (): void => {
	if (keyShadow !== null) keyShadow.needsUpdate = true;
};
