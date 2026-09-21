// Per-frame lightning flash state, shared between the sky layers.
//
// WHY THIS EXISTS: the flash has two consumers that must agree frame-for-frame --
// Lightning.svelte (bolt, scene light, the slight sky wash) and CloudDeck.svelte (the
// deck lighting up from the inside, around the strike's azimuth). Neither may reach into
// the other, and a prop is not an option: per-frame numbers must never be reactive,
// or the component tree invalidates at flash rates -- literally the worst possible
// place for it.
//
// So this is a mini-descriptor: a PLAIN MUTABLE OBJECT with exactly one writer
// (Lightning's task, which owns the strike scheduler) and any number of readers, all in
// tasks, none tracked. Same contract as `descriptor` in the model, one effect smaller.
//
// If lightning ever needs to be multiplayer-synced (server-authoritative sky), this
// is the seam to fold in: the scheduler moves into the model and publishes here or into
// the descriptor proper, and the renderers keep reading unchanged.

/** Which kind of strike is live. A sheet is a cell backlighting itself; a bolt is a channel to the ground. */
export type StrikeKind = 'bolt' | 'sheet';

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
	 * Increments once per strike, at the instant it begins.
	 *
	 * A COUNTER, not a boolean or a timestamp. A boolean needs someone to clear it, which
	 * means two writers for one field; a timestamp cannot distinguish "no strike yet" from
	 * "a strike at time zero". A consumer stores the last id it acted on and compares --
	 * so a listener that mounts mid-storm simply picks up from the next strike rather than
	 * firing for one it never saw.
	 */
	strikeId: number;
	/**
	 * Rough distance to the current strike in world units, drawn per strike.
	 *
	 * Exists for the AUDIO: thunder is the same event as the flash, heard about three
	 * seconds per kilometre later, and that gap is most of what makes a storm feel like it
	 * has a size. The renderers do not use it -- the bolt quad is drawn at a fixed
	 * `distance` prop, because a bolt scaled by true distance would be a few pixels tall.
	 */
	strikeDistance: number;
	/**
	 * Kind of the strike that incremented `strikeId`. Exists for the AUDIO, like
	 * `strikeDistance`: a sheet is a cell backlighting itself somewhere back in the deck,
	 * with no channel to the ground, and a clap for every one of those is what made
	 * thunder read as too frequent. Audio decides from this which events may thunder.
	 * The renderers do not use it.
	 */
	strikeKind: StrikeKind;
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
	strikeId: 0,
	strikeDistance: 1200,
	strikeKind: 'bolt',
	strikeRequest: false
};

/** Force one lightning strike next frame (dev tooling -- see `strikeRequest`). */
export const requestStrike = (): void => {
	flashState.strikeRequest = true;
};
