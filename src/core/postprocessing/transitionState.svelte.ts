// Scene transitions — the shared state between the composite effect
// (effects/sceneTransition.ts), its driver (TransitionDriver.svelte) and the scene
// transition that orders them around ($extensions/scene).
//
// The snapshot is why this works at all: three's own `TransitionNode` crossfades two
// live scene passes, which this engine cannot do since `{#if}` routing mounts exactly
// one scene and unmounting tears down its Rapier bodies. So side A is a frozen frame —
// an `rtt()` of the chain colour, captured on the outgoing scene's last frame — and
// side B is the live scene.
//
// Three phases, and the middle one is a loading screen. An earlier version held the
// frozen frame up for the whole load with a push-in and blur, which fails because a
// heavy scene's entry is mostly main-thread stalls with no frame drawn at all — the
// motion froze exactly when the player needed proof the app was alive. Now:
//
//   DIP    the frozen frame dissolves to the veil colour (~0.4s, before the swap)
//   HOLD   load + warm happen under a flat cover; Loader.svelte's CSS veil is the
//          whole picture, animating on the compositor while the main thread is blocked
//   REVEAL the flat cover dissolves into the live scene
//
// Captured and mixed in the chain (linear working colour, pre-tonemap) so the frozen
// frame goes through the same grade/AA/output transform as the live one every frame —
// a canvas grab would be display-referred and couldn't be mixed here.
//
// The uniforms live at module scope so their identity survives a pipeline rebuild;
// one writer (the driver's task), one reader (the effect's build).

import { uniform } from 'three/tsl';

/** 0 = the live scene, 1 = the cover. Read by the effect, written by the driver. */
export const uTransitionMix = uniform(0);

/**
 * How far the cover has drained to the veil colour: 0 = the frozen frame exactly as
 * captured, 1 = flat. Also drives the frozen frame's push-in, blur and desaturation, so
 * the degradation is a function of dip progress rather than seconds held — the reveal
 * always starts from the same flat plate however long the load took. Stays at 1 for
 * the whole hold, which also makes a mid-transition pipeline rebuild invisible: a
 * snapshot multiplied by zero is the veil colour either way.
 */
export const uTransitionVeil = uniform(0);

/** Where the driver is in the sequence. `Loader.svelte` fades its veil on this. */
export type TransitionPhase = 'idle' | 'capture' | 'dip' | 'hold' | 'reveal';

/**
 * Reactive half — the only thing outside this module reads. `Loader.svelte` swaps its
 * black veil for a transparent status overlay while a frozen frame is covering
 * (`covering`) and fades content on `phase`. `available` is deliberately not reactive
 * below: it's written from inside Renderer.svelte's build effect, and a `$state`
 * written there that the same effect read would be a read-plus-write loop.
 */
export const transitionFxState = $state<{ covering: boolean; phase: TransitionPhase }>({
	covering: false,
	phase: 'idle'
});

/** The RTT node the effect builds, or null when the composite is not in the graph. */
let snapshot: { textureNeedsUpdate: boolean } | null = null;
let available = false;

/** Called by the effect's `build` with its fresh RTT node, and by Renderer.svelte with
 * `null` before every rebuild — the node is disposed with the build, so a stale
 * reference must never be poked. */
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
 * the veil colour. Returns false when there's no pipeline composite to do it with (low
 * quality, the effect disabled, a failed build) — the caller falls back to
 * `Loader.svelte`'s black veil. Resolves on the capture, not the dip, so the caller can
 * let the loading UI fade in across the dip rather than popping in after it.
 */
export async function coverWithSnapshot(): Promise<boolean> {
	if (driver === null || !available) return false;
	return driver.cover();
}

/** Resolves once the screen is a flat cover and the swap is safe to make. A no-op when
 * nothing froze — the black-veil fallback has its own (rAF) wait in the caller. */
export async function waitForCoverSettled(): Promise<void> {
	if (driver === null || !transitionFxState.covering) return;
	await driver.settled();
}

/** Dissolve back to the live scene. A no-op when nothing is covering. */
export async function revealScene(): Promise<void> {
	if (driver === null || !transitionFxState.covering) return;
	await driver.reveal();
}
