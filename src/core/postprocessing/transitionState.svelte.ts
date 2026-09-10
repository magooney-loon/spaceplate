// SCENE TRANSITIONS — the shared state between the composite effect
// (effects/sceneTransition.ts), its driver (TransitionDriver.svelte) and the scene
// transition that orders them around ($extensions/scene).
//
// THE SNAPSHOT IS WHY THIS WORKS AT ALL. three's own `TransitionNode` crossfades two
// LIVE scene passes, which this engine cannot do: `{#if}` routing mounts exactly one
// scene and unmounting tears down its Rapier bodies. So side A is a FROZEN FRAME — an
// `rtt()` of the chain colour, captured on the last frame of the outgoing scene — and
// side B is the live scene. Everything the demo does with masks and thresholds still
// applies; only "both scenes are live" does not.
//
// THREE PHASES, NOT TWO, AND THE MIDDLE ONE IS A LOADING SCREEN. The first version
// held the frozen frame up for the WHOLE load and tried to keep it alive with a
// push-in and a blur. That fails exactly where it matters: those move on RENDERED
// frames, and a heavy scene's entry is mostly main-thread stalls (GLB parse, texture
// decode, synchronous pipeline creation) during which no frame is drawn at all — so
// the motion froze precisely when the player needed proof the app was alive. The
// sequence is now
//
//   DIP    the frozen frame dissolves to the veil colour (~0.4s, before the swap, while
//          the outgoing scene is still mounted and nothing is blocking)
//   HOLD   the load and the warm happen under a flat cover, and Loader.svelte's veil is
//          the whole picture — HTML, with CSS-driven motion, which keeps animating on
//          the compositor while the main thread is blocked
//   REVEAL the flat cover dissolves into the live scene
//
// IT IS CAPTURED AND MIXED IN THE CHAIN, i.e. in LINEAR working colour, pre-tonemap,
// and that is load-bearing: the frozen frame flows through the same grade, AA and
// output transform as the live one every frame, so at mix 1 the screen is the frame we
// captured rather than a double-tone-mapped copy of it. A canvas grab
// (`copyFramebufferToTexture`) would be display-referred and could not be mixed here.
//
// The lensState contract, as usual: the uniforms live at module scope so their identity
// survives a pipeline rebuild, there is ONE writer (the driver's task) and one reader
// (the effect's build).

import { uniform } from 'three/tsl';

/** 0 = the live scene, 1 = the cover. Read by the effect, written by the driver. */
export const uTransitionMix = uniform(0);

/**
 * How far the cover has drained to the veil colour: 0 = the frozen frame exactly as it
 * was captured, 1 = flat. It is also what the frozen frame's push-in, blur and
 * desaturation ride, so the whole degradation is a function of DIP PROGRESS rather than
 * of seconds held — a long load no longer walks it off the end of its own ramp, and the
 * reveal always starts from the same flat plate however long the load took.
 *
 * It stays at 1 for the whole hold, which also makes a mid-transition pipeline rebuild
 * invisible: the rebuilt effect registers a fresh, never-captured snapshot, and a
 * snapshot multiplied by zero is the veil colour either way.
 */
export const uTransitionVeil = uniform(0);

/** Where the driver is in the sequence. `Loader.svelte` fades its veil on this. */
export type TransitionPhase = 'idle' | 'capture' | 'dip' | 'hold' | 'reveal';

/**
 * Reactive half — the ONLY thing outside this module reads. `Loader.svelte` swaps its
 * black veil for a transparent status overlay while a frozen frame is doing the
 * covering (`covering`) and fades its content in and out on `phase`. `available` is
 * deliberately NOT reactive (a plain module boolean below): it is written from inside
 * Renderer.svelte's build effect, and a `$state` written there that anything in the
 * same effect read would be the read-plus-write loop.
 */
export const transitionFxState = $state<{ covering: boolean; phase: TransitionPhase }>({
	covering: false,
	phase: 'idle'
});

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
	/** Capture the current frame and start the dip. False = nothing to cover with. */
	cover: () => Promise<boolean>;
	/** Resolves when the dip is done and the screen is a flat cover. */
	settled: () => Promise<void>;
	/** Dissolve the cover into the live scene, honouring the minimum cover time. */
	reveal: () => Promise<void>;
};

let driver: TransitionDriver | null = null;

/** TransitionDriver.svelte registers on mount, clears on destroy. */
export function setTransitionDriver(next: TransitionDriver | null): void {
	driver = next;
}

/**
 * Begin covering: capture the outgoing scene's last frame and start dissolving it to
 * the veil colour. Returns false when there is no pipeline composite to do it with (low
 * quality bypasses post-processing entirely, the effect can be switched off, a build can
 * fail) — the caller then falls back to `Loader.svelte`'s black veil, which is why that
 * veil still exists.
 *
 * RESOLVES ON THE CAPTURE, not on the dip, so the caller can raise `isTransitioning`
 * and let the loading UI fade in ACROSS the dip rather than popping in after it.
 * `waitForCoverSettled()` is the other half.
 */
export async function coverWithSnapshot(): Promise<boolean> {
	if (driver === null || !available) return false;
	return driver.cover();
}

/**
 * Resolves once the screen is a flat cover and the swap is safe to make. A no-op when
 * nothing froze — the black-veil fallback has its own (rAF) wait in the caller.
 */
export async function waitForCoverSettled(): Promise<void> {
	if (driver === null || !transitionFxState.covering) return;
	await driver.settled();
}

/** Dissolve back to the live scene. A no-op when nothing is covering. */
export async function revealScene(): Promise<void> {
	if (driver === null || !transitionFxState.covering) return;
	await driver.reveal();
}
