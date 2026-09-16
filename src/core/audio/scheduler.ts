// THE AUDIO SCHEDULER — the one place scene time meets the AudioContext clock.
//
// Every timestamp the audio layer accepts is SCENE seconds (`engineClock.elapsed`,
// core/utils/engineClock.ts), never `context.currentTime`. Web Audio can only be
// scheduled in context seconds, so this module owns the conversion — and, just as
// importantly, owns the fact that the two clocks DISAGREE while a capture take is in
// flight.
//
//   contextTime = anchorContext + (sceneTime − anchorScene)
//
// The map is AFFINE WITH SLOPE 1, which is the thing to understand about it:
//
//   - INTERVALS are preserved exactly, always. A `delay` of 2 scene-seconds is always
//     scheduled 2 context-seconds out, in realtime and inside a take alike. So this
//     conversion changes no observable behaviour in a normal session — it makes the
//     UNIT explicit so step 5 can replay a take against it.
//   - The ORIGIN is what moves. In realtime the anchor is re-glued every frame, so scene
//     and context time stay locked together. When a fixed-step source takes the clock
//     the anchor FREEZES, and from that moment the gap between the two is exactly the
//     audio/video drift `capture/` documents — see `schedulerDrift()`.
//
// Why slope 1 rather than tracking the take's actual rate: a take's rate is whatever the
// renderer manages that frame, it is not known in advance, and it changes constantly. The
// live graph during a take is a MONITOR (DOCS/AUDIO.md) — what it plays is a best-effort
// approximation and nothing in a recording depends on it. The recording's correctness
// comes from replaying scene-time stamps offline, not from pacing the live context.

import { engineClock } from '$core/utils/engineClock';
import { audioContext } from './registry';

let anchorScene = 0;
let anchorContext = 0;
let wasFixed = false;

/** Scene seconds since boot — the unit every public audio timestamp is in. */
export const sceneNow = (): number => engineClock.elapsed;

/**
 * Re-anchor for this frame. Called once per frame by `AudioRuntime`'s task, before the
 * consumers that schedule anything.
 *
 * Ordering caveat: it is a plain main-stage task, so a scene's own audio tick could run
 * before it on the frame a take starts and use the previous anchor. That is one frame of
 * slop in a monitor, and the recorded scene-time stamps are unaffected.
 */
export const tickScheduler = (): void => {
	const context = audioContext();
	if (!context) return;

	if (!engineClock.fixed) {
		// Realtime: the two clocks run at the same rate, so keep the anchor glued to now.
		// Re-gluing every frame also absorbs the small, real drift between rAF time and
		// the audio hardware clock, which a once-at-boot anchor would accumulate.
		anchorScene = engineClock.elapsed;
		anchorContext = context.currentTime;
		wasFixed = false;
		return;
	}

	if (!wasFixed) {
		// Handover into a take. Freeze here: from now on wall time runs ahead of scene
		// time by however much the renderer is behind, and that difference is the drift.
		anchorScene = engineClock.elapsed;
		anchorContext = context.currentTime;
		wasFixed = true;
	}
};

/** Scene seconds → AudioContext seconds, for `source.start()` / `source.stop()`. */
export const toContextTime = (sceneTime: number): number =>
	anchorContext + (sceneTime - anchorScene);

/** AudioContext seconds → scene seconds. The inverse; step 5 stamps recorded events with it. */
export const toSceneTime = (contextTime: number): number =>
	anchorScene + (contextTime - anchorContext);

/**
 * How far the live audio clock has run ahead of scene time since a take claimed the
 * engine clock, in seconds. Zero in realtime.
 *
 * THIS IS THE CAPTURE DRIFT, measured rather than estimated: the video track is
 * `frameCount / fps` scene-seconds while the live tap records wall-seconds, so this is
 * exactly how far the finished file's sound would run ahead of its picture. Step 5
 * removes the drift by rendering the audio offline; until then it is at least visible.
 */
export const schedulerDrift = (): number => {
	const context = audioContext();
	if (!context || !engineClock.fixed) return 0;
	return context.currentTime - anchorContext - (engineClock.elapsed - anchorScene);
};
