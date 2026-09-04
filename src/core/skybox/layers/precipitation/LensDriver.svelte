<script lang="ts">
	// THE CPU HALF OF BOTH LENSES. Renders nothing: it measures the camera, reads the
	// weather, and writes `lensState`'s uniforms, which the two chain effects
	// (`core/postprocessing/effects/rainLens.ts`, `snowLens.ts`) sample. See
	// `lensState.svelte.ts` for why the split exists at all.
	//
	// ONE DRIVER, TWO LENSES, because they were measuring the SAME THING TWICE. Both old
	// components ran an identical camera-speed task — forward/lateral decomposition,
	// teleport rejection, the lot — and the copies had already started to drift apart in
	// their comments. Rain and snow are complementary halves of one `precipitationType`
	// channel and can only overlap during sleet, so a shared measurement is also the
	// honest model of them.
	//
	// IT MOUNTS INSIDE THE SKY GROUP, where the lens meshes used to. That is deliberate:
	// the layers only mount in procedural sky mode, so an HDR or cube environment leaves
	// this unmounted, the uniforms sit at zero and both effects build as pass-throughs —
	// exactly the behaviour the meshes had. (Weather AUDIO lives outside the layers for
	// the opposite reason: a looping bed must not stop when the env mode changes. A lens
	// is visual, so it follows the visuals.)
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { Vector3 } from 'three/webgpu';
	import { clamp01, descriptor, rainAmount, snowAmount } from '../../model';
	import {
		lensActivity,
		uDropTime,
		uGrowth,
		uIce,
		uPatternOffset,
		uWetness
	} from './lensState.svelte';

	interface Props {
		/** Forward speed, world units per second, at which the lens reaches full wetness. */
		rainSpeedForFull?: number;
		/** Seconds for the lens to bead up, and to dry off. Asymmetric on purpose. */
		wetSeconds?: number;
		drySeconds?: number;
		/** Ceiling on wetness, so a downpour never turns the screen to soup. */
		maxWetness?: number;
		/**
		 * How much frost snow puts on the glass with the camera standing still.
		 *
		 * THIS IS THE DOMINANT TERM, not a floor under a motion-driven effect: rain has to
		 * be driven into to land on a windscreen, so the rain lens has no standing term at
		 * all, but frost is a TEMPERATURE — a lens sitting in snow ices over whether or not
		 * it is going anywhere. Motion only deepens it.
		 */
		standingFrost?: number;
		/**
		 * Speed at which motion contributes its full extra measure on top of
		 * `standingFrost`. Only `1 - standingFrost` of range is left above that term, so
		 * this is a shallower ramp than the rain lens's, not a steeper one.
		 */
		snowSpeedForFull?: number;
		/** Seconds for the frost to form, and to melt back. Slow in BOTH directions. */
		freezeSeconds?: number;
		meltSeconds?: number;
		/** Ceiling on growth, so even a whiteout leaves the middle of the frame readable. */
		maxFrost?: number;
		/**
		 * How much sideways motion counts toward wetting/freezing, as a fraction of forward
		 * motion.
		 *
		 * Physically this should be near zero — rain lands on a windscreen because you
		 * drive INTO it. It is not zero because DemoScene's camera orbits the origin, so
		 * its forward speed is identically zero. Drop it to 0 for a first-person
		 * controller.
		 */
		lateralInfluence?: number;
	}

	let {
		rainSpeedForFull = 7,
		wetSeconds = 0.7,
		drySeconds = 2.6,
		maxWetness = 0.85,
		standingFrost = 0.5,
		snowSpeedForFull = 6,
		freezeSeconds = 1.8,
		meltSeconds = 6,
		maxFrost = 0.75,
		lateralInfluence = 0.35
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	// Plain variables, written and read only by the task.
	let wetness = 0;
	let dropTime = 0;
	let growth = 0;
	let lastPosition: Vector3 | null = null;
	const stepVector = new Vector3();
	const forward = new Vector3();

	/** Base rate of the droplet clock, and how much the camera's speed adds to it. */
	const DROP_RATE = 0.18;
	const DROP_RATE_PER_SPEED = 0.025;

	/**
	 * A camera moving faster than this is being cut, not flown.
	 *
	 * A SPEED, not a per-frame distance: the old per-frame form (8 units) meant 1150 u/s
	 * at 144Hz but only 240 u/s in a 30fps offline capture take, so a flythrough that wet
	 * the glass in the viewport read as a cut in the recording of it and the lens never
	 * built any wetness at all. 480 u/s is the old figure at 60fps.
	 */
	const TELEPORT_SPEED = 480;

	/**
	 * Hysteresis on the activity latches. `ON` is the old `visible` threshold; `OFF` sits
	 * below it so a value hovering at the boundary cannot flip the latch — and each flip
	 * REBUILDS THE PIPELINE GRAPH (see `lensActivity`), which is a recompile, not a
	 * uniform write. The gap is wide enough that the one-pole smoothing crosses it in a
	 * direction and stays there.
	 */
	const ACTIVE_ON = 0.002;
	const ACTIVE_OFF = 0.0008;

	const latch = (value: number, active: boolean): boolean =>
		active ? value > ACTIVE_OFF : value > ACTIVE_ON;

	useTask(
		(delta) => {
			const cam = camera.current;
			const position = cam.position;

			// How fast, and how much of that is INTO the view. `getWorldDirection` is the
			// camera's own -Z in world space, so this is signed: reversing out of the rain
			// wets nothing, which is why it is floored at zero.
			let forwardSpeed = 0;
			let lateralSpeed = 0;

			if (lastPosition === null) {
				lastPosition = position.clone();
			} else {
				stepVector.subVectors(position, lastPosition);
				lastPosition.copy(position);
				if (delta > 0 && stepVector.length() / delta <= TELEPORT_SPEED) {
					stepVector.divideScalar(delta);
					cam.getWorldDirection(forward);
					forwardSpeed = Math.max(0, stepVector.dot(forward));
					// Pythagoras against the total, so this is the component perpendicular
					// to the view rather than a second projection.
					const total = stepVector.length();
					lateralSpeed = Math.sqrt(Math.max(0, total * total - forwardSpeed * forwardSpeed));
				}
			}

			const speed = forwardSpeed + lateralSpeed * lateralInfluence;

			// ── Rain ─────────────────────────────────────────────────────────────────
			// The shared split off the explicit `precipitationType` channel. Snow leaves no
			// droplets on glass, so wetness is deliberately rain-only — and during sleet it
			// wets in proportion to the rain half alone.
			const rain = rainAmount(descriptor.weather);
			const wetTarget = clamp01(speed / rainSpeedForFull) * rain * maxWetness;

			// Asymmetric one-pole smoothing: beads up quickly, dries slowly. Both branches
			// use the `exp` form so the time constants hold at any framerate.
			const wetTau = wetTarget > wetness ? wetSeconds : drySeconds;
			wetness += (wetTarget - wetness) * (1 - Math.exp(-delta / wetTau));
			uWetness.value = wetness;

			// The clock runs faster the faster you move — drops streak past rather than
			// drifting — and is accumulated, never `time * rate`. See the uniform's note.
			dropTime += delta * (DROP_RATE + speed * DROP_RATE_PER_SPEED);
			uDropTime.value = dropTime;

			// ── Snow ─────────────────────────────────────────────────────────────────
			const snow = snowAmount(descriptor.weather);

			// A PRESENCE CURVE, not the raw amount — the same shape Rain and Snow use.
			// Whether it is snowing is a threshold question, not a proportion: past a light
			// flurry the glass is cold and the rest is a matter of degree, which the terms
			// below express. (Feeding the raw `snowAmount` in instead starves the effect —
			// the authored `snow` weather sits at precipitation 0.7, and the product at rest
			// came to 0.18, which put the growth front beyond all but the extreme corners.)
			const presence = Math.min(1, snow * 4);
			const frostTarget = clamp01(standingFrost + speed / snowSpeedForFull) * presence * maxFrost;

			const frostTau = frostTarget > growth ? freezeSeconds : meltSeconds;
			growth += (frostTarget - growth) * (1 - Math.exp(-delta / frostTau));
			uGrowth.value = growth;

			// What the ice is scattering. Floored so a night blizzard still shows frost
			// rather than a black border, and biased cool at every level.
			const { ambient, intensity } = descriptor.light;
			const lit = Math.min(1.05, Math.max(0.12, 0.15 + ambient * 0.5 + intensity * 0.09));
			uIce.value.set(lit * 0.78, lit * 0.87, lit * 0.98);

			// ── Latches ──────────────────────────────────────────────────────────────
			const rainActive = latch(wetness, lensActivity.rain);
			const snowActive = latch(growth, lensActivity.snow);

			// A NEW ARRANGEMENT EACH TIME THE FROST RETURNS, on the RISING edge specifically.
			// Re-rolling is a discontinuity — every lobe and every dendrite moves at once —
			// so it has to land on a frame where none of them are drawn. This is that frame:
			// growth has only just crossed ACTIVE_ON, which puts the front beyond the
			// corners, so coverage is still zero everywhere and the jump is unobservable.
			// It also coincides with the graph rebuild the latch triggers, so the new offset
			// is compiled in rather than swapped under a live frame.
			if (snowActive && !lensActivity.snow) {
				uPatternOffset.value.set(Math.random() * 512, Math.random() * 512);
			}

			lensActivity.rain = rainActive;
			lensActivity.snow = snowActive;

			// Same contract the mesh layers had: TSL-animated, so it owns its own
			// invalidation, gated on actually being live (../../CLAUDE.md).
			if (rainActive || snowActive) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	// Unmounting (an environment-mode switch) must take the lenses down with it, or the
	// effects keep building a lens the driver is no longer feeding — frozen at whatever
	// wetness the last frame of procedural sky happened to have.
	$effect(() => {
		return () => {
			uWetness.value = 0;
			uGrowth.value = 0;
			lensActivity.rain = false;
			lensActivity.snow = false;
		};
	});
</script>
