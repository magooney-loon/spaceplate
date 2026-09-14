// Who renders the key light's shadow map, and from which camera — see ../CLAUDE.md
// ("The shadow frustum is fitted to the CAMERA"). Armed from `core/utils/Renderer.svelte`
// immediately before the main draw, not from SkyLight's own task, because the cascades
// fit to whichever camera renders them first; arming here means the main camera fits
// them and every other pass in the frame reuses that atlas, one frame stale.
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
