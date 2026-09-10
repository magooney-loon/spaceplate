<script lang="ts">
	// The scene transition's one writer: captures the frozen frame, pins the mix while
	// the new scene loads and warms, then dissolves it away. Draws nothing. What the
	// snapshot is and why it is mixed in the chain: ./transitionState.svelte.ts.
	//
	// The task is `autoStart: false` with `autoInvalidate` LEFT ON — Warmup.svelte's
	// bargain and for the same reason: on-demand rendering would otherwise stop drawing
	// frames mid-dissolve (nothing else invalidates while a scene sits still), and an
	// `invalidate()` from inside a task that has already run is cleared before the next
	// frame reads it. It runs `{ before: autoRenderTask }` so the value it writes is the
	// one the frame about to be drawn uses, and it stops itself the moment it is idle.
	import { onDestroy } from 'svelte';
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { postprocessingState } from '$extensions/postprocessing';
	import {
		requestSnapshot,
		setTransitionDriver,
		snapshotPending,
		transitionFxState,
		uTransitionHold,
		uTransitionMix
	} from './transitionState.svelte';

	const { autoRenderTask } = useThrelte();

	/** Give up waiting for a capture after this many rendered frames — the caller then
	 *  falls back to the black veil rather than covering with a stale frame. */
	const CAPTURE_FRAME_LIMIT = 12;
	/** Floor on the dissolve, so a mis-set param can never strand the player behind a
	 *  frozen frame. */
	const MIN_REVEAL_SECONDS = 0.05;
	/** Dead man's switch: reveal on our own if the sequence that covered never comes
	 *  back for it (a throw between the cover and the reveal would otherwise leave the
	 *  cover up and this task forcing frames forever). */
	const HOLD_LIMIT_SECONDS = 60;

	/**
	 * THE TASK RUNS FOR THE WHOLE COVERED PERIOD, not just the capture and the dissolve,
	 * and 'hold' is why: the frozen frame pushes in and blurs while the new scene loads,
	 * which means those frames have to be drawn. It is also what the warm gate wants
	 * anyway — the load is exactly when the scene should be rendering into the void.
	 */
	type Mode = 'idle' | 'capture' | 'hold' | 'reveal';

	let mode: Mode = 'idle';
	let frames = 0;
	/** 1 = fully covered, 0 = fully revealed. Eased into the uniform, never written raw. */
	let progress = 0;
	/** Seconds the cover has been up — the effect's push-in, blur and drain ride on it. */
	let hold = 0;
	let resolveCapture: ((ok: boolean) => void) | null = null;
	let resolveReveal: (() => void) | null = null;

	const { start, stop } = useTask(
		(delta) => {
			if (mode === 'capture') {
				frames += 1;
				// RTTNode clears the flag on the frame it fills the target, so a cleared
				// flag means the snapshot now holds the frame we asked for.
				if (!snapshotPending()) {
					progress = 1;
					hold = 0;
					uTransitionHold.value = 0;
					uTransitionMix.value = 1;
					transitionFxState.covering = true;
					// Straight into 'hold' — the task keeps running and keeps drawing.
					mode = 'hold';
					resolveCapture?.(true);
					resolveCapture = null;
				} else if (frames >= CAPTURE_FRAME_LIMIT) {
					finishCapture(false);
				}
				return;
			}

			// Scene time in both branches below, like every other integration in the
			// engine: a capture take moves the cover at its own pace, not the wall clock's.
			if (mode === 'hold') {
				hold += delta;
				uTransitionHold.value = hold;
				// Nobody came back for the reveal — do it ourselves rather than hold the
				// screen and the render loop hostage.
				if (hold >= HOLD_LIMIT_SECONDS) {
					progress = 1;
					mode = 'reveal';
				}
				return;
			}

			if (mode === 'reveal') {
				// The push-in carries ON through the dissolve; motion that stops dead the
				// instant the new scene appears is what made the still frame read badly in
				// the first place.
				hold += delta;
				uTransitionHold.value = hold;

				progress -= delta / revealSeconds();
				if (progress <= 0) {
					progress = 0;
					uTransitionMix.value = 0;
					transitionFxState.covering = false;
					finishReveal();
				} else {
					// Smoothstep so the front eases in and out instead of starting at full
					// speed — the pattern does the shape, this does the pacing.
					uTransitionMix.value = progress * progress * (3 - 2 * progress);
				}
			}
		},
		{ before: autoRenderTask, autoStart: false }
	);

	const revealSeconds = (): number =>
		Math.max(MIN_REVEAL_SECONDS, postprocessingState.sceneTransition?.revealSeconds ?? 0.7);

	function finishCapture(ok: boolean): void {
		mode = 'idle';
		stop();
		resolveCapture?.(ok);
		resolveCapture = null;
	}

	function finishReveal(): void {
		mode = 'idle';
		stop();
		hold = 0;
		uTransitionHold.value = 0;
		resolveReveal?.();
		resolveReveal = null;
	}

	setTransitionDriver({
		cover: () =>
			new Promise<boolean>((resolve) => {
				// Not covered yet: the capture frame must still render the LIVE scene, or
				// it would freeze a frame of whatever the mix was showing.
				uTransitionMix.value = 0;
				transitionFxState.covering = false;
				resolveCapture = resolve;
				frames = 0;
				mode = 'capture';
				requestSnapshot();
				start();
			}),
		reveal: () =>
			new Promise<void>((resolve) => {
				resolveReveal = resolve;
				progress = 1;
				mode = 'reveal';
				start();
			})
	});

	onDestroy(() => {
		setTransitionDriver(null);
		// Never leave a frozen frame on screen if this unmounts mid-transition.
		uTransitionMix.value = 0;
		uTransitionHold.value = 0;
		transitionFxState.covering = false;
		resolveCapture?.(false);
		resolveReveal?.();
	});
</script>
