<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { useThrelte } from '@threlte/core/webgpu';
	import { World } from '@threlte/rapier';

	// `<World>`, with Rapier's SYNCHRONIZATION STAGE PINNED AHEAD OF THE MAIN STAGE.
	// That one edge is the whole component; everything else is passed straight through.
	//
	// ── What it fixes ───────────────────────────────────────────────────────────
	// Threlte sorts its stages topologically, and @threlte/rapier only constrains
	// synchronization to `after: simulation, before: renderStage`. Nothing relates it
	// to the MAIN stage, and the resulting sort (verified against the real DAG) is:
	//
	//     resize → simulation → mainStage → synchronization → renderStage
	//
	// Synchronization is what writes each RigidBody's INTERPOLATED pose onto its
	// Object3D (`lastPosition.lerp(currentPosition, offset)` in createPhysicsTasks).
	// Landing after the main stage means every main-stage task reads a body transform
	// that is a FULL FRAME STALE — last frame's pose, while the renderer is about to
	// draw this frame's.
	//
	// Threlte's own components put their tasks in the main stage by default, and the
	// TestGame chase camera is two of them: `useFollow` + `<CameraControls>`. So the
	// camera framed the car one frame behind where the car was actually drawn. The lag
	// compounds through `useFollow`'s `lookAhead`, which derives the target's VELOCITY
	// as `Δposition / delta` — with a stale pose the numerator spans the PREVIOUS frame
	// while the denominator is the CURRENT one, so uneven frame times produce a wrong
	// velocity that `lookAhead` multiplies into the look-at point.
	//
	// ── What it does NOT fix ────────────────────────────────────────────────────
	// This was found while chasing TestGame's car stutter at 4K. That stutter is FILL
	// RATE (DOCS/testperf.md §2.6 — it goes away with `renderScale`, and it survived
	// this change), so treat this as a correctness fix with no measured before/after.
	// The argument for it is the ordering itself, which is wrong on its own terms: one
	// public prop, no runtime cost, and main-stage consumers read the pose that is
	// about to be drawn instead of the previous one. §1.7's centimetre table is a
	// simulation over synthetic frame times, not a measurement of the app.
	//
	// ── Why the fix goes here and not in the consumers ──────────────────────────
	// The alternative is to move every physics-reading task into the render stage
	// (`{ before: autoRenderTask }`, which is what this project's own tasks already do
	// — see scenes/DemoScene/SpawnedBodies.svelte). That works for OUR tasks and is
	// still the rule for them, but it cannot reach into `useFollow` or
	// `<CameraControls>`, which hard-code the main stage and expose no ordering option.
	// Moving the STAGE fixes every main-stage consumer at once, third-party included,
	// through a public `<World>` prop rather than a patch.
	//
	// ── Why it is safe ──────────────────────────────────────────────────────────
	// Both of Rapier's real ordering guarantees are kept — the option is MERGED with
	// the built-in `before: renderStage` by createPhysicsStages, and `after: simulation`
	// is untouched — so the stage still runs after the physics steps and before
	// anything draws. `simulationOffset` is written by the simulation stage, which
	// stays first, so the interpolation reads the same value it always did. The only
	// behavioural change is that main-stage tasks now see this frame's pose instead of
	// last frame's, which is strictly fresher data. Nothing in this project writes a
	// body's transform from the main stage (that would previously have been clobbered
	// by synchronization and so could never have worked).

	let { children, ...rest }: ComponentProps<typeof World> = $props();

	const { mainStage } = useThrelte();
</script>

<World {...rest} synchronizationStageOptions={{ before: mainStage }}>
	{@render children?.()}
</World>
