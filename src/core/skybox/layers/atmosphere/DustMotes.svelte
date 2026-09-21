<script lang="ts">
	// Floating dust motes — a sparse field of tiny backlit specks drifting through the air
	// around the camera. Not precipitation (nothing falls with any purpose) and not a
	// dome layer (it sits a few metres from the lens, not at radius 1000): a small
	// third family, `atmosphere/`, for near-camera ambient decoration.
	//
	// The whole look is ONE dot product: each mote reads its own brightness off
	// `viewDir . keyDirection`, exactly SkyFog's `sunInscatter` term (../SkyFog.svelte) —
	// a mote between the camera and the key light forward-scatters toward the lens, so
	// the field is nearly invisible face-on and lights up the moment the camera looks
	// toward the sun or moon. That is the whole "dust in a sunbeam" effect; nothing here
	// needs to know about godrays or shadow volumes to get it.
	//
	// Motion is the same zero-CPU recipe as Rain/Snow (fract-wrap through a camera-
	// anchored box, self-accumulated fall + wind drift — never `time * rate`, see Snow's
	// header) but tuned for something that floats rather than falls: fall speed is
	// near-zero and a per-instance sine wobble on all three axes stands in for Brownian
	// drift. Honest depth (`billboardClip`, not `pinFarPlane`): a mote a metre from the
	// windscreen must be occluded by the car and the track like any other near object.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		cameraPosition,
		cos,
		float,
		fract,
		mix,
		modelViewMatrix,
		modelWorldMatrix,
		positionLocal,
		sin,
		smoothstep,
		sqrt,
		time,
		uniform,
		varying,
		vec3,
		vec4
	} from 'three/tsl';
	import { clamp01, descriptor, mulberry32, windAxisX, windAxisZ } from '../../model';
	import {
		AMBIENT_LAYER,
		billboardClip,
		instancedDisc,
		instancedVec3,
		instancedVec4,
		skyLayerMaterial,
		SKY_LAYER_USERDATA
	} from '../skyLayer';

	interface Props {
		count?: number;
		/** Local box around the camera — intimate on purpose, unlike Snow's: a mote only
		 * reads as anything a few metres from the lens. Keep inside the camera far plane. */
		width?: number;
		height?: number;
		depth?: number;
		/** Near-motionless settle, world units/second — dust, not snow. */
		minFall?: number;
		maxFall?: number;
		/** Median mote radius, world units; varied per mote. */
		sizeWorld?: number;
		/** Wobble amplitude ceiling, world units, shared by the sway and the vertical bob. */
		swayAmp?: number;
		/** Exponent on the backlight dot product — higher pinches the glow tighter around
		 * looking straight at the key light. */
		rimSharpness?: number;
		seed?: number;
	}

	let {
		count = 260,
		width = 16,
		height = 8,
		depth = 16,
		minFall = 0.015,
		maxFall = 0.05,
		sizeWorld = 0.02,
		swayAmp = 0.55,
		rimSharpness = 9,
		seed = 20260919
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	/** Weather gate (0..1) — dust doesn't read as floating in rain, snow or fog, and a
	 * stiff wind disperses it rather than swirling it prettily. Everything else about a
	 * mote's motion keeps running underneath; this only scales the result. */
	const opacity = uniform(1);
	/** Accumulated fall, seconds-equivalent — never raw `time * speed` (Snow's `uFallTime`
	 * note): the multiplier would teleport the whole field on a weather change otherwise
	 * this doesn't have, but the rule is the same rule regardless. */
	const uFallTime = uniform(0);
	/** Accumulated wind travel, world units — Snow's `uWindDrift`, much slower here. */
	const uWindDrift = uniform(new THREE.Vector2());
	/** The key light's direction, as `SkyFog`'s `keyDirectionNode` — points FROM the
	 * scene TOWARD the light, so `viewDir . this` peaks when the camera looks toward it. */
	const uKeyDir = uniform(new THREE.Vector3(0, 1, 0));
	/** The key colour at unit magnitude — mixed toward as a mote catches more backlight. */
	const uKeyColor = uniform(new THREE.Vector3(1, 1, 1));
	/** The key's attenuated intensity, scaled WAY down from `SUN_INTENSITY` (4.75): a mote
	 * is a glint, not a light source, and this only sets how bright the glint gets. */
	const uKeyRadiance = uniform(0);
	/** A faint always-on floor so a mote reads as pale dust even off-axis, from the
	 * descriptor's ambient fill — see `sky.svelte.ts`'s `*_AMBIENT` constants. */
	const uAmbientGlow = uniform(0.015);

	/** How much of the key's attenuated intensity reaches a fully backlit mote. Small on
	 * purpose — see `uKeyRadiance`'s note. */
	const RADIANCE_SCALE = 0.05;
	/** Wind's push on the drift accumulator, world units/second at full wind channel —
	 * a fifth of Snow's: dust wanders, it doesn't stream. */
	const WIND_RATE = 0.4;

	/** A mote a hand's width from the lens would be a blown-out disc across a chunk of
	 * the frame — tighter than Snow's, because these are meant to be looked past, not at. */
	const NEAR_FADE_START = 0.12;
	const NEAR_FADE_END = 0.55;

	/**
	 * Builds the field and its material together, once. One closure because every input
	 * is a BUILD-TIME prop — see the same note in Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Per-mote data: box position, (fall speed, size, phase, sway amp), and
		// (wind response, brightness variance, twinkle rate, spare).
		const centers = new Float32Array(count * 3);
		const params = new Float32Array(count * 4);
		const params2 = new Float32Array(count * 4);

		for (let i = 0; i < count; i++) {
			centers[i * 3] = (rng() - 0.5) * width;
			centers[i * 3 + 1] = (rng() - 0.5) * height;
			centers[i * 3 + 2] = (rng() - 0.5) * depth;
			params[i * 4] = minFall + rng() * (maxFall - minFall);
			params[i * 4 + 1] = sizeWorld * (0.5 + rng() * 0.8);
			params[i * 4 + 2] = rng();
			params[i * 4 + 3] = swayAmp * (0.5 + rng() * 0.7);
			params2[i * 4] = 0.3 + rng() * 0.7; // wind response
			params2[i * 4 + 1] = 0.6 + rng() * 0.8; // brightness variance
			params2[i * 4 + 2] = 0.15 + rng() * 0.35; // twinkle rate, rad/s
			params2[i * 4 + 3] = rng() * 6.283; // twinkle phase
		}

		const material = skyLayerMaterial({ blending: THREE.AdditiveBlending });

		const aCenter = instancedVec3(centers);
		const aParams = instancedVec4(params);
		const aParams2 = instancedVec4(params2);
		const aFall = aParams.x;
		const aSize = aParams.y;
		const aPhase = aParams.z;
		const aSwayAmp = aParams.w;
		const aWindMul = aParams2.x;
		const aBoost = aParams2.y;
		const aTwinkleRate = aParams2.z;
		const aTwinklePhase = aParams2.w;

		const corner = positionLocal.xy;

		const halfWidth = float(width * 0.5);
		const halfHeight = float(height * 0.5);
		const halfDepth = float(depth * 0.5);
		const boxWidth = float(width);
		const boxHeight = float(height);
		const boxDepth = float(depth);

		// The box's world origin — the camera, since the mesh is re-centred on it every
		// frame (same reasoning as Snow/Rain's `anchor`).
		const anchor = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;

		// SETTLE + WRAP, same construction as Snow's fall — a near-zero speed reads as
		// motes hanging in the air and being slowly recycled rather than falling through.
		const fall = uFallTime.mul(aFall).add(aPhase.mul(boxHeight));
		const y = fract(aCenter.y.add(halfHeight).sub(fall).sub(anchor.y).div(boxHeight))
			.mul(boxHeight)
			.sub(halfHeight);

		// WANDER: wind drift (accumulated, so a shifting wind bends the path rather than
		// teleporting it) plus a per-mote sine wobble on all three axes — dust has no
		// preferred direction the way snow's coherent swirl does, so the wobble is
		// intentionally less correlated between neighbours (phased by the mote's own
		// constant, not by position).
		const xBase = aCenter.x.add(halfWidth).add(uWindDrift.x.mul(aWindMul));
		const zBase = aCenter.z.add(halfDepth).add(uWindDrift.y.mul(aWindMul));

		const wobbleZ = sin(time.mul(0.35).add(aPhase.mul(9.4))).mul(aSwayAmp);
		const z = fract(zBase.add(wobbleZ).sub(anchor.z).div(boxDepth)).mul(boxDepth).sub(halfDepth);

		const wobbleX = cos(time.mul(0.3).add(aPhase.mul(7.1))).mul(aSwayAmp);
		const x = fract(xBase.add(wobbleX).sub(anchor.x).div(boxWidth)).mul(boxWidth).sub(halfWidth);

		const wobbleY = sin(time.mul(0.4).add(aPhase.mul(11.3))).mul(aSwayAmp.mul(0.3));
		const finalY = y.add(wobbleY);

		// WRAP FADE, as Snow/Rain: the box's outer shell fades out so a mote recycling to
		// the opposite face is already invisible when it jumps.
		const shell = x
			.abs()
			.div(halfWidth)
			.max(z.abs().div(halfDepth))
			.max(finalY.abs().div(halfHeight));
		const wrapFade = smoothstep(float(0.75), float(1), shell).oneMinus();

		// THE BACKLIGHT TERM — the effect's whole reason to exist. `viewDir` is
		// camera-to-mote, constant enough across a sub-pixel quad to compute once in the
		// vertex stage (Snow's `flakeAlpha` rule: anything constant per-particle goes
		// through a varying, not the fragment stage).
		const world = modelWorldMatrix.mul(vec4(x, finalY, z, 1)).xyz;
		const viewDir = world.sub(cameraPosition).normalize();
		const rim = viewDir.dot(uKeyDir).max(0).pow(float(rimSharpness));

		// Camera-facing billboard with HONEST depth (Snow's `billboardClip`, not the sky
		// dome's far-plane pin) — a mote must be occluded by the car and the track.
		material.vertexNode = billboardClip(vec3(x, finalY, z), corner.mul(aSize));

		const viewDistance = modelViewMatrix.mul(vec4(x, finalY, z, 1)).xyz.length();
		const nearFade = smoothstep(float(NEAR_FADE_START), float(NEAR_FADE_END), viewDistance);

		const twinkle = sin(time.mul(aTwinkleRate).add(aTwinklePhase)).mul(0.22).add(0.85);

		// Hue: pale ambient grey, mixed toward the key's own colour as a mote catches more
		// of it — a dry-ambient mote and a sunbeam-caught one should not be the same white.
		const moteColor = varying(mix(vec3(0.55, 0.6, 0.68), uKeyColor, rim.clamp(0, 1)));
		const moteMagnitude = varying(
			uAmbientGlow.add(rim.mul(uKeyRadiance).mul(aBoost)).mul(twinkle).mul(wrapFade).mul(nearFade)
		);

		// THE SPECK: inverse-distance falloff, same construction as Snow's (skyLayer.ts's
		// `instancedDisc` note) — bright core, gone at the quad's radius. The one
		// genuinely per-fragment term; everything else above is lifted to a varying.
		const dist = sqrt(corner.x.mul(corner.x).add(corner.y.mul(corner.y))).mul(0.5);
		const speck = float(0.5).div(dist.max(1e-3)).sub(1).clamp(0, 1);

		material.colorNode = moteColor;
		material.opacityNode = moteMagnitude.mul(opacity).mul(speck);

		// An octagon, not a quad — see `instancedDisc`: the speck dies at radius 1, so a
		// square's corners are fragments blended to nothing.
		return { geometry: instancedDisc(count), material };
	};

	const { geometry, material } = build();

	let driftX = 0;
	let driftZ = 0;

	useTask(
		(delta) => {
			const w = descriptor.weather;
			const wet = Math.max(w.precipitation, w.fog);
			// Dust disperses well before a gale; the floor keeps a LIGHT breeze from
			// killing the effect outright.
			const windPenalty = clamp01((w.wind - 0.35) / 0.65);
			opacity.value = clamp01(1 - wet * 1.3) * (1 - windPenalty * 0.7);

			uFallTime.value += delta;

			const wind = clamp01(w.wind);
			const travel = wind * WIND_RATE * delta;
			driftX += windAxisX(w) * travel;
			driftZ += windAxisZ(w) * travel;
			uWindDrift.value.set(driftX, driftZ);

			const { direction, color, intensity, ambient } = descriptor.light;
			uKeyDir.value.set(direction.x, direction.y, direction.z);
			uKeyColor.value.set(color[0], color[1], color[2]);
			uKeyRadiance.value = intensity * RADIANCE_SCALE;
			uAmbientGlow.value = 0.012 + ambient * 0.03;

			const visible = opacity.value > 0.02;
			if (mesh) {
				mesh.visible = visible;
				mesh.position.copy(camera.current.position);
			}
			// Animates off the TSL `time` node while visible, and not at all otherwise —
			// see Skybox.svelte on renderMode.
			if (visible) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});

	// Keep the field out of the cube captures — see `AMBIENT_LAYER` in skyLayer.ts.
	$effect(() => {
		mesh?.layers.set(AMBIENT_LAYER);
	});

	$effect(() => camera.subscribe((cam) => cam.layers.enable(AMBIENT_LAYER)));
</script>

<!-- renderOrder 3.3: nearest of the near-camera layers, drawn after Rain's streaks (3),
     rings (3.1) and burst (3.2) so a mote in front of a raindrop still composites
     correctly, and before the lightning wash (4). -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={3.3}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
