<script lang="ts">
	// THE AFTERIMAGE SMEAR DRIVER — TestGame's writer for the afterimage effect's
	// runtime boost (`uAfterimageBoost`, core/postprocessing/effects/afterimage.ts).
	// The lensState contract: ONE writer per uniform, any number of readers. This
	// renders nothing and owns no state anyone else can see; all it does is turn
	// TWO independent sources into one eased boost value:
	//   - `carSim.nitrous` (the already-ramped spray flow) — the big, deliberate smear.
	//   - road speed above `SPEED_START_KMH` — a slightly lighter trail that builds in
	//     as the car gets properly fast, so the sense of speed doesn't only exist
	//     while spraying nitrous. The two ADD (a nitrous burst at speed is the biggest
	//     smear the car ever shows), each on its OWN easing so a gearshift's momentary
	//     lift off the accelerator can't flicker the speed half.
	//
	// WHY A COMPONENT AND NOT A PHYSICS-TASK LINE IN TestGame.svelte: the write is
	// per RENDER frame, not per physics step (a uniform written more than once per
	// drawn frame is written for nothing),
	// and this keeps the scene's driving task free of post-processing wiring — the
	// same separation LensDriver.svelte has from the weather model.
	//
	// SMOOTHING ON TOP OF THE FLOW: the nitrous flow itself ramps 8/s in, 4/s out
	// (TestGame.svelte), but a smear should BLOOM and then LINGER a little past the
	// spray — trails that cut dead with the bottle read as a glitch, not a lens.
	// Asymmetric one-pole, the same shape LensDriver uses for wetting/drying. The
	// speed half runs its OWN, much slower pole — it should read as the trail
	// gradually thickening as the car accelerates, not snapping in at a line.
	//
	// INVALIDATION: `autoInvalidate: false` is load-bearing (the default pins the
	// on-demand render loop at full rate — see ChaseCamera's FOV task note). The
	// uniform is sampled by the compiled graph on every rendered frame, and while
	// either source is active the car is moving, so the chase camera already
	// invalidates; this task only invalidates itself for the tail of the release,
	// when the car may have just stopped/slowed and nobody else is asking for
	// frames. Settled at zero is free.
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { uAfterimageBoost } from '$core/postprocessing/effects/afterimage';
	import { carSim } from '../sim/carTelemetry.svelte';
	import { clamp } from '../sim/carMath';

	/** Boost at full nitrous flow. 0.85 keeps the deepest trail ≈ the addon example's
	 * look (with the panel floor at 0 and the sum ceiling below). */
	const NITROUS_MAX_BOOST = 0.85;
	/** Seconds for the nitrous smear to bloom in on activation. */
	const NITROUS_ATTACK_TAU = 0.12;
	/** Seconds for it to evaporate after the spray ends — slower on purpose. */
	const NITROUS_RELEASE_TAU = 0.45;

	/** km/h where the speed trail starts waking up. */
	const SPEED_START_KMH = 70;
	/** km/h where it reaches its own ceiling — short of any car's governed top speed,
	 * so the trail is fully in by the time a straight actually feels fast. */
	const SPEED_FULL_KMH = 150;
	/** Boost at max speed — close to the nitrous ceiling rather than a token fraction
	 * of it: the node is BRIGHT-PASS feedback (only pixels above ~0.1 linear persist
	 * at all), and trail length scales like 1/(1-damp), so 0.3 here was too thin an
	 * exponential to read as anything on an ordinary daylit frame — it only ever
	 * showed on the very brightest highlights, and even those cleared in a couple of
	 * frames. 0.6 gives the same kind of persistence nitrous's own high end does. */
	const SPEED_MAX_BOOST = 0.6;
	/** Seconds to build in — still gradual (it should read as accumulating speed, not
	 * snapping in), but fast enough to actually be seen before the car changes speed
	 * again. */
	const SPEED_ATTACK_TAU = 0.5;
	/** Seconds to fade once the car drops back under the threshold. */
	const SPEED_RELEASE_TAU = 0.8;

	/** Combined ceiling — stays comfortably under afterimage.ts's own 0.96 clamp so
	 * the panel's standing floor still has headroom on top. */
	const BOOST_CEILING = 0.95;
	/** Below this a source is settled; stop easing it. */
	const SETTLED = 0.001;

	const { invalidate } = useThrelte();

	let nitrousLevel = 0;
	let speedLevel = 0;

	useTask(
		(delta) => {
			const nitrousTarget = clamp(carSim.nitrous, 0, 1) * NITROUS_MAX_BOOST;
			const kmh = Math.abs(carSim.speedMs) * 3.6;
			const speedT = clamp((kmh - SPEED_START_KMH) / (SPEED_FULL_KMH - SPEED_START_KMH), 0, 1);
			const speedTarget = speedT * SPEED_MAX_BOOST;

			const nitrousSettled = Math.abs(nitrousTarget - nitrousLevel) < SETTLED;
			const speedSettled = Math.abs(speedTarget - speedLevel) < SETTLED;

			if (nitrousSettled && speedSettled) {
				nitrousLevel = nitrousTarget;
				speedLevel = speedTarget;
				const boost = Math.min(nitrousLevel + speedLevel, BOOST_CEILING);
				if (uAfterimageBoost.value !== boost) {
					uAfterimageBoost.value = boost;
					invalidate();
				}
				return;
			}

			const nitrousTau = nitrousTarget > nitrousLevel ? NITROUS_ATTACK_TAU : NITROUS_RELEASE_TAU;
			nitrousLevel += (nitrousTarget - nitrousLevel) * (1 - Math.exp(-delta / nitrousTau));
			const speedTau = speedTarget > speedLevel ? SPEED_ATTACK_TAU : SPEED_RELEASE_TAU;
			speedLevel += (speedTarget - speedLevel) * (1 - Math.exp(-delta / speedTau));

			uAfterimageBoost.value = Math.min(nitrousLevel + speedLevel, BOOST_CEILING);
			invalidate();
		},
		{ autoInvalidate: false }
	);

	// A spray/speed trail interrupted by leaving the scene must not leave its boost
	// smeared over the next one — hard-set on teardown, the same pattern
	// TestGame.svelte's own exit effect uses.
	$effect(() => () => {
		nitrousLevel = 0;
		speedLevel = 0;
		uAfterimageBoost.value = 0;
	});
</script>
