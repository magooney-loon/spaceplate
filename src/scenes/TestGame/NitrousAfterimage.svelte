<script lang="ts">
	// THE NITROUS SMEAR DRIVER — TestGame's writer for the afterimage effect's
	// runtime boost (`uAfterimageBoost`, core/postprocessing/effects/afterimage.ts).
	// The lensState contract: ONE writer per uniform, any number of readers. This
	// renders nothing and owns no state anyone else can see; all it does is turn
	// `carSim.nitrous` (the already-ramped flow TestGame's physics task writes)
	// into an eased boost value.
	//
	// WHY A COMPONENT AND NOT A PHYSICS-TASK LINE IN TestGame.svelte: the write is
	// per RENDER frame, not per physics step (200 Hz uniform writes are pointless),
	// and this keeps the scene's driving task free of post-processing wiring — the
	// same separation LensDriver.svelte has from the weather model.
	//
	// SMOOTHING ON TOP OF THE FLOW: the flow itself ramps 8/s in, 4/s out
	// (TestGame.svelte), but a smear should BLOOM and then LINGER a little past the
	// spray — trails that cut dead with the bottle read as a glitch, not a lens.
	// Asymmetric one-pole, the same shape LensDriver uses for wetting/drying.
	//
	// INVALIDATION: `autoInvalidate: false` is load-bearing (the default pins the
	// on-demand render loop at full rate — see ChaseCamera's FOV task note). The
	// uniform is sampled by the compiled graph on every rendered frame, and while
	// the car sprays it is moving, so the chase camera already invalidates; this
	// task only invalidates itself for the tail of the release, when the car may
	// have just stopped and nobody else is asking for frames. Settled at zero is
	// free.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { sceneState } from '$extensions/scene';
	import { uAfterimageBoost } from '$core/postprocessing/effects/afterimage';
	import { carSim } from './carTelemetry.svelte';
	import { clamp } from './carMath';

	/** Boost at full flow. 0.85 keeps the deepest trail ≈ the addon example's look
	 * (with the panel floor at 0 and the sum ceiling at 0.96). */
	const MAX_BOOST = 0.85;
	/** Seconds for the smear to bloom in on activation. */
	const ATTACK_TAU = 0.12;
	/** Seconds for it to evaporate after the spray ends — slower on purpose. */
	const RELEASE_TAU = 0.45;
	/** Below this the level is settled; snap and stop invalidating. */
	const SETTLED = 0.001;

	const { invalidate } = useThrelte();

	let level = 0;

	useTask(
		(delta) => {
			const target =
				sceneState.currentScene === 'testGame' ? clamp(carSim.nitrous, 0, 1) * MAX_BOOST : 0;
			if (Math.abs(target - level) < SETTLED) {
				if (uAfterimageBoost.value !== target) {
					uAfterimageBoost.value = target;
					invalidate();
				}
				return;
			}
			const tau = target > level ? ATTACK_TAU : RELEASE_TAU;
			level += (target - level) * (1 - Math.exp(-delta / tau));
			uAfterimageBoost.value = level;
			invalidate();
		},
		{ autoInvalidate: false }
	);

	// Keep-alive scenes never unmount, and the render loop may not schedule the
	// task again after a scene switch — a spray interrupted by the Back button
	// must not leave its boost smeared over the menu. Hard-set on exit, the same
	// pattern TestGame.svelte's own exit effect uses.
	$effect(() => {
		if (sceneState.currentScene !== 'testGame') return;
		return () => {
			level = 0;
			uAfterimageBoost.value = 0;
		};
	});
</script>
