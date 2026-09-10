<script lang="ts">
	// The scene transition's one writer: captures the frozen frame, dissolves it to the
	// veil colour, holds while the new scene loads and warms, then dissolves the veil
	// into the live scene. Draws nothing. What the snapshot is, why it is mixed in the
	// chain and why the middle phase is a loading screen: ./transitionState.svelte.ts.
	//
	// THE TASK ONLY RUNS FOR THE TWO ANIMATED PHASES. During the hold it stops itself,
	// and that is deliberate: nothing on screen is moving (the cover is flat), so
	// forcing full-rate frames of a half-mounted scene through the whole download would
	// be pure waste. The warm gate starts its own forced-frame loop when it is that
	// phase's turn (core/utils/Warmup.svelte) — the two no longer overlap.
	//
	// While it does run it is `autoStart: false` with `autoInvalidate` LEFT ON —
	// Warmup.svelte's bargain and for the same reason: on-demand rendering would
	// otherwise stop drawing frames mid-dissolve (nothing else invalidates while a scene
	// sits still), and an `invalidate()` from inside a task that has already run is
	// cleared before the next frame reads it. It runs `{ before: autoRenderTask }` so the
	// value it writes is the one the frame about to be drawn uses.
	import { onDestroy } from 'svelte';
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { postprocessingState } from '$extensions/postprocessing';
	import {
		requestSnapshot,
		setTransitionDriver,
		snapshotPending,
		transitionFxState,
		uTransitionMix,
		uTransitionVeil
	} from './transitionState.svelte';

	const { autoRenderTask } = useThrelte();

	/** Give up waiting for a capture after this many rendered frames — the caller then
	 *  falls back to the black veil rather than covering with a stale frame. */
	const CAPTURE_FRAME_LIMIT = 12;
	/** Floors on the two dissolves, so a mis-set param can never strand the player
	 *  behind a cover or snap a scene in with no transition at all. */
	const MIN_DIP_SECONDS = 0.05;
	const MIN_REVEAL_SECONDS = 0.05;
	/** Dead man's switch: reveal on our own if the sequence that covered never comes
	 *  back for it (a throw between the cover and the reveal would otherwise leave the
	 *  cover up forever). Wall-clock, because the task is stopped through the hold. */
	const HOLD_LIMIT_MS = 60_000;

	type Mode = 'idle' | 'capture' | 'dip' | 'hold' | 'reveal';

	let mode: Mode = 'idle';
	let frames = 0;
	/** 0 → 1 across the dip. Eased into `uTransitionVeil`, never written raw. */
	let dip = 0;
	/** 1 = fully covered, 0 = fully revealed. Eased into `uTransitionMix`. */
	let progress = 0;
	/**
	 * When the cover went up, WALL-CLOCK, for the minimum-cover floor. Wall clock on the
	 * asset gate's rationale: the floor exists so a cached re-entry does not flash the
	 * loading UI for two frames, which is a fact about the player's eyes and not about
	 * scene time. The dissolves themselves stay on the task's delta like everything else.
	 */
	let coveredSince = 0;
	let deadMan: ReturnType<typeof setTimeout> | null = null;
	let floorTimer: ReturnType<typeof setTimeout> | null = null;
	let resolveCapture: ((ok: boolean) => void) | null = null;
	let resolveSettled: (() => void) | null = null;
	let resolveReveal: (() => void) | null = null;

	const { start, stop } = useTask(
		(delta) => {
			if (mode === 'capture') {
				frames += 1;
				// RTTNode clears the flag on the frame it fills the target, so a cleared
				// flag means the snapshot now holds the frame we asked for.
				if (!snapshotPending()) {
					dip = 0;
					uTransitionVeil.value = 0;
					uTransitionMix.value = 1;
					transitionFxState.covering = true;
					transitionFxState.phase = 'dip';
					coveredSince = Date.now();
					// Straight into the dip — the task keeps running and keeps drawing.
					mode = 'dip';
					resolveCapture?.(true);
					resolveCapture = null;
				} else if (frames >= CAPTURE_FRAME_LIMIT) {
					finishCapture(false);
				}
				return;
			}

			// Scene time in both branches below, like every other integration in the
			// engine: a capture take moves the dissolves at its own pace, not the clock's.
			if (mode === 'dip') {
				dip += delta / dipSeconds();
				if (dip >= 1) {
					dip = 1;
					uTransitionVeil.value = 1;
					enterHold();
				} else {
					uTransitionVeil.value = ease(dip);
				}
				return;
			}

			if (mode === 'reveal') {
				progress -= delta / revealSeconds();
				if (progress <= 0) {
					progress = 0;
					uTransitionMix.value = 0;
					uTransitionVeil.value = 0;
					transitionFxState.covering = false;
					transitionFxState.phase = 'idle';
					finishReveal();
				} else {
					// Smoothstep so the front eases in and out instead of starting at full
					// speed — the pattern does the shape, this does the pacing.
					uTransitionMix.value = ease(progress);
				}
			}
		},
		{ before: autoRenderTask, autoStart: false }
	);

	const ease = (t: number): number => t * t * (3 - 2 * t);

	const dipSeconds = (): number =>
		Math.max(MIN_DIP_SECONDS, postprocessingState.sceneTransition?.veilSeconds ?? 0.4);

	const revealSeconds = (): number =>
		Math.max(MIN_REVEAL_SECONDS, postprocessingState.sceneTransition?.revealSeconds ?? 0.7);

	const minCoverMs = (): number =>
		Math.max(0, postprocessingState.sceneTransition?.minCoverSeconds ?? 0.9) * 1000;

	/** The cover is flat: stop drawing for it and let the load have the main thread. */
	function enterHold(): void {
		mode = 'hold';
		transitionFxState.phase = 'hold';
		stop();
		deadMan = setTimeout(startReveal, HOLD_LIMIT_MS);
		resolveSettled?.();
		resolveSettled = null;
	}

	function startReveal(): void {
		clearTimers();
		progress = 1;
		mode = 'reveal';
		transitionFxState.phase = 'reveal';
		start();
	}

	function clearTimers(): void {
		if (deadMan !== null) clearTimeout(deadMan);
		if (floorTimer !== null) clearTimeout(floorTimer);
		deadMan = null;
		floorTimer = null;
	}

	function finishCapture(ok: boolean): void {
		mode = 'idle';
		transitionFxState.phase = 'idle';
		stop();
		resolveCapture?.(ok);
		resolveCapture = null;
		// Nothing ever covered, so nothing is waiting for a flat cover either.
		resolveSettled?.();
		resolveSettled = null;
	}

	function finishReveal(): void {
		mode = 'idle';
		stop();
		dip = 0;
		resolveReveal?.();
		resolveReveal = null;
	}

	setTransitionDriver({
		cover: () =>
			new Promise<boolean>((resolve) => {
				// Not covered yet: the capture frame must still render the LIVE scene, or
				// it would freeze a frame of whatever the mix was showing.
				uTransitionMix.value = 0;
				uTransitionVeil.value = 0;
				transitionFxState.covering = false;
				transitionFxState.phase = 'capture';
				resolveCapture = resolve;
				frames = 0;
				mode = 'capture';
				requestSnapshot();
				start();
			}),
		settled: () =>
			new Promise<void>((resolve) => {
				if (mode === 'hold' || mode === 'idle') resolve();
				else resolveSettled = resolve;
			}),
		reveal: () =>
			new Promise<void>((resolve) => {
				resolveReveal = resolve;
				// THE MINIMUM COVER TIME. A re-entry into an already-cached scene resolves
				// its asset and warm gates in a couple of frames, and without this floor the
				// loading UI would strobe on and straight back off. With it, every switch
				// has the same shape whatever it cost to load.
				const waited = Date.now() - coveredSince;
				const remaining = Math.max(0, minCoverMs() - waited);
				if (remaining === 0) startReveal();
				else floorTimer = setTimeout(startReveal, remaining);
			})
	});

	onDestroy(() => {
		setTransitionDriver(null);
		clearTimers();
		// Never leave a cover on screen if this unmounts mid-transition.
		uTransitionMix.value = 0;
		uTransitionVeil.value = 0;
		transitionFxState.covering = false;
		transitionFxState.phase = 'idle';
		resolveCapture?.(false);
		resolveSettled?.();
		resolveReveal?.();
	});
</script>
