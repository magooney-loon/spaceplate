// The engine clock — one source of scene time for the whole app (rules in
// core/utils/CLAUDE.md; this header is the mechanism).
//
// Everything animated integrates a `delta` off Threlte's scheduler, which normally
// runs on the wall clock — wrong when something must render slower than realtime on
// purpose (an offline capture take timestamps frame N at exactly N/fps however long
// it took to draw). The substitution happens at `Scheduler.run`: the scheduler derives
// delta as `time - lastTime`, so handing it a fabricated timestamp
// (`lastTime + step * 1000`) makes every stage, task and Rapier's accumulator see
// exactly `step` seconds — a task's `delta` is always scene time, and `delta === 0` on
// a held frame is legal (pause-correct).
//
// TSL `time` is the one thing the scheduler can't reach — it resolves to
// `nodeFrame.time`, which three advances itself off `performance.now()` — so this
// module writes `renderer._nodes.nodeFrame.time` directly, once per frame.
//
// In realtime (every production frame — only capture installs a source) this is a
// pass-through: it reads `nodeFrame.time` rather than writing it.

import type { Scheduler } from '@threlte/core/webgpu';
import { logEngine } from '$extensions/logger';

/**
 * Read-only mirror of the current frame's clock. Tasks do not need this — their `delta`
 * argument is already scene time (see the header). It is here for code that runs outside a
 * task, and for anything that has to know whether the clock is its own.
 */
export const engineClock = {
	/** Scene seconds since boot. This is the value TSL `time` sees. */
	elapsed: 0,
	/** Scene seconds this frame represents. 0 on a held frame. */
	delta: 0,
	/** True while a fixed-step source owns the clock (i.e. an offline take is in flight). */
	fixed: false
};

/**
 * A fixed-step source owns the clock while it is installed. Called exactly once per frame,
 * before any stage runs, and its return value decides the frame:
 *
 * - `null`  — HOLD. The clock does not advance and the frame is not rendered at all. For
 *             capture that is the encode queue being full; the frame would be discarded, so
 *             it is never drawn. Something else must eventually wake the loop (capture's
 *             `onEncoderReady` invalidates).
 * - `0`     — the frame counts, but scene time does not move. This is the head frame of a
 *             take: the pose driver already placed the camera, so advancing before the first
 *             encode would drop frame 0.
 * - `step`  — advance scene time by `step` seconds and render.
 *
 * Returning a step above `Scheduler.clampDeltaTo` (0.1 s) is clamped downstream like
 * any other delta, so a source must stay under it.
 */
export type FixedStepSource = () => number | null;

let source: FixedStepSource | null = null;

/**
 * Hand the clock to a fixed-step source, or `null` to give it back to the wall clock.
 * Exactly one source at a time; installing a second replaces the first.
 *
 * Scene time is CONTINUOUS across both handovers — it carries on from wherever the
 * other clock left it. Not cosmetic: TSL layer motion is a function of absolute
 * elapsed time, so a jump teleports the cloud deck and re-phases every star on
 * frame 0 of a take (utils/CLAUDE.md).
 */
export const setFixedStepSource = (next: FixedStepSource | null): void => {
	source = next;
};

/** The private node-system clock behind TSL `time`. Null until `renderer.init()` resolves. */
type NodeFrame = { time: number; deltaTime: number };
const nodeFrameOf = (renderer: unknown): NodeFrame | null =>
	(renderer as { _nodes?: { nodeFrame?: NodeFrame } } | null)?._nodes?.nodeFrame ?? null;

/**
 * Take TSL `time` over for this frame. Applied to held frames too: three's animation
 * loop has already added a wall-clock delta to `nodeFrame` by the time this runs, so
 * an uncorrected hold would leave the shader clock ahead of scene time.
 */
let warnedUnreachable = false;

