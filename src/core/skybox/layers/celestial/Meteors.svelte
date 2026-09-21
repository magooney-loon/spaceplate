<script lang="ts">
	// Occasional meteors. A descriptor consumer, faded by `descriptor.sky.starVisibility`.
	// Scheduling is pure GPU: head position, travel progress and brightness are pure
	// functions of `time` and per-meteor constant attributes (life = fract(t/period +
	// phase) * period, active while life < duration) -- no CPU clock, no event queue.
	// Each quad stretches from head to tail in the vertex stage, pinned to the far plane
	// like Stars.svelte. Per-meteor scalars are packed into two vec4s to stay under
	// WebGPU's 8-vertex-buffer cap (skyLayer.ts) -- unpacked this hits 9 and pipeline
	// creation fails.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		float,
		fract,
		mix,
		positionLocal,
		pow,
		sin,
		smoothstep,
		step,
		time,
		uniform,
		vec3
	} from 'three/tsl';
	import { descriptor, mulberry32 } from '../../model';
	import {
		instancedQuad,
		instancedVec3,
		instancedVec4,
		pinFarPlane,
		skyLayerMaterial,
		streakClip,
		SKY_LAYER_USERDATA
	} from '../skyLayer';

	interface Props {
		/**
		 * Meteor "slots". Each fires once per its own period, so the expected number on
		 * screen at any instant is `count * E[duration] / E[period]` -- with the periods
		 * and durations rolled below, `count * 0.013`. 24 slots is about one meteor
		 * visible a third of the time. Raise it for a shower.
		 */
		count?: number;
		/** Distance the streaks are placed at. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/** Changing this reshuffles the schedule. */
		seed?: number;
	}

	let { count = 24, radius = 1000, seed = 20260828 }: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<THREE.Mesh>();

	const visibility = uniform(0);

	const DEG = Math.PI / 180;

	/**
	 * Builds the field and its material together, once. One closure because every input
	 * is a BUILD-TIME prop -- see the same note in Stars.svelte.
	 */
	const build = () => {
		// Xor the seed so meteors and stars never share a random sequence.
		const rng = mulberry32(seed ^ 0x9e3779b9);

		// Per-meteor constants. 'aStart' is the start point as a UNIT direction; the
		// shader walks it along aVel and scales to `radius` only for the view-space
		// transform. The scalars are packed two-vec4s-wide (see the header note on
		// maxVertexBuffers): aParams0 = period, phase, duration, trail fraction;
		// aParams1 = streak half-width, peak brightness, spare, spare.
		const starts = new Float32Array(count * 3);
		const vels = new Float32Array(count * 3);
		const params0 = new Float32Array(count * 4);
		const params1 = new Float32Array(count * 4);

		for (let i = 0; i < count; i++) {
			// Start point: uniform on the sphere, kept above the horizon band so the
			// whole streak doesn't live and die behind the ground plane.
			let sx = 0;
			let sy = 0;
			let sz = 0;
			for (let tries = 0; tries < 64; tries++) {
				const cosTheta = rng() * 2 - 1;
				const phi = rng() * Math.PI * 2;
				const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
				sx = sinTheta * Math.cos(phi);
				sy = cosTheta;
				sz = sinTheta * Math.sin(phi);
				if (sy > 0.15) break;
			}

			// Velocity: a random tangent at the start point, scaled so that aVel *
			// progress covers the full travel in radians.
			const rx = rng() * 2 - 1;
			const ry = rng() * 2 - 1;
			const rz = rng() * 2 - 1;
			let tx = sy * rz - sz * ry;
			let ty = sz * rx - sx * rz;
			let tz = sx * ry - sy * rx;
			const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
			const travel = 0.35 + rng() * 0.5; // 20-49 deg of sky
			tx = (tx / tl) * travel;
			ty = (ty / tl) * travel;
			tz = (tz / tl) * travel;

			starts[i * 3] = sx;
			starts[i * 3 + 1] = sy;
			starts[i * 3 + 2] = sz;
			vels[i * 3] = tx;
			vels[i * 3 + 1] = ty;
			vels[i * 3 + 2] = tz;

			// Trail length as a fraction of travel (3-13 deg at these travels).
			params0[i * 4] = 40 + rng() * 80; // period: seconds between appearances
			params0[i * 4 + 1] = rng(); // phase
			params0[i * 4 + 2] = 0.6 + rng() * 0.9; // duration: seconds visible
			params0[i * 4 + 3] = (0.06 + rng() * 0.14) / travel; // trail
			// Apparent half-width of the streak. Thin: a meteor is a line with a glow,
			// not a ribbon.
			params1[i * 4] = radius * Math.tan((0.06 + rng() * 0.1) * DEG);
			// Mostly shy, occasionally spectacular.
			params1[i * 4 + 1] = 0.5 + Math.pow(rng(), 2) * 1.5;
		}

		const material = skyLayerMaterial({
			blending: THREE.AdditiveBlending,
			// The perpendicular can flip with geometry winding; a meteor has no back.
			side: THREE.DoubleSide
		});

		const aStart = instancedVec3(starts);
		const aVel = instancedVec3(vels);
		const aParams0 = instancedVec4(params0);
		const aParams1 = instancedVec4(params1);
		const aPeriod = aParams0.x;
		const aPhase = aParams0.y;
		const aDur = aParams0.z;
		const aTrail = aParams0.w;
		const aWidth = aParams1.x;
		const aBright = aParams1.y;

		// The quad corner: with the meteor's start point instanced, the base geometry's
		// `position` IS the corner. 0 = head end, 1 = tail end.
		const corner = positionLocal.xy;
		const along = corner.x.mul(0.5).add(0.5);
		const across = corner.y;

		// Seconds elapsed in this meteor's cycle. Once it passes aDur the quad keeps
		// "moving" far along its great circle, harmlessly -- active gates it off.
		const life = fract(time.div(aPeriod).add(aPhase)).mul(aPeriod);
		const progress = life.div(aDur);

		// Head and tail points on the unit sphere, then the vertex between them.
		const head = aStart.add(aVel.mul(progress)).normalize();
		const tail = aStart.add(aVel.mul(progress.sub(aTrail))).normalize();

		// Motion-aligned billboard, then far-plane depth pinning (skyLayer.ts).
		material.vertexNode = pinFarPlane(
			streakClip(head.mul(float(radius)), tail.mul(float(radius)), along, across, aWidth)
		);

		// Fragment: gate, envelope, and the streak's own falloffs. Attribute-derived
		// nodes used here are auto-lifted to varyings by TSL.
		const active = step(life, aDur);
		const envelope = sin(progress.mul(Math.PI));
		const tailFade = pow(along.oneMinus(), float(1.8));
		const across2 = across.mul(across);
		const shape = pow(smoothstep(float(0), float(1), across2).oneMinus(), float(2));

		// `head`/`tail` are normalised, so their `.y` IS the sine of altitude directly
		// (see `altitudeOf` in skyLayer.ts for the bug this form avoids); taking it along
		// the spine also fades a streak as it crosses the horizon rather than popping the
		// whole quad.
		const altitude = mix(head, tail, along).y;
		const horizon = smoothstep(float(-0.02), float(0.12), altitude);

		// Slightly cyan white -- the ionisation colour, and it separates meteors from
		// the warm star ramp at a glance.
		material.colorNode = vec3(0.78, 0.92, 1.0);
		material.opacityNode = active
			.mul(envelope)
			.mul(tailFade)
			.mul(shape)
			.mul(aBright)
			.mul(horizon)
			.mul(visibility);

		return { geometry: instancedQuad(count), material };
	};

	const { geometry, material } = build();

	useTask(
		() => {
			const visible = descriptor.sky.starVisibility;
			visibility.value = visible;
			if (mesh) mesh.visible = visible > 0.002;
			// Schedules run off the TSL `time` node, so this animates every frame -- but
			// only while the field is on screen at all. See Skybox.svelte on renderMode.
			if (visible > 0.002) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});
</script>

<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={1}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
