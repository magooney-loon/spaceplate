<script lang="ts">
	// THE SPEED-LINES DRIVER — TestGame's writer for the speed-lines effect's runtime
	// boost (`uSpeedLinesBoost`, core/postprocessing/effects/speedLines.ts). Same
	// lensState contract as CarAfterimage.svelte: ONE writer per uniform, any number
	// of readers. Renders nothing.
	//
	// Driven off `carSim.accelFwd` — THE MODEL'S OWN forward acceleration (N/mass,
	// not a finite difference of the body's pose, same number the suspension reads
	// for squat/dive) — so a genuine floored launch or a hard pull in a low gear
	// reads as a genuine kick, and coasting/braking/engine-braking (accelFwd <= 0)
	// show nothing, with no separate "is the player accelerating" flag to keep in
	// sync with the drivetrain.
	//
	// SMOOTHING: fast attack (the tunnel should snap in with the stab on the
	// throttle) and a slower release (a shift's torque cut/step rings accelFwd for
	// a beat — a hard cutoff there would flicker the tunnel every gearchange).
	//
	// INVALIDATION: `autoInvalidate: false`, same reasoning as CarAfterimage — the
	// car is moving whenever this is non-zero, so the chase camera already
	// invalidates; this task only covers the tail of the release.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { uSpeedLinesBoost } from '$core/postprocessing/effects/speedLines';
	import { carSim } from '../sim/carTelemetry.svelte';
	import { G } from '../units';
	import { clamp } from '../sim/carMath';

	/** g's of forward accel before the tunnel starts waking up — a gentle roll-on
	 * stays below this and shows nothing. */
	const ACCEL_START = 0.15 * G;
	/** g's where the boost reaches its ceiling — a sustained low-gear pull clears
	 * this; only a genuine floored launch (~1 g at the top) holds it there. */
	const ACCEL_FULL = 0.6 * G;

	/** Seconds for the tunnel to snap in on a throttle stab. */
	const ATTACK_TAU = 0.1;
	/** Seconds for it to ease back off — slower, so a shift's torque blip can't flicker it. */
	const RELEASE_TAU = 0.5;
	/** Below this the level is settled; snap and stop invalidating. */
	const SETTLED = 0.001;

	const { invalidate } = useThrelte();

	let level = 0;

	useTask(
		(delta) => {
			const accel = Math.max(carSim.accelFwd, 0);
			const target = clamp((accel - ACCEL_START) / (ACCEL_FULL - ACCEL_START), 0, 1);
			if (Math.abs(target - level) < SETTLED) {
				if (uSpeedLinesBoost.value !== target) {
					uSpeedLinesBoost.value = target;
					invalidate();
				}
				return;
			}
			const tau = target > level ? ATTACK_TAU : RELEASE_TAU;
			level += (target - level) * (1 - Math.exp(-delta / tau));
			uSpeedLinesBoost.value = level;
			invalidate();
		},
		{ autoInvalidate: false }
	);

	// Interrupted by leaving the scene — hard-set on teardown, the same pattern
	// TestGame.svelte's own exit effect and CarAfterimage.svelte use.
	$effect(() => () => {
		level = 0;
		uSpeedLinesBoost.value = 0;
	});
</script>
