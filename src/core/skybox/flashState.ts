// Per-frame lightning flash state, shared between the sky layers.
//
// WHY THIS EXISTS: the flash has two consumers that must agree frame-for-frame --
// Lightning.svelte (bolt, scene light, the slight sky wash) and CloudDeck.svelte (the
// deck lighting up from the inside, around the strike's azimuth). Neither may reach into
// the other, and a prop is not an option: per-frame numbers must never be reactive
// (DOCS/weather-system.md §14.1), or the component tree invalidates at flash rates --
// literally the worst possible place for it.
//
// So this is a mini-descriptor: a PLAIN MUTABLE OBJECT with exactly one writer
// (Lightning's task, which owns the strike scheduler) and any number of readers, all in
// tasks, none tracked. Same contract as `descriptor` in the model, one effect smaller.
//
// If lightning ever needs to be multiplayer-synced (§6, server-authoritative sky), this
// is the seam to fold in: the scheduler moves into the model and publishes here or into
// the descriptor proper, and the renderers keep reading unchanged.

export type FlashState = {
	/**
	 * Sky/scene flash envelope, ~0..0.55. Already attack-softened and amplitude-capped at
	 * the source -- consumers must not scale it back up. See the photosafety notes
	 * in Lightning.svelte.
	 */
	flash: number;
	/** Strike direction, world space, Y up, unit length. Constant for a strike's life. */
	direction: { x: number; y: number; z: number };
	/**
	 * Dev/testing hook: force one BOLT strike on the next frame. Written by callers
	 * (Studio's Strike button), consumed and cleared by Lightning's scheduler -- one
	 * writer per field, like everything here. Fires even at a dead channel, because
	 * tuning the bolt's look should not mean waiting for a storm to roll in.
	 */
	strikeRequest: boolean;
};

export const flashState: FlashState = {
	flash: 0,
	direction: { x: 0, y: 0.6, z: 0.8 },
	strikeRequest: false
};

/** Force one lightning strike next frame (dev tooling -- see `strikeRequest`). */
export const requestStrike = (): void => {
	flashState.strikeRequest = true;
};
