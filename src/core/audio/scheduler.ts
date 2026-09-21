// Scene time (engineClock.elapsed) <-> AudioContext time. Web Audio only schedules in
// context seconds, so this module owns the conversion:
//
//   contextTime = anchorContext + (sceneTime - anchorScene)
//
// The map is affine with slope 1: intervals carry over unchanged in realtime and inside
// a take alike, only the origin moves. In realtime the anchor re-glues every frame; once
// a fixed-step source (a capture take) claims the engine clock the anchor freezes, and
// the gap that opens from there is the audio/video drift (see schedulerDrift()). The
// live graph during a take is only a monitor — correctness comes from render.ts replaying
// scene-time stamps offline, not from pacing the live context to the take's actual rate.

import { engineClock } from '$core/utils/engineClock';
import { audioContext } from './registry';

let anchorScene = 0;
let anchorContext = 0;
let wasFixed = false;

/** Scene seconds since boot — the unit every public audio timestamp is in. */
export const sceneNow = (): number => engineClock.elapsed;

/** Re-anchor for this frame. Called once per frame by AudioRuntime's task, before
 * anything schedules a voice. */
export const tickScheduler = (): void => {
	const context = audioContext();
	if (!context) return;

	if (!engineClock.fixed) {
		// Realtime: keep the anchor glued to now, absorbing rAF/hardware clock drift.
		anchorScene = engineClock.elapsed;
		anchorContext = context.currentTime;
		wasFixed = false;
		return;
	}

	if (!wasFixed) {
		// Handover into a take: freeze the anchor here.
		anchorScene = engineClock.elapsed;
		anchorContext = context.currentTime;
		wasFixed = true;
	}
};

/** Scene seconds → AudioContext seconds, for `source.start()` / `source.stop()`. */
export const toContextTime = (sceneTime: number): number =>
	anchorContext + (sceneTime - anchorScene);

/** AudioContext seconds → scene seconds. */
export const toSceneTime = (contextTime: number): number =>
	anchorScene + (contextTime - anchorContext);

/**
 * How far the live audio clock has run ahead of scene time since a take claimed the
 * engine clock, in seconds. Zero in realtime. Finished takes don't contain this drift —
 * it's removed by the offline render — this is only the live gauge mid-take.
 */
export const schedulerDrift = (): number => {
	const context = audioContext();
	if (!context || !engineClock.fixed) return 0;
	return context.currentTime - anchorContext - (engineClock.elapsed - anchorScene);
};