const pin = (nodeFrame: NodeFrame | null, delta: number): void => {
	if (!nodeFrame) {
		// Only reachable with a source installed, so this is the private field having
		// moved, not the renderer still initialising. Symptom if silent: a take whose
		// sky and rain are subtly slow.
		if (!warnedUnreachable) {
			warnedUnreachable = true;
			logEngine.warn(
				'EngineClock: renderer._nodes.nodeFrame is unreachable — TSL `time` will keep ' +
					'running on the wall clock through a fixed-step take (see core/utils/engineClock.ts)'
			);
		}
		return;
	}
	nodeFrame.time = engineClock.elapsed;
	nodeFrame.deltaTime = delta;
};

/**
 * The scheduler's frame timing. `lastTime` and `clampDeltaTo` are ordinary instance
 * fields (`frame-scheduling/Scheduler.js`) that Threlte's `.d.ts` declares `private`,
 * so reaching them needs this structural view rather than a `Scheduler`.
 *
 * `lastTime` is the whole mechanism — the scheduler derives each frame's delta from
 * it, so the fabricated timestamps below are all that has to be written.
 * `clampDeltaTo` is read, never written.
 */
type SchedulerClock = {
	run: (time: number) => void;
	lastTime: number;
	clampDeltaTo: number;
};

/**
 * Installs the clock by wrapping `scheduler.run`. Called once, by `EngineClock.svelte`;
 * returns the uninstaller.
 */
export const installEngineClock = (
	scheduler: Scheduler,
	renderer: unknown,
	invalidate: () => void
): (() => void) => {
	const clock = scheduler as unknown as SchedulerClock;
	// Bound to the instance in Threlte's Scheduler constructor, so this is a plain own
	// property and both the wrap and the restore are ordinary assignments.
	const originalRun = clock.run;

	/** The fabricated timestamp handed to the scheduler while a source owns the clock. */
	let handedOver = 0;
	let wasFixed = false;

	clock.run = (time: number) => {
		const nodeFrame = nodeFrameOf(renderer);
		// `undefined` = no source, i.e. the wall clock. NOT `source?.() ?? undefined`, which
		// would fold a source's `null` (a deliberate hold) into the pass-through branch.
		const step = source ? source() : undefined;

		if (step === undefined) {
			// --- wall clock (pass-through) ---
			if (wasFixed) {
				// Resync: the fabricated timeline lagged real time for the whole take, so
				// `time - lastTime` would be a huge jump — land it as a zero-delta frame.
				clock.lastTime = time;
				wasFixed = false;
				engineClock.fixed = false;
			}
			// The same arithmetic the scheduler is about to do, mirrored for readers.
			engineClock.delta = Math.min((time - clock.lastTime) / 1000, clock.clampDeltaTo);
			// three owns `nodeFrame.time` here — mirror it rather than write it, so scene time
			// is already exactly what the shaders see when a source takes over.
			engineClock.elapsed = nodeFrame ? nodeFrame.time : engineClock.elapsed + engineClock.delta;
			originalRun(time);
			return;
		}

		// --- fixed step ---
		if (!wasFixed) {
			handedOver = clock.lastTime;
			wasFixed = true;
			engineClock.fixed = true;
		}

		if (step === null) {
			// Held. Stages still run — with a zero delta, so they are inert — keeping
			// loop-rate telemetry and UI tasks alive. No render happens: nothing
			// invalidates, so the render stage's callback (gated on `shouldRender()`)
			// skips — a frame the take will discard costs nothing.
			engineClock.delta = 0;
			pin(nodeFrame, 0);
			originalRun(handedOver);
			return;
		}

		engineClock.delta = step;
		engineClock.elapsed += step;
		handedOver += step * 1000;
		pin(nodeFrame, step);

		// Every non-held frame of a take must render BEFORE the stages run, or physics
		// ends up a step ahead of a frame never drawn. `shouldRender()` is evaluated
		// inside the render stage's callback, after this, so invalidating here lands
		// on this frame.
		invalidate();
		originalRun(handedOver);
	};

	return () => {
		clock.run = originalRun;
		source = null;
		engineClock.fixed = false;
	};
};
