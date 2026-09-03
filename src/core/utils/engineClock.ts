// THE ENGINE CLOCK — one source of scene time for the whole app.
//
// Every animated thing in this app integrates a `delta`: the sky model
// (`skyActions.tick(delta * 1000)`), every TSL layer's accumulators, Rapier's substep
// accumulator, the flypath camera, the demo's cube-capture rate limiter. Those deltas all
// came from the same place — Threlte's scheduler, off the wall clock — and that is fine
// until something has to render SLOWER THAN REALTIME on purpose.
//
// That something is an offline capture take (`extensions/capture/`). It timestamps frame N
// at exactly N/fps however long the frame took to draw, so at 8fps of real throughput a
// 30fps take needs every clock in the app to advance 1/30 s per frame, not the ~125 ms that
// actually elapsed. Otherwise the camera (which does advance on the frame counter) and
// everything else run on different clocks, and the output has slow-motion clouds and rain
// under a correctly-paced camera.
//
// WHERE THE OVERRIDE HAPPENS IS THE WHOLE DESIGN. The obvious implementation — have each
// task read a shared clock instead of its own `delta` argument — means touching ~20 files
// and, worse, leaves every task written from now on silently drifting until someone
// remembers the rule. So the substitution happens ONE LEVEL UP, at `Scheduler.run`, which
// is the single place a frame's delta is computed before being fanned out to every stage
// and task in the app:
//
//   Threlte's Scheduler derives its delta as `time - lastTime` from the value it is handed
//   (`frame-scheduling/Scheduler.js`), so handing it a FABRICATED timestamp — `lastTime +
//   step * 1000` — makes every stage, every task and Rapier's accumulator see exactly
//   `step` seconds, through Threlte's own unmodified machinery. Nothing downstream knows,
//   and nothing downstream can forget.
//
// Two consequences worth stating, because they are the reason this is not a capture-only
// hack:
//
//   1. A task's `delta` argument IS scene time, always. New game code needs no rule and no
//      import to be capture-correct.
//   2. `engineClock.delta` is 0 on a held frame, so integrating it is also the correct way
//      to be pause-correct. Holding a frame used to be mildly destructive (the sky went on
//      animating through a frame the take would throw away); now it is inert.
//
// TSL `time` IS THE ONE THING THE SCHEDULER DOES NOT REACH. It resolves to
// `nodeFrame.time`, which three advances itself, per rAF, off `performance.now()`, inside
// the animation loop that calls the scheduler (`renderers/common/Animation.js`). Nothing
// public feeds it, so this module writes `renderer._nodes.nodeFrame.time` directly, once
// per frame, before the render. It is a private field; the alternative is every layer
// importing a hand-rolled `time` uniform instead of three's, which is the same
// forget-and-drift trap as above, in shader code. Guarded and non-fatal if it moves.
//
// In realtime — which is every frame of a production build, since nothing but capture ever
// installs a source — this module is a pass-through: it reads `nodeFrame.time` rather than
// writing it, hands the scheduler the timestamp it was given, and the app behaves exactly
// as it did before.

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
 * Returning a step above `Scheduler.clampDeltaTo` (0.1 s) is clamped downstream by Threlte
 * like any other delta, so a source must stay under it — capture's FPS slider floors at 12
 * (1/12 s), which does.
 */
export type FixedStepSource = () => number | null;

let source: FixedStepSource | null = null;

/**
 * Hand the clock to a fixed-step source, or `null` to give it back to the wall clock.
 * Exactly one source at a time; installing a second replaces the first.
 *
 * Scene time is CONTINUOUS across both handovers — it carries on from wherever the wall
 * clock left it and three's `nodeFrame.time` resumes from wherever the take left it. That
 * is not cosmetic: every TSL layer's motion is a function of absolute elapsed time, so a
 * jump either way teleports the cloud deck, re-phases every star and relocates the rain
 * (the self-accumulated offset rule) — on frame 0 of a take, which is the one frame
 * that must not do that.
 */
export const setFixedStepSource = (next: FixedStepSource | null): void => {
	source = next;
};

/** The private node-system clock behind TSL `time`. Null until `renderer.init()` resolves. */
type NodeFrame = { time: number; deltaTime: number };
const nodeFrameOf = (renderer: unknown): NodeFrame | null =>
	(renderer as { _nodes?: { nodeFrame?: NodeFrame } } | null)?._nodes?.nodeFrame ?? null;

/**
 * Take TSL `time` over for this frame. Applied to held frames too, even though a held frame
 * never renders: three's animation loop has already added a wall-clock delta to `nodeFrame`
 * by the time this runs (it calls `nodeFrame.update()` before the scheduler), so leaving a
 * hold uncorrected would leave the shader clock ahead of scene time — a discrepancy nothing
 * observes today only because nothing renders on a held frame.
 */
let warnedUnreachable = false;

const pin = (nodeFrame: NodeFrame | null, delta: number): void => {
	if (!nodeFrame) {
		// Only reachable with a source installed, so this is the private field having moved
		// rather than the renderer still initialising. Said out loud once: the symptom
		// otherwise is a take whose sky and rain are subtly slow, with nothing to point at.
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
 * The scheduler's frame timing. `lastTime` and `clampDeltaTo` are ordinary instance fields
 * (`frame-scheduling/Scheduler.js`) that Threlte's `.d.ts` declares `private`, so reaching
 * them needs a structural view of the instance rather than a `Scheduler`.
 *
 * `lastTime` is the whole mechanism: the scheduler derives each frame's delta from it, so
 * the fabricated timestamps below are the only thing that has to be written for a fixed step
 * to reach every stage. `clampDeltaTo` is read, never written — a step is clamped exactly
 * like a real delta.
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
				// `time - lastTime` would now be a jump of however long the take ran over.
				// Landing it as a zero-delta frame costs one frozen frame and nothing else.
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
			// Held. Stages still run — with a zero delta, so they are inert — which keeps the
			// loop-rate telemetry and any UI-side task alive. What does NOT happen is a
			// render: nothing invalidates, so the render stage's callback skips the whole
			// stage (Threlte's scheduler fragment gates it on `shouldRender()`), and a frame
			// the take is going to discard costs nothing to discard.
			engineClock.delta = 0;
			pin(nodeFrame, 0);
			originalRun(handedOver);
			return;
		}

		engineClock.delta = step;
		engineClock.elapsed += step;
		handedOver += step * 1000;
		pin(nodeFrame, step);

		// Every non-held frame of a take must render, and must render BEFORE the stages run,
		// or the render stage skips while the ungated stages (Rapier's, and this clock) have
		// already advanced — physics one step ahead of the frame that was never drawn. The
		// scheduler evaluates `shouldRender()` inside the render stage's callback, which runs
		// after this, so invalidating here lands on this frame.
		invalidate();
		originalRun(handedOver);
	};

	return () => {
		clock.run = originalRun;
		source = null;
		engineClock.fixed = false;
	};
};
