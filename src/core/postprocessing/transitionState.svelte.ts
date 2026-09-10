// SCENE TRANSITIONS — the shared state between the composite effect
// (effects/sceneTransition.ts), its driver (TransitionDriver.svelte) and the scene
// transition that orders them around ($extensions/scene).
//
// THE SNAPSHOT IS WHY THIS WORKS AT ALL. three's own `TransitionNode` crossfades two
// LIVE scene passes, which this engine cannot do: `{#if}` routing mounts exactly one
// scene and unmounting tears down its Rapier bodies. So side A is a FROZEN FRAME — an
// `rtt()` of the chain colour, captured on the last frame of the outgoing scene and
// held while the new one loads and warms — and side B is the live scene. Everything
// the demo does with masks and thresholds still applies; only "both scenes are live"
// does not.
//
// IT IS CAPTURED AND MIXED IN THE CHAIN, i.e. in LINEAR working colour, pre-tonemap,
// and that is load-bearing: the frozen frame then flows through the same grade, AA and
// output transform as the live one every frame, so at mix 1 the screen is the frame we
// captured rather than a double-tone-mapped copy of it. A canvas grab
// (`copyFramebufferToTexture`) would be display-referred and could not be mixed here.
//
// The lensState contract, as usual: the uniform lives at module scope so its identity
// survives a pipeline rebuild, there is ONE writer (the driver's task) and one reader
// (the effect's build).

import { uniform } from 'three/tsl';

/** 0 = the live scene, 1 = the frozen snapshot. Read by the effect, written by the driver. */
export const uTransitionMix = uniform(0);

/**
 * Seconds the cover has been up, 0 when it is not. THE FROZEN FRAME MOVES, and this is
 * what moves it: the effect ramps a push-in, a mip blur and a desaturation off it, so a
 * long load reads as a deliberate transition rather than a hung frame. It keeps rising
 * through the reveal too — the motion should never stop dead just as the new scene
 * arrives.
 */
export const uTransitionHold = uniform(0);

/**
 * Reactive half — the ONLY thing outside this module reads: `Loader.svelte` swaps its
 * black veil for a transparent status overlay while a frozen frame is doing the
 * covering. `available` is deliberately NOT reactive (a plain module boolean below):
 * it is written from inside Renderer.svelte's build effect, and a `$state` written
 * there that anything in the same effect read would be the read-plus-write loop.
 */
export const transitionFxState = $state({ covering: false });

/** The RTT node the effect builds, or null when the composite is not in the graph. */
let snapshot: { textureNeedsUpdate: boolean } | null = null;
let available = false;

/**
 * Called by the effect's `build` with its fresh RTT node, and by Renderer.svelte with
 * `null` before every rebuild (and on bypass) — the node is disposed with the build, so
 * a stale reference must never be poked.
 */
export function registerSnapshot(node: { textureNeedsUpdate: boolean } | null): void {
	snapshot = node;
	available = node !== null;
}

/** Ask for the next rendered frame to be copied into the snapshot target. */
export function requestSnapshot(): void {
	if (snapshot !== null) snapshot.textureNeedsUpdate = true;
}

/** True until the frame that fills the target has rendered (RTTNode clears the flag). */
export function snapshotPending(): boolean {
	return snapshot !== null && snapshot.textureNeedsUpdate;
}

export type TransitionDriver = {
	/** Capture the current frame and pin the mix to it. False = nothing to cover with. */
	cover: () => Promise<boolean>;
	/** Dissolve the frozen frame into the live scene. */
	reveal: () => Promise<void>;
};

let driver: TransitionDriver | null = null;

/** TransitionDriver.svelte registers on mount, clears on destroy. */
export function setTransitionDriver(next: TransitionDriver | null): void {
	driver = next;
}

/**
 * Freeze the outgoing scene's last frame over the screen. Returns false when there is
 * no pipeline composite to do it with (low quality bypasses post-processing entirely,
 * the effect can be switched off, a build can fail) — the caller then falls back to
 * `Loader.svelte`'s black veil, which is why that veil still exists.
 */
export async function coverWithSnapshot(): Promise<boolean> {
	if (driver === null || !available) return false;
	return driver.cover();
}

/** Dissolve back to the live scene. A no-op when nothing is covering. */
export async function revealScene(): Promise<void> {
	if (driver === null || !transitionFxState.covering) return;
	await driver.reveal();
}
